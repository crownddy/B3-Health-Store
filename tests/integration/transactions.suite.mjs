#!/usr/bin/env node
/**
 * Atomicity / concurrency suite for inventory operations.
 *
 * Exercises the transactional RPCs over HTTP exactly as the app does: real
 * GoTrue tokens, real PostgREST calls, real Postgres transactions. It checks
 * that a multi-step operation either lands completely or not at all, that a
 * failed operation leaves every quantity and movement unchanged, that FEFO
 * spans batches and never sells expired stock, and that two concurrent
 * stock-outs cannot oversell.
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 *
 * Usage: node tests/integration/transactions.suite.mjs
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

/** A unique suffix so repeated runs never collide on SKU. */
const RUN = `T${Date.now().toString(36).toUpperCase()}`;

function cleanup() {
  const products = `select id from public.products where sku like '${RUN}-%'`;
  psql(`delete from public.stock_movements where product_id in (${products})`);
  psql(`delete from public.product_batches where product_id in (${products})`);
  psql(`delete from public.products where sku like '${RUN}-%'`);
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
    p_name: "Txn Product",
    p_description: "d",
    p_category: null,
    p_sku: `${RUN}-A`,
    p_barcode: null,
    p_image_url: null,
    p_purchase_price: 1,
    p_selling_price: 2,
    p_minimum_stock: 0,
    p_shelf_number: null,
    p_is_visible_on_homepage: false,
    p_is_featured: false
  };

  // --- 1. Product creation WITH initial stock is atomic --------------------
  const created = await rpc("create_product_with_initial_stock", {
    ...base,
    p_initial_quantity: 12,
    p_initial_expiration_date: daysFromNow(120),
    p_initial_batch_number: "INIT-1"
  });
  const productId = created.data?.product_id ?? "";
  check("create with stock: succeeds", 200, created.status);
  check("create with stock: product exists", 1, psql(`select count(*) from public.products where id='${productId}'`));
  check("create with stock: total quantity set", 12, psql(`select quantity from public.products where id='${productId}'`));
  check("create with stock: one batch created", 1, psql(`select count(*) from public.product_batches where product_id='${productId}'`));
  check(
    "create with stock: batch carries the expiry",
    daysFromNow(120),
    psql(`select expiration_date from public.product_batches where product_id='${productId}'`)
  );
  check(
    "create with stock: opening movement recorded",
    1,
    psql(`select count(*) from public.stock_movements where product_id='${productId}' and movement_type='stock_in'`)
  );

  // --- 2. Product creation WITHOUT initial stock creates no batch -----------
  const plain = await rpc("create_product_with_initial_stock", {
    ...base,
    p_sku: `${RUN}-B`,
    p_initial_quantity: 0,
    p_initial_expiration_date: null,
    p_initial_batch_number: null
  });
  const plainId = plain.data?.product_id ?? "";
  check("create without stock: succeeds", 200, plain.status);
  check("create without stock: quantity stays 0", 0, psql(`select quantity from public.products where id='${plainId}'`));
  check("create without stock: no batch", 0, psql(`select count(*) from public.product_batches where product_id='${plainId}'`));
  check("create without stock: no movement", 0, psql(`select count(*) from public.stock_movements where product_id='${plainId}'`));

  // --- 3. A FAILED product creation rolls everything back ------------------
  // The unique SKU makes the insert fail. Nothing at all may be left behind.
  const productsBefore = psql("select count(*) from public.products");
  const batchesBefore = psql("select count(*) from public.product_batches");
  const movementsBefore = psql("select count(*) from public.stock_movements");
  const duplicate = await rpc("create_product_with_initial_stock", {
    ...base,
    p_sku: `${RUN}-A`, // already used above
    p_initial_quantity: 99,
    p_initial_expiration_date: daysFromNow(30),
    p_initial_batch_number: "DUP-1"
  });
  check("failed create: rejected", true, duplicate.status >= 400);
  check("failed create: no product added", productsBefore, psql("select count(*) from public.products"));
  check("failed create: no batch added", batchesBefore, psql("select count(*) from public.product_batches"));
  check("failed create: no movement added", movementsBefore, psql("select count(*) from public.stock_movements"));

  // --- 4. Stock in: per-receipt expiry, generated number, no overwrite -----
  const receive = (args) => rpc("record_stock_movement", { p_product_id: productId, p_movement_type: "stock_in", ...args });
  await receive({ p_quantity: 5, p_batch_number: "LOT-B", p_expiration_date: daysFromNow(10) });
  await receive({ p_quantity: 5, p_batch_number: "LOT-C", p_expiration_date: daysFromNow(200) });
  check("stock in: batches tracked separately", 3, psql(`select count(*) from public.product_batches where product_id='${productId}'`));
  check(
    "stock in: batch quantities recorded",
    5,
    psql(`select quantity_remaining from public.product_batches where product_id='${productId}' and batch_number='LOT-B'`)
  );

  // Same number, different expiry: a NEW batch, and the original is untouched.
  await receive({ p_quantity: 2, p_batch_number: "LOT-B", p_expiration_date: daysFromNow(300) });
  check("stock in: new expiry keeps a separate batch", 4, psql(`select count(*) from public.product_batches where product_id='${productId}'`));
  check(
    "stock in: original batch expiry untouched",
    1,
    psql(
      `select count(*) from public.product_batches where product_id='${productId}' and batch_number='LOT-B' and expiration_date='${daysFromNow(10)}'`
    )
  );

  // No number supplied: one is generated (B3-YYYYMMDD...).
  await receive({ p_quantity: 3, p_batch_number: null, p_expiration_date: daysFromNow(2) });
  const generated = psql(
    `select batch_number from public.product_batches where product_id='${productId}' and expiration_date='${daysFromNow(2)}'`
  );
  check("stock in: batch number generated when blank", true, generated.startsWith("B3-"));

  // --- 5. Stock out FEFO across batches ------------------------------------
  // Earliest valid expiry is the generated batch (2 days, 3 units), then LOT-B
  // (10 days, 5 units). Selling 5 empties the first and takes 2 from LOT-B.
  const out = await rpc("record_stock_movement", {
    p_product_id: productId,
    p_movement_type: "stock_out",
    p_quantity: 5,
    p_note: "fefo"
  });
  check("stock out: succeeds", 200, out.status);
  check(
    "stock out: earliest batch emptied first",
    0,
    psql(`select quantity_remaining from public.product_batches where product_id='${productId}' and expiration_date='${daysFromNow(2)}'`)
  );
  check(
    "stock out: remainder from the next batch",
    3,
    psql(
      `select quantity_remaining from public.product_batches where product_id='${productId}' and batch_number='LOT-B' and expiration_date='${daysFromNow(10)}'`
    )
  );
  check(
    "stock out: one movement row per batch (history preserved)",
    2,
    psql(`select count(*) from public.stock_movements where product_id='${productId}' and movement_type='stock_out' and note='fefo'`)
  );

  // --- 6. A FAILED stock out leaves quantities and history unchanged -------
  // Add an expired batch directly; it must never be sold, so asking for more
  // than the sellable quantity fails and changes nothing.
  psql(
    `insert into public.product_batches (product_id, batch_number, quantity_received, quantity_remaining, expiration_date)
     values ('${productId}', 'OLD-1', 50, 50, '${daysFromNow(-10)}')`
  );
  const qtyBefore = psql(`select quantity from public.products where id='${productId}'`);
  const remainingBefore = psql(`select coalesce(sum(quantity_remaining),0) from public.product_batches where product_id='${productId}'`);
  const movementsBefore2 = psql(`select count(*) from public.stock_movements where product_id='${productId}'`);

  const oversell = await rpc("record_stock_movement", {
    p_product_id: productId,
    p_movement_type: "stock_out",
    p_quantity: 5000,
    p_note: "should fail"
  });
  check("failed stock out: rejected", true, oversell.status >= 400);
  check("failed stock out: product total unchanged", qtyBefore, psql(`select quantity from public.products where id='${productId}'`));
  check(
    "failed stock out: batch quantities unchanged",
    remainingBefore,
    psql(`select coalesce(sum(quantity_remaining),0) from public.product_batches where product_id='${productId}'`)
  );
  check("failed stock out: no movement added", movementsBefore2, psql(`select count(*) from public.stock_movements where product_id='${productId}'`));
  check(
    "failed stock out: expired batch never sold",
    50,
    psql(`select quantity_remaining from public.product_batches where product_id='${productId}' and batch_number='OLD-1'`)
  );

  // An invalid quantity is rejected before anything is written.
  const badQty = await rpc("record_stock_movement", {
    p_product_id: productId,
    p_movement_type: "stock_out",
    p_quantity: 0
  });
  check("invalid quantity: rejected", true, badQty.status >= 400);

  // --- 7. Concurrent stock-outs cannot oversell ----------------------------
  // A fresh product with exactly 10 sellable units in one batch.
  const conc = await rpc("create_product_with_initial_stock", {
    ...base,
    p_sku: `${RUN}-CONC`,
    p_initial_quantity: 10,
    p_initial_expiration_date: daysFromNow(60),
    p_initial_batch_number: "CONC-1"
  });
  const concId = conc.data?.product_id ?? "";

  // Fire two stock-outs of 6 at the same time. Only one can succeed, because
  // the second must wait for the product row lock and then see the reduced
  // total. The batch must never go negative.
  const [r1, r2] = await Promise.all([
    rpc("record_stock_movement", { p_product_id: concId, p_movement_type: "stock_out", p_quantity: 6, p_note: "race" }),
    rpc("record_stock_movement", { p_product_id: concId, p_movement_type: "stock_out", p_quantity: 6, p_note: "race" })
  ]);
  const successes = [r1, r2].filter((r) => r.status === 200).length;
  check("concurrent stock out: exactly one succeeds", 1, successes);
  check("concurrent stock out: total never negative", true, Number(psql(`select quantity from public.products where id='${concId}'`)) >= 0);
  check(
    "concurrent stock out: batch never negative",
    true,
    Number(psql(`select quantity_remaining from public.product_batches where product_id='${concId}'`)) >= 0
  );
  check(
    "concurrent stock out: deducted exactly once",
    4,
    psql(`select quantity from public.products where id='${concId}'`)
  );
  check(
    "concurrent stock out: exactly one movement recorded",
    1,
    psql(`select count(*) from public.stock_movements where product_id='${concId}' and movement_type='stock_out' and note='race'`)
  );

  // --- 8. Concurrent stock-ins keep a correct total ------------------------
  const conc2 = await rpc("create_product_with_initial_stock", {
    ...base,
    p_sku: `${RUN}-CONC2`,
    p_initial_quantity: 0,
    p_initial_expiration_date: null,
    p_initial_batch_number: null
  });
  const conc2Id = conc2.data?.product_id ?? "";
  await Promise.all([
    rpc("record_stock_movement", { p_product_id: conc2Id, p_movement_type: "stock_in", p_quantity: 7, p_batch_number: "R1", p_expiration_date: daysFromNow(40) }),
    rpc("record_stock_movement", { p_product_id: conc2Id, p_movement_type: "stock_in", p_quantity: 8, p_batch_number: "R2", p_expiration_date: daysFromNow(40) })
  ]);
  check("concurrent stock in: total is the sum", 15, psql(`select quantity from public.products where id='${conc2Id}'`));
  check(
    "concurrent stock in: batch quantities agree with the total",
    15,
    psql(`select coalesce(sum(quantity_remaining),0) from public.product_batches where product_id='${conc2Id}'`)
  );

  // --- 9. Authorization is enforced inside the database --------------------
  const staffAttempt = await rpc(
    "record_stock_movement",
    { p_product_id: productId, p_movement_type: "stock_in", p_quantity: 1 },
    staffToken
  );
  check("staff cannot call the stock function", true, staffAttempt.status >= 400);

  const staffCreate = await rpc(
    "create_product_with_initial_stock",
    { ...base, p_sku: `${RUN}-STAFF`, p_initial_quantity: 1, p_initial_expiration_date: null, p_initial_batch_number: null },
    staffToken
  );
  check("staff cannot call the create function", true, staffCreate.status >= 400);
  check("staff create left no product", 0, psql(`select count(*) from public.products where sku='${RUN}-STAFF'`));

  const anonAttempt = await rpc(
    "record_stock_movement",
    { p_product_id: productId, p_movement_type: "stock_in", p_quantity: 1 },
    config.anonKey
  );
  check("anon cannot call the stock function", true, anonAttempt.status >= 400);
} finally {
  cleanup();
}

console.log(`\n=== Transactions: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
