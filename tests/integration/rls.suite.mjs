#!/usr/bin/env node
/**
 * RLS / authorization suite for product management.
 *
 * Exercises the real stack over HTTP: real GoTrue tokens, real PostgREST
 * requests, real Postgres RLS. It also reads the database directly to confirm
 * that blocked writes genuinely changed nothing.
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 *
 * Usage: node tests/integration/rls.suite.mjs
 */
import { REPO_ROOT, resolveConfig } from "./scripts/env.mjs";
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

const count = async (path, token) => (await (await rest(path, { token })).json()).length;
const statusOf = async (path, opts) => (await rest(path, opts)).status;

const superToken = await login(config.superAdmin.email, config.superAdmin.password);
const staffToken = await login(config.staff.email, config.staff.password);

check("super admin login returns a token", "yes", superToken ? "yes" : "no");
check("staff login returns a token", "yes", staffToken ? "yes" : "no");

// --- Read visibility -------------------------------------------------------
check("anon cannot see the archived product", 0, await count("products?select=id&sku=eq.VIT-C"));
check("anon sees the published active product", 1, await count("products?select=sku&sku=eq.VITC-1"));
check("staff cannot see the archived product", 0, await count("products?select=id&sku=eq.VIT-C", staffToken));
check("super admin sees the archived product", 1, await count("products?select=id&sku=eq.VIT-C", superToken));
check("staff can read published products", 1, await count("products?select=sku&sku=eq.VITC-1", staffToken));

// --- Staff writes are refused ---------------------------------------------
const before = psql("select count(*) from public.products");
await rest("products", {
  token: staffToken,
  method: "POST",
  prefer: "return=representation",
  body: { name: "Staff Sneak", selling_price: 1 }
});
check("staff INSERT changes no rows", before, psql("select count(*) from public.products"));

await rest("products?sku=eq.VITC-1", { token: staffToken, method: "PATCH", body: { name: "Hacked" } });
check("staff UPDATE leaves the name unchanged", "Vitamin C 1000mg", psql("select name from public.products where sku='VITC-1'"));

await rest("products?sku=eq.VITC-1", { token: staffToken, method: "DELETE" });
check("staff DELETE leaves the row present", 1, psql("select count(*) from public.products where sku='VITC-1'"));

const staffId = psql("select id from public.profiles where role='staff' limit 1");
await rest(`profiles?id=eq.${staffId}`, { token: staffToken, method: "PATCH", body: { role: "super_admin" } });
check("staff cannot self-promote", "staff", psql(`select role from public.profiles where id='${staffId}'`));

const superId = psql("select id from public.profiles where role='super_admin' limit 1");
check("staff cannot read another profile", 0, await count(`profiles?select=id&id=eq.${superId}`, staffToken));

// --- Super admin writes succeed -------------------------------------------
const created = await (
  await rest("products", {
    token: superToken,
    method: "POST",
    prefer: "return=representation",
    body: { name: "Super Made", selling_price: 100 }
  })
).json();
const createdId = Array.isArray(created) ? created[0]?.id : "";
check("super admin INSERT succeeds", "yes", createdId ? "yes" : "no");

await rest(`products?id=eq.${createdId}`, { token: superToken, method: "PATCH", body: { name: "Super Updated" } });
check("super admin UPDATE applies", "Super Updated", psql(`select name from public.products where id='${createdId}'`));

await rest(`products?id=eq.${createdId}`, { token: superToken, method: "DELETE" });
check("super admin DELETE removes the row", 0, psql(`select count(*) from public.products where id='${createdId}'`));

// --- History protection and archive ---------------------------------------
const vitaminC = psql("select id from public.products where sku='VITC-1'");
psql(`insert into public.stock_movements (product_id, movement_type, quantity, note) values ('${vitaminC}','stock_in',5,'rls suite')`);
await rest(`products?id=eq.${vitaminC}`, { token: superToken, method: "DELETE" });
check("delete blocked while stock history exists", 1, psql(`select count(*) from public.products where id='${vitaminC}'`));

// A batch is history too. The foreign key must be ON DELETE RESTRICT, so a
// product that only has a batch (no stock movement) still cannot be deleted,
// and the batch row must survive the attempt.
const batchProduct = await (
  await rest("products", {
    token: superToken,
    method: "POST",
    prefer: "return=representation",
    body: { name: "Batch History", sku: "BATCH-RLS", selling_price: 1 }
  })
).json();
const batchProductId = Array.isArray(batchProduct) ? batchProduct[0]?.id : "";
psql(
  `insert into public.product_batches (product_id, batch_number, quantity_received, quantity_remaining, expiration_date)
   values ('${batchProductId}', 'RLS-BATCH', 5, 5, '2027-01-01')`
);
await rest(`products?id=eq.${batchProductId}`, { token: superToken, method: "DELETE" });
check("delete blocked while batch history exists", 1, psql(`select count(*) from public.products where id='${batchProductId}'`));
check("batch history intact after blocked delete", 1, psql(`select count(*) from public.product_batches where product_id='${batchProductId}'`));
psql(`delete from public.product_batches where product_id='${batchProductId}'`);
await rest(`products?id=eq.${batchProductId}`, { token: superToken, method: "DELETE" });

await rest(`products?id=eq.${vitaminC}`, {
  token: superToken,
  method: "PATCH",
  body: { status: "archived", is_visible_on_homepage: false }
});
check("movement history intact after archive", 1, psql(`select count(*) from public.stock_movements where product_id='${vitaminC}'`));
check("archived product hidden from the public", 0, await count(`products?select=id&id=eq.${vitaminC}`));
await rest(`products?id=eq.${vitaminC}`, {
  token: superToken,
  method: "PATCH",
  body: { status: "active", is_visible_on_homepage: true }
});

// --- Constraints -----------------------------------------------------------
await rest("products", { token: superToken, method: "POST", body: { name: "BC One", barcode: "6151100777777", selling_price: 1 } });
check("duplicate barcode rejected", 409, await statusOf("products", {
  token: superToken, method: "POST", body: { name: "BC Two", barcode: "6151100777777", selling_price: 1 }
}));
psql("delete from public.products where barcode='6151100777777'");

check("invalid status rejected by CHECK", 400, await statusOf("products", {
  token: superToken, method: "POST", body: { name: "Bad Status", status: "deleted", selling_price: 1 }
}));

// Clean up the history row so the suite is re-runnable.
psql(`delete from public.stock_movements where product_id='${vitaminC}' and note='rls suite'`);

console.log(`\n=== RLS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
