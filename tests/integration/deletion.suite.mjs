#!/usr/bin/env node
/**
 * Product deletion suite.
 *
 * Product deletion is no longer refused when a product has history. A product
 * with no batches and no stock movements is hard deleted; a product with either
 * is soft deleted — hidden from every active list, selection and sales screen —
 * while its batches and movements stay in the database.
 *
 * This suite exercises the real stack over HTTP, exactly as the app's client
 * does, and checks:
 *   1. a product with no history is hard deleted (the row is gone);
 *   2. a product with batches is soft deleted and its batch row survives;
 *   3. a product with stock movements is soft deleted and its history survives;
 *   4. a soft-deleted product disappears from the inventory list, the sellable
 *      list and the dashboard totals;
 *   5. a deleted product cannot be restocked (record_stock_movement refuses);
 *   6. staff cannot delete (RLS still governs the write).
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 *
 * Usage: npm run test:integration:deletion
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

const rest = (path, { token = config.anonKey, method = "GET", body, prefer } = {}) =>
  fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

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

const RUN = `DEL${Date.now().toString(36).toUpperCase()}`;

function cleanup() {
  const products = `select id from public.products where name like '${RUN}%'`;
  psql(`delete from public.stock_movements where product_id in (${products})`);
  psql(`delete from public.product_batches where product_id in (${products})`);
  psql(`delete from public.products where name like '${RUN}%'`);
}

const superToken = await login(config.superAdmin.email, config.superAdmin.password);
const staffToken = await login(config.staff.email, config.staff.password);
check("super admin login returns a token", "yes", superToken ? "yes" : "no");
check("staff login returns a token", "yes", staffToken ? "yes" : "no");

const base = {
  p_description: "deletion suite",
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

/** Creates a product with opening stock, as the Add Product form does. */
async function make(name, quantity, expiration, batchNumber) {
  const made = await rpc("create_product_with_initial_stock", {
    ...base,
    p_name: `${RUN} ${name}`,
    p_initial_quantity: quantity,
    p_initial_expiration_date: expiration,
    p_initial_batch_number: batchNumber
  });
  return made.data?.product_id ?? "";
}

/** Soft deletes a product exactly as the server action does. */
async function softDelete(id, token = superToken) {
  return rest(`products?id=eq.${id}`, {
    token,
    method: "PATCH",
    body: { deleted_at: new Date().toISOString(), status: "archived", is_visible_on_homepage: false }
  });
}

const listArgs = (overrides = {}) => ({
  p_search: null,
  p_expiry: null,
  p_page: 0,
  p_page_size: 50,
  p_soon_days: 120,
  ...overrides
});

try {
  cleanup();

  // --- 1. Hard delete: no history -----------------------------------------
  const plainId = await make("Plain", 0, null, null);
  check("hard: product created", 1, psql(`select count(*) from public.products where id='${plainId}'`));
  await rest(`products?id=eq.${plainId}`, { token: superToken, method: "DELETE" });
  check("hard: row is gone", 0, psql(`select count(*) from public.products where id='${plainId}'`));

  // --- 2. Soft delete: batches --------------------------------------------
  const batchId = await make("Batched", 5, "2027-01-01", "DEL-BATCH");
  check("soft/batch: opening batch created", 1, psql(`select count(*) from public.product_batches where product_id='${batchId}'`));
  // A direct DELETE must be refused by the ON DELETE RESTRICT foreign key.
  const blocked = await rest(`products?id=eq.${batchId}`, { token: superToken, method: "DELETE" });
  check("soft/batch: hard delete refused by the foreign key", true, blocked.status >= 400);
  check("soft/batch: row still present after refused delete", 1, psql(`select count(*) from public.products where id='${batchId}'`));
  await softDelete(batchId);
  check("soft/batch: soft delete marks the row", "true", psql(`select (deleted_at is not null)::text from public.products where id='${batchId}'`));
  check("soft/batch: batch history intact", 1, psql(`select count(*) from public.product_batches where product_id='${batchId}'`));

  // --- 3. Soft delete: stock movements ------------------------------------
  const movedId = await make("Moved", 3, "2027-02-01", "DEL-MOVE");
  check("soft/movement: opening movement recorded", 1, psql(`select count(*) from public.stock_movements where product_id='${movedId}' and movement_type='stock_in'`));
  await softDelete(movedId);
  check("soft/movement: soft delete marks the row", "true", psql(`select (deleted_at is not null)::text from public.products where id='${movedId}'`));
  check("soft/movement: movement history intact", 1, psql(`select count(*) from public.stock_movements where product_id='${movedId}'`));

  // --- 4. Hidden from every active list ------------------------------------
  const liveId = await make("Live", 1, "2027-03-01", "DEL-LIVE");
  const list = await rpc("list_inventory_products", listArgs({ p_search: RUN }));
  const names = (list.data?.items ?? []).map((item) => item.name);
  check("list: the live product is shown", true, names.some((n) => n.endsWith("Live")));
  check("list: a deleted product is hidden", false, names.some((n) => n.endsWith("Batched")));
  check("list: another deleted product is hidden", false, names.some((n) => n.endsWith("Moved")));

  const sellable = await rpc("list_sellable_products", { p_search: RUN, p_limit: 50, p_offset: 0 });
  check(
    "sellable: a deleted product is never offered for sale",
    false,
    (sellable.data?.items ?? []).some((item) => item.name.endsWith("Batched"))
  );

  const batches = await rpc("list_inventory_batches", { p_expiry: null, p_limit: 100, p_offset: 0, p_soon_days: 120 });
  check(
    "batches: a deleted product's batch is hidden",
    false,
    (batches.data?.items ?? []).some((item) => item.batch_number === "DEL-BATCH")
  );

  const metrics = await rpc("dashboard_metrics", { p_soon_days: 120 });
  check(
    "dashboard: totals exclude deleted products",
    psql("select count(*)::int from public.products where deleted_at is null"),
    metrics.data?.totalProducts
  );

  // --- 5. A deleted product cannot be restocked ---------------------------
  const restock = await rpc("record_stock_movement", {
    p_product_id: movedId,
    p_movement_type: "stock_in",
    p_quantity: 1,
    p_note: "deletion suite restock",
    p_batch_number: null,
    p_expiration_date: null
  });
  check("restock: a deleted product is refused", true, restock.status >= 400);

  // --- 6. Staff cannot delete ---------------------------------------------
  const staffDelete = await rest(`products?id=eq.${liveId}`, { token: staffToken, method: "DELETE" });
  check("staff: a delete changes no rows", true, staffDelete.status >= 200 && staffDelete.status < 300);
  check("staff: the product is still present", 1, psql(`select count(*) from public.products where id='${liveId}'`));
  const staffSoft = await softDelete(liveId, staffToken);
  check("staff: a soft delete changes no rows", true, staffSoft.status >= 200 && staffSoft.status < 300);
  check("staff: the product is not marked deleted", "false", psql(`select (deleted_at is not null)::text from public.products where id='${liveId}'`));
} finally {
  cleanup();
}

console.log(`\n=== Deletion: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
