#!/usr/bin/env node
/**
 * Sold-screen suite for the sellable-availability helpers.
 *
 * The Sold screen must only offer products that can actually be sold, show the
 * correct available quantity, and deduct through the existing stock-out RPC
 * (FEFO, never expired, atomic). This suite exercises the two new read-only
 * functions and the sale path over HTTP against the real stack, exactly as the
 * app calls them.
 *
 * Recording the sale is deliberately not a new function: it reuses
 * record_stock_movement, so this suite also confirms a sale behaves like any
 * other stock out.
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 *
 * Usage: node tests/integration/sold.suite.mjs
 */
import { resolveConfig } from "./scripts/env.mjs";
import { psql } from "./scripts/db.mjs";

const config = resolveConfig();

let pass = 0;
let fail = 0;
const failures = [];

function check(name, expected, actual) {
  if (String(expected) === String(actual)) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name} (expected [${expected}] got [${actual}])`);
    fail++;
    failures.push(name);
  }
}

async function login(email, password) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  return body.access_token || "";
}

/** Calls a Postgres function through PostgREST, as the app's client does. */
async function rpc(name, args, token = superToken) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

/** A unique suffix so repeated runs never collide. */
const RUN = `S${Date.now().toString(36).toUpperCase()}`;

function cleanup() {
  const products = `select id from public.products where name like '${RUN}%'`;
  psql(`delete from public.stock_movements where product_id in (${products})`);
  psql(`delete from public.product_batches where product_id in (${products})`);
  psql(`delete from public.products where name like '${RUN}%'`);
}

const daysFromNow = (days) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const superToken = await login(config.superAdmin.email, config.superAdmin.password);
const staffToken = await login(config.staff.email, config.staff.password);
check("super admin login returns a token", "yes", superToken ? "yes" : "no");
check("staff login returns a token", "yes", staffToken ? "yes" : "no");

try {
  cleanup();

  const base = {
    p_description: "sold suite",
    p_category: null,
    p_sku: null,
    p_barcode: null,
    p_image_url: null,
    p_purchase_price: 0,
    p_selling_price: 5,
    p_minimum_stock: 0,
    p_shelf_number: null,
    p_is_visible_on_homepage: false,
    p_is_featured: false
  };

  // A product with 10 units in one unexpired batch.
  const made = await rpc("create_product_with_initial_stock", {
    ...base,
    p_name: `${RUN} Alpha`,
    p_initial_quantity: 10,
    p_initial_expiration_date: daysFromNow(60),
    p_initial_batch_number: "ALPHA-1"
  });
  const alphaId = made.data?.product_id ?? "";
  check("create: succeeds", 200, made.status);

  // --- 1. sellable_quantity reports the unexpired total --------------------
  const sellable = await rpc("sellable_quantity", { p_product_id: alphaId });
  check("sellable_quantity: returns the unexpired total", 10, sellable.data);

  // --- 2. list_sellable_products includes it with the right quantity -------
  const list = await rpc("list_sellable_products", { p_search: RUN, p_limit: 10, p_offset: 0 });
  const items = list.data?.items ?? [];
  check("list: succeeds", 200, list.status);
  check("list: reports the total", 1, list.data?.total);
  check("list: includes the product", `${RUN} Alpha`, items[0]?.name);
  check("list: shows the available quantity", 10, items[0]?.quantity);

  // --- 3. Search narrows the list ------------------------------------------
  const noMatch = await rpc("list_sellable_products", { p_search: `${RUN} Nope`, p_limit: 10, p_offset: 0 });
  check("list: a non-matching search returns nothing", 0, noMatch.data?.total);
  check("list: a non-matching search returns no items", 0, (noMatch.data?.items ?? []).length);

  // --- 4. Pagination reports the true total and a bounded page -------------
  for (let i = 0; i < 3; i++) {
    await rpc("create_product_with_initial_stock", {
      ...base,
      p_name: `${RUN} Page ${i}`,
      p_initial_quantity: 2,
      p_initial_expiration_date: daysFromNow(30),
      p_initial_batch_number: null
    });
  }
  const paged = await rpc("list_sellable_products", { p_search: RUN, p_limit: 2, p_offset: 0 });
  check("list: total counts every match", 4, paged.data?.total);
  check("list: a page is capped at the limit", 2, (paged.data?.items ?? []).length);
  const secondPage = await rpc("list_sellable_products", { p_search: RUN, p_limit: 2, p_offset: 2 });
  check("list: the next page continues the list", 2, (secondPage.data?.items ?? []).length);
  const pastEnd = await rpc("list_sellable_products", { p_search: RUN, p_limit: 2, p_offset: 99 });
  check("list: a page past the end is empty", 0, (pastEnd.data?.items ?? []).length);
  check("list: the total is still reported past the end", 4, pastEnd.data?.total);

  // --- 5. Expired-only stock is not sellable and not listed ----------------
  const expired = await rpc("create_product_with_initial_stock", {
    ...base,
    p_name: `${RUN} Expired`,
    p_initial_quantity: 8,
    p_initial_expiration_date: daysFromNow(-3),
    p_initial_batch_number: "OLD-1"
  });
  const expiredId = expired.data?.product_id ?? "";
  check("expired: product created", 200, expired.status);
  check(
    "expired: sellable_quantity is zero",
    0,
    await rpc("sellable_quantity", { p_product_id: expiredId }).then((r) => r.data)
  );
  const listExpired = await rpc("list_sellable_products", { p_search: `${RUN} Expired`, p_limit: 10, p_offset: 0 });
  check("expired: excluded from the sellable list", 0, listExpired.data?.total);

  const sellExpired = await rpc("record_stock_movement", {
    p_product_id: expiredId,
    p_movement_type: "stock_out",
    p_quantity: 1,
    p_note: "Sale"
  });
  check("expired: selling is refused", true, sellExpired.status >= 400);
  check(
    "expired: the batch is untouched",
    8,
    psql(`select quantity_remaining from public.product_batches where product_id='${expiredId}'`)
  );

  // --- 6. A sale is an ordinary stock out and follows FEFO -----------------
  // Add a near batch (soonest) to Alpha, then sell 12 of the 13 sellable units.
  await rpc("record_stock_movement", {
    p_product_id: alphaId,
    p_movement_type: "stock_in",
    p_quantity: 3,
    p_note: "restock",
    p_batch_number: "ALPHA-NEAR",
    p_expiration_date: daysFromNow(4)
  });
  const sale = await rpc("record_stock_movement", {
    p_product_id: alphaId,
    p_movement_type: "stock_out",
    p_quantity: 12,
    p_note: "Sale"
  });
  check("sale: succeeds", 200, sale.status);
  check(
    "sale: the earliest batch is emptied first",
    0,
    psql(`select quantity_remaining from public.product_batches where product_id='${alphaId}' and batch_number='ALPHA-NEAR'`)
  );
  check(
    "sale: the remainder comes from the next batch",
    1,
    psql(`select quantity_remaining from public.product_batches where product_id='${alphaId}' and batch_number='ALPHA-1'`)
  );
  check("sale: product total reduced", 1, psql(`select quantity from public.products where id='${alphaId}'`));
  check(
    "sale: one movement row per batch (history preserved)",
    2,
    psql(`select count(*) from public.stock_movements where product_id='${alphaId}' and movement_type='stock_out' and note='Sale'`)
  );

  // --- 7. Selling more than is sellable is refused, changing nothing -------
  const before = psql(`select quantity from public.products where id='${alphaId}'`);
  const movementsBefore = psql(`select count(*) from public.stock_movements where product_id='${alphaId}'`);
  const oversell = await rpc("record_stock_movement", {
    p_product_id: alphaId,
    p_movement_type: "stock_out",
    p_quantity: 50,
    p_note: "Sale"
  });
  check("oversell: refused", true, oversell.status >= 400);
  check("oversell: total unchanged", before, psql(`select quantity from public.products where id='${alphaId}'`));
  check(
    "oversell: no movement added",
    movementsBefore,
    psql(`select count(*) from public.stock_movements where product_id='${alphaId}'`)
  );

  // --- 8. Concurrent sales cannot oversell ---------------------------------
  const conc = await rpc("create_product_with_initial_stock", {
    ...base,
    p_name: `${RUN} Concurrency`,
    p_initial_quantity: 10,
    p_initial_expiration_date: daysFromNow(45),
    p_initial_batch_number: "CONC-1"
  });
  const concId = conc.data?.product_id ?? "";
  const [r1, r2] = await Promise.all([
    rpc("record_stock_movement", { p_product_id: concId, p_movement_type: "stock_out", p_quantity: 6, p_note: "Sale" }),
    rpc("record_stock_movement", { p_product_id: concId, p_movement_type: "stock_out", p_quantity: 6, p_note: "Sale" })
  ]);
  check("concurrent sale: exactly one succeeds", 1, [r1, r2].filter((r) => r.status === 200).length);
  check("concurrent sale: deducted once", 4, psql(`select quantity from public.products where id='${concId}'`));
  check(
    "concurrent sale: batch never negative",
    true,
    Number(psql(`select quantity_remaining from public.product_batches where product_id='${concId}'`)) >= 0
  );

  // --- 9. Authorization ----------------------------------------------------
  const staffList = await rpc("list_sellable_products", { p_search: RUN, p_limit: 10, p_offset: 0 }, staffToken);
  check("staff: may read the sellable list", 200, staffList.status);

  const staffSale = await rpc(
    "record_stock_movement",
    { p_product_id: alphaId, p_movement_type: "stock_out", p_quantity: 1, p_note: "Sale" },
    staffToken
  );
  check("staff: cannot record a sale", true, staffSale.status >= 400);
  check(
    "staff: refused sale changed nothing",
    before,
    psql(`select quantity from public.products where id='${alphaId}'`)
  );

  const anonList = await rpc("list_sellable_products", { p_search: RUN, p_limit: 10, p_offset: 0 }, config.anonKey);
  check("anon: cannot call the sellable list", true, anonList.status >= 400);

  const anonSellable = await rpc("sellable_quantity", { p_product_id: alphaId }, config.anonKey);
  check("anon: cannot call sellable_quantity", true, anonSellable.status >= 400);
} finally {
  cleanup();
}

console.log(`\n=== Sold: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
