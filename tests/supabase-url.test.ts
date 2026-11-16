import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSupabaseUrl } from "../src/lib/supabase/config.ts";

const PROJECT = "https://abcdefghijklmnop.supabase.co";

test("strips a trailing /rest/v1 (the production misconfiguration)", () => {
  assert.equal(normalizeSupabaseUrl(`${PROJECT}/rest/v1/`), PROJECT);
  assert.equal(normalizeSupabaseUrl(`${PROJECT}/rest/v1`), PROJECT);
});

test("strips any trailing service path", () => {
  for (const path of ["auth", "rest", "storage", "realtime", "functions", "graphql"]) {
    assert.equal(normalizeSupabaseUrl(`${PROJECT}/${path}/v1/`), PROJECT);
    assert.equal(normalizeSupabaseUrl(`${PROJECT}/${path}/v1`), PROJECT);
  }
});

test("is case-insensitive", () => {
  assert.equal(normalizeSupabaseUrl(`${PROJECT}/REST/V1/`), PROJECT);
});

test("leaves a correct project URL untouched", () => {
  assert.equal(normalizeSupabaseUrl(PROJECT), PROJECT);
  assert.equal(normalizeSupabaseUrl(`${PROJECT}/`), PROJECT);
});

test("trims surrounding whitespace", () => {
  assert.equal(normalizeSupabaseUrl(`  ${PROJECT}/rest/v1/  `), PROJECT);
});

test("does not strip a path that is not a service endpoint", () => {
  // A version-like or custom segment must survive, since only the known
  // service paths are appended by supabase-js.
  assert.equal(normalizeSupabaseUrl(`${PROJECT}/v2`), `${PROJECT}/v2`);
  assert.equal(normalizeSupabaseUrl(`${PROJECT}/rest/v2`), `${PROJECT}/rest/v2`);
});

test("keeps a local stack URL and its port", () => {
  assert.equal(normalizeSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assert.equal(normalizeSupabaseUrl("http://127.0.0.1:54321/rest/v1/"), "http://127.0.0.1:54321");
});

test("returns null for missing or empty input", () => {
  assert.equal(normalizeSupabaseUrl(undefined), null);
  assert.equal(normalizeSupabaseUrl(null), null);
  assert.equal(normalizeSupabaseUrl(""), null);
  assert.equal(normalizeSupabaseUrl("   "), null);
  assert.equal(normalizeSupabaseUrl("/rest/v1/"), null);
});

test("never returns a value with a trailing slash", () => {
  for (const input of [PROJECT, `${PROJECT}/`, `${PROJECT}/rest/v1/`, `${PROJECT}/auth/v1`]) {
    const out = normalizeSupabaseUrl(input);
    assert.ok(out !== null && !out.endsWith("/"), `unexpected output for ${input}: ${out}`);
  }
});
