#!/usr/bin/env node
/**
 * Regression suite for the "RPC functions not deployed yet" server-side crash.
 *
 * A deployment can reach a database that does not have the functions added by
 * supabase/migrations/20261119_inventory_query_pushdown.sql — for example a
 * Vercel preview pointed at the existing project, where the Supabase preview
 * branch is skipped. Before the fallback, logging in and opening /admin threw a
 * Server Components exception ("Could not find the function
 * public.dashboard_metrics(p_soon_days) in the schema cache") and the page never
 * rendered.
 *
 * This suite reproduces exactly that condition against a real build and asserts
 * the admin pages still render:
 *   1. drop the three functions (and tell PostgREST to reload its schema);
 *   2. sign in and load /admin and /admin/inventory as Super Admin and as Staff;
 *   3. assert no server-side exception reached the browser;
 *   4. restore the functions and assert the pages still render (the primary
 *      path is not broken — the fallback must not hide a genuine failure).
 *
 * The functions are restored in a `finally`, so a failure cannot leave the local
 * stack without them. Local targets only — scripts/env.mjs refuses anything else.
 *
 * Usage: npm run test:integration:rpc-fallback
 */
import { chromium } from "playwright";
import { resolveConfig } from "./scripts/env.mjs";
import { psql, psqlFile } from "./scripts/db.mjs";

const config = resolveConfig();
const MIGRATION = "supabase/migrations/20261119_inventory_query_pushdown.sql";
const FUNCTIONS = [
  "public.list_inventory_products(text,text,integer,integer,integer)",
  "public.list_inventory_batches(text,integer,integer,integer)",
  "public.dashboard_metrics(integer)"
];

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, condition, extra = "") {
  if (condition) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${extra ? ` :: ${extra}` : ""}`);
    fail++;
    failures.push(name);
  }
}

const SERVER_ERROR = /server-side exception|Application error/i;

function dropFunctions() {
  for (const fn of FUNCTIONS) psql(`drop function if exists ${fn}`);
  // Force PostgREST to drop them from its schema cache so calls return PGRST202
  // rather than a stale hit, matching a database that never had the migration.
  psql("notify pgrst, 'reload schema'");
}

function restoreFunctions() {
  psqlFile(MIGRATION);
  psql("notify pgrst, 'reload schema'");
}

/** Signs in through the real login form and returns the page plus page errors. */
async function signIn(page, account) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  await page.goto(`${config.appUrl}/admin/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', account.email);
  await page.fill('input[type="password"]', account.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  return errors;
}

const browser = await chromium.launch();

try {
  // --- 1. Reproduce the preview condition ----------------------------------
  dropFunctions();
  const remaining = psql(
    "select count(*) from pg_proc where proname in " +
      "('list_inventory_products','list_inventory_batches','dashboard_metrics')"
  );
  ok("setup: the three functions are absent", remaining === "0", `count=${remaining}`);

  const context = await browser.newContext();
  const page = await context.newPage();

  // --- 2. Super Admin: dashboard (the page that crashed) --------------------
  const superErrors = await signIn(page, config.superAdmin);
  let body = (await page.textContent("body")) ?? "";
  ok("super admin: /admin renders without a server-side exception", !SERVER_ERROR.test(body));
  ok("super admin: /admin shows the dashboard", /overview|welcome back/i.test(body));
  ok(
    "super admin: /admin raises no client-visible server error",
    superErrors.every((message) => !SERVER_ERROR.test(message)),
    superErrors.join(" | ")
  );

  // --- 3. Super Admin: inventory list and batches --------------------------
  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  body = (await page.textContent("body")) ?? "";
  ok("super admin: /admin/inventory renders without a server-side exception", !SERVER_ERROR.test(body));
  ok("super admin: /admin/inventory shows the list", /inventory|batches/i.test(body));

  // The inventory search path also calls a missing function.
  await page.goto(`${config.appUrl}/admin/inventory?q=zzz-no-match`, { waitUntil: "networkidle" });
  body = (await page.textContent("body")) ?? "";
  ok("super admin: a filtered inventory search renders", !SERVER_ERROR.test(body));

  // --- 4. Staff: the same reads must work read-only ------------------------
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  const staffErrors = await signIn(staffPage, config.staff);
  body = (await staffPage.textContent("body")) ?? "";
  ok("staff: /admin renders without a server-side exception", !SERVER_ERROR.test(body));
  ok(
    "staff: no client-visible server error",
    staffErrors.every((message) => !SERVER_ERROR.test(message)),
    staffErrors.join(" | ")
  );
  await staffPage.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  body = (await staffPage.textContent("body")) ?? "";
  ok("staff: /admin/inventory renders without a server-side exception", !SERVER_ERROR.test(body));
  await staffContext.close();

  // --- 5. Restore, then prove the primary path still works -----------------
  restoreFunctions();
  const restored = psql(
    "select count(*) from pg_proc where proname in " +
      "('list_inventory_products','list_inventory_batches','dashboard_metrics')"
  );
  ok("restore: the three functions are back", restored === "3", `count=${restored}`);

  const afterContext = await browser.newContext();
  const afterPage = await afterContext.newPage();
  await signIn(afterPage, config.superAdmin);
  body = (await afterPage.textContent("body")) ?? "";
  ok("after restore: /admin renders via the database function", !SERVER_ERROR.test(body));
  ok("after restore: /admin shows the dashboard", /overview|welcome back/i.test(body));
  await afterPage.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  body = (await afterPage.textContent("body")) ?? "";
  ok("after restore: /admin/inventory renders via the database function", !SERVER_ERROR.test(body));
  await afterContext.close();

  await context.close();
} finally {
  // Never leave the local stack without the functions, whatever happened above.
  restoreFunctions();
  await browser.close();
}

console.log(`\n=== RPC fallback: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}
