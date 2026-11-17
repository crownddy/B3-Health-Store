#!/usr/bin/env node
/**
 * One-shot setup for the integration environment:
 *   1. generate local keys (no secrets; writes .local-test/keys.env)
 *   2. start the local Supabase stack
 *   3. apply schema.sql + the product-management migration
 *   4. create the super-admin and staff test accounts
 *   5. seed a small catalogue
 *
 * Idempotent: safe to re-run. Local targets only.
 *
 * Usage: node tests/integration/scripts/setup.mjs
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT, resolveConfig } from "./env.mjs";
import { applySchema, createTestUsers, seedData } from "./bootstrap.mjs";

const here = join(REPO_ROOT, "tests", "integration", "scripts");

function run(script, args = []) {
  const result = spawnSync("node", [join(here, script), ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} failed`);
}

console.log("==> Generating local keys");
run("generate-keys.mjs");

// Fail fast if any target is not local, before touching Docker.
const config = resolveConfig();
console.log(`==> Targets: supabase=${config.supabaseUrl} app=${config.appUrl} (all local)`);

console.log("==> Starting stack");
run("stack.mjs", ["up"]);

console.log("==> Applying schema and migration");
applySchema();

console.log("==> Creating test accounts");
await createTestUsers();

console.log("==> Seeding catalogue");
seedData();

console.log("\nIntegration environment is ready.");
console.log("Next:");
console.log("  npm run test:integration:rls    # RLS / authorization suite");
console.log("  npm run test:integration:e2e    # browser E2E suite (starts the app itself)");
