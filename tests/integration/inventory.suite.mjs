#!/usr/bin/env node
/**
 * Inventory query suite for the pushed-down list and dashboard functions.
 *
 * The Inventory screen used to load the whole catalogue and filter it in
 * application code. Search, expiration filtering and pagination now run in
 * PostgreSQL (`list_inventory_products`), and the dashboard figures come from
 * `dashboard_metrics`. This suite exercises both over HTTP against the real
 * stack, exactly as the app calls them, and checks the totals, the paging and
 * the per-role authorization.
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 *
 * Usage: node tests/integration/inventory.suite.mjs
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
const RUN = `Q${Date.now().toString(36).toUpperCase()}`;

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

const listArgs = (overrides = {}) => ({
  p_search: null,
  p_expiry: null,
  p_page: 0,
  p_page_size: 10,
  p_soon_days: 120,
  ...overrides
});

const total = (payload) => payload?.total;
const statusOf = (payload, name) =>
  (payload?.items ?? []).find((item) => item.name === name)?.expiry_status;
const batchCountOf = (payload, name) =>
  (payload?.items ?? []).find((item) => item.name === name)?.batch_count;

try {
  cleanup();

  const base = {
    p_description: "inventory suite",
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

  async function make(name, quantity, expiration, batchNumber, visible = false) {
    const made = await rpc("create_product_with_initial_stock", {
      ...base,
      p_name: `${RUN} ${name}`,
      p_initial_quantity: quantity,
      p_initial_expiration_date: expiration,
      p_initial_batch_number: batchNumber,
      p_is_visible_on_homepage: visible
    });
    return made.data?.product_id ?? "";
  }

  await make("Expired", 5, daysFromNow(-5), "Q-EXP");
  await make("Soon", 5, daysFromNow(30), "Q-SOON");
  const farId = await make("Far", 5, daysFromNow(400), "Q-FAR");
  const mixedId = await make("Mixed", 5, daysFromNow(400), "Q-MIXED");
  await make("Nodate", 5, null, "Q-NODATE");
  await make("NoStock", 0, null, null);
  await make("Published", 5, daysFromNow(400), "Q-PUB", true);

  // A second, soon-expiring batch on "Mixed", to prove the aggregate status is
  // the most urgent one and the batch count adds up.
  await rpc("record_stock_movement", {
    p_product_id: mixedId,
    p_movement_type: "stock_in",
    p_quantity: 2,
    p_note: "extra",
    p_batch_number: "Q-MIXED-SOON",
    p_expiration_date: daysFromNow(20)
  });

  // --- 1. Search -----------------------------------------------------------
  const search = await rpc("list_inventory_products", listArgs({ p_search: RUN }));
  check("search: reports every match", 7, total(search.data));
  check("search: a non-matching search returns nothing", 0, total(
    (await rpc("list_inventory_products", listArgs({ p_search: `${RUN} nope` }))).data
  ));
  const narrow = await rpc("list_inventory_products", listArgs({ p_search: `${RUN} Soon` }));
  check("search: narrows to one product", 1, total(narrow.data));
  check("search: is case-insensitive", 1, total(
    (await rpc("list_inventory_products", listArgs({ p_search: `${RUN} soon`.toLowerCase() }))).data
  ));

  // --- 2. Expiration filtering --------------------------------------------
  const expired = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_expiry: "expired" }));
  check("filter: expired total", 1, total(expired.data));
  check("filter: expired keeps the expired product", "expired", statusOf(expired.data, `${RUN} Expired`));

  const soon = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_expiry: "expiring_soon" }));
  check("filter: expiring-soon total", 2, total(soon.data));
  check("filter: expiring-soon keeps the soon product", "expiring_soon", statusOf(soon.data, `${RUN} Soon`));

  const valid = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_expiry: "valid" }));
  check("filter: valid total", 2, total(valid.data));
  check(
    "filter: a product with one soon batch is not valid",
    "expiring_soon",
    statusOf(
      (await rpc("list_inventory_products", listArgs({ p_search: `${RUN} Mixed` }))).data,
      `${RUN} Mixed`
    )
  );
  check("filter: valid excludes the mixed product", 0, total(
    (await rpc("list_inventory_products", listArgs({ p_search: `${RUN} Mixed`, p_expiry: "valid" }))).data
  ));

  const nodate = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_expiry: "no_date" }));
  check("filter: no_date total", 2, total(nodate.data));
  check("filter: no_date keeps the undated product", "no_date", statusOf(nodate.data, `${RUN} Nodate`));
  check("filter: no_date keeps the product with no batches", "no_date", statusOf(nodate.data, `${RUN} NoStock`));

  check("filter: no filter keeps everything", 7, total(search.data));

  // --- 3. Batch count ------------------------------------------------------
  check("batch_count: product with two batches", 2, batchCountOf(search.data, `${RUN} Mixed`));
  check("batch_count: product with one batch", 1, batchCountOf(search.data, `${RUN} Far`));
  check("batch_count: product with no batches", 0, batchCountOf(search.data, `${RUN} NoStock`));

  // --- 4. Pagination and exact totals -------------------------------------
  const firstPage = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_page: 0, p_page_size: 2 }));
  check("paging: total counts every match", 7, total(firstPage.data));
  check("paging: a page is capped at the page size", 2, (firstPage.data?.items ?? []).length);
  check("paging: reports the page count", 4, firstPage.data?.pages);
  check("paging: first page is page zero", 0, firstPage.data?.page);

  const lastPage = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_page: 3, p_page_size: 2 }));
  check("paging: last page holds the remainder", 1, (lastPage.data?.items ?? []).length);
  check("paging: last page is the fourth", 3, lastPage.data?.page);

  const pastEnd = await rpc("list_inventory_products", listArgs({ p_search: RUN, p_page: 99, p_page_size: 2 }));
  check("paging: a page past the end clamps to the last", 3, pastEnd.data?.page);
  check("paging: the total is still reported past the end", 7, total(pastEnd.data));

  const filtered = await rpc(
    "list_inventory_products",
    listArgs({ p_search: RUN, p_expiry: "no_date", p_page: 0, p_page_size: 10 })
  );
  check("paging: the total reflects the filter, not the catalogue", 2, total(filtered.data));

  // --- 5. Nothing else changed --------------------------------------------
  check(
    "safety: batch quantities are untouched",
    5,
    psql(`select quantity_remaining from public.product_batches where product_id='${farId}'`)
  );
  check(
    "safety: product quantity is untouched",
    7,
    psql(`select quantity from public.products where id='${mixedId}'`)
  );
  check(
    "safety: the movement history is preserved",
    1,
    psql(`select count(*) from public.stock_movements where product_id='${farId}' and movement_type='stock_in'`)
  );

  // --- 6. Batches & expiry section -----------------------------------------
  const batchesAll = await rpc("list_inventory_batches", {
    p_expiry: null,
    p_limit: 50,
    p_offset: 0,
    p_soon_days: 120
  });
  check("batches: succeeds", 200, batchesAll.status);
  check("batches: reports the exact total", 7, batchesAll.data?.total);
  check("batches: reports the expired count", 1, batchesAll.data?.expired);
  check("batches: reports the expiring-soon count", 2, batchesAll.data?.expiring_soon);

  const batchesExpired = await rpc("list_inventory_batches", {
    p_expiry: "expired",
    p_limit: 50,
    p_offset: 0,
    p_soon_days: 120
  });
  check("batches: filter total", 1, batchesExpired.data?.total);
  check("batches: filter returns only that slice", 1, (batchesExpired.data?.items ?? []).length);
  check(
    "batches: the counts are independent of the filter",
    2,
    batchesExpired.data?.expiring_soon
  );
  check(
    "batches: a row carries its product name",
    true,
    (batchesAll.data?.items ?? []).every((item) => typeof item.product_name === "string")
  );

  const batchesLimited = await rpc("list_inventory_batches", {
    p_expiry: null,
    p_limit: 2,
    p_offset: 0,
    p_soon_days: 120
  });
  check("batches: the slice is capped at the limit", 2, (batchesLimited.data?.items ?? []).length);
  check("batches: the total is still exact when limited", 7, batchesLimited.data?.total);

  const staffBatches = await rpc(
    "list_inventory_batches",
    { p_expiry: null, p_limit: 50, p_offset: 0, p_soon_days: 120 },
    staffToken
  );
  check("batches: staff may read the list", 200, staffBatches.status);

  const anonBatches = await rpc(
    "list_inventory_batches",
    { p_expiry: null, p_limit: 50, p_offset: 0, p_soon_days: 120 },
    config.anonKey
  );
  check("batches: anon cannot call the list", true, anonBatches.status >= 400);

  // --- 7. Dashboard metrics ------------------------------------------------
  const metrics = await rpc("dashboard_metrics", { p_soon_days: 120 });
  check("dashboard: succeeds", 200, metrics.status);
  check("dashboard: counts every product", true, Number(metrics.data?.totalProducts) >= 7);
  check("dashboard: counts expiring-soon batches", true, Number(metrics.data?.expiringSoonCount) >= 2);
  check("dashboard: counts expired batches", true, Number(metrics.data?.expiredCount) >= 1);
  check("dashboard: caps the expiring list at five", true, (metrics.data?.expiringBatches ?? []).length <= 5);
  check("dashboard: caps the low-stock list at five", true, (metrics.data?.lowStockProducts ?? []).length <= 5);
  check("dashboard: caps recent movements at six", true, (metrics.data?.recentMovements ?? []).length <= 6);
  check(
    "dashboard: stock units match the catalogue",
    psql("select coalesce(sum(quantity),0) from public.products"),
    metrics.data?.stockUnits
  );

  // --- 7. Authorization ----------------------------------------------------
  const staffList = await rpc("list_inventory_products", listArgs({ p_search: RUN }), staffToken);
  check("staff: may read the inventory list", 200, staffList.status);
  check(
    "staff: sees only the products they are allowed to read",
    1,
    total(staffList.data)
  );
  check("staff: the visible product is the published one", "valid", statusOf(staffList.data, `${RUN} Published`));

  const staffMetrics = await rpc("dashboard_metrics", { p_soon_days: 120 }, staffToken);
  check("staff: may read the dashboard metrics", 200, staffMetrics.status);

  const anonList = await rpc("list_inventory_products", listArgs({ p_search: RUN }), config.anonKey);
  check("anon: cannot call the inventory list", true, anonList.status >= 400);

  const anonMetrics = await rpc("dashboard_metrics", { p_soon_days: 120 }, config.anonKey);
  check("anon: cannot call the dashboard metrics", true, anonMetrics.status >= 400);

  // The functions are read-only: a caller cannot use them to change stock.
  const before = psql(`select quantity from public.products where id='${farId}'`);
  await rpc("list_inventory_products", listArgs({ p_search: RUN }), staffToken);
  check(
    "safety: reading the list changes no stock",
    before,
    psql(`select quantity from public.products where id='${farId}'`)
  );
} finally {
  cleanup();
}

console.log(`\n=== Inventory query: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
