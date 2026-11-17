#!/usr/bin/env node
/**
 * Generates the local-only keys the integration stack needs and writes them to
 * .local-test/keys.env (gitignored).
 *
 * Nothing here is a real secret: the JWT secret is a fixed local development
 * value and the anon/service keys are JWTs signed with it. They only ever talk
 * to 127.0.0.1. Regenerating overwrites the file.
 *
 * Usage: node tests/integration/scripts/generate-keys.mjs
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", ".local-test");
const outFile = join(outDir, "keys.env");

// Fixed local development secret. Not used anywhere outside this stack.
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
// Far-future expiry so a long test run never trips over token expiry.
const EXP = 1983812996;

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function signJwt(role) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: "supabase-demo", role, exp: EXP }));
  const body = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", JWT_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

// Reuse the existing random DB passwords across runs so a regenerated key file
// still matches an already-running stack; only mint new ones on first run.
let prior = {};
if (existsSync(outFile)) {
  for (const line of readFileSync(outFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) prior[m[1]] = m[2];
  }
}
const rand = (key) => prior[key] || randomBytes(12).toString("hex");

const values = {
  // Where the app and the Supabase services are reachable. Local only.
  LOCAL_SUPABASE_URL: prior.LOCAL_SUPABASE_URL || "http://127.0.0.1:54321",
  LOCAL_APP_URL: prior.LOCAL_APP_URL || "http://127.0.0.1:12000",

  LOCAL_JWT_SECRET: JWT_SECRET,
  LOCAL_ANON_KEY: signJwt("anon"),
  LOCAL_SERVICE_KEY: signJwt("service_role"),

  LOCAL_POSTGRES_PASSWORD: rand("LOCAL_POSTGRES_PASSWORD"),
  LOCAL_AUTH_DB_PASSWORD: rand("LOCAL_AUTH_DB_PASSWORD"),
  LOCAL_STORAGE_DB_PASSWORD: rand("LOCAL_STORAGE_DB_PASSWORD"),

  // Test accounts created in the local auth service.
  SUPER_ADMIN_EMAIL: "super@b3.test",
  SUPER_ADMIN_PASSWORD: "TestPass123!",
  STAFF_EMAIL: "staff@b3.test",
  STAFF_PASSWORD: "TestPass123!"
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

console.log(`Wrote ${outFile}`);
console.log("Local-only keys generated. This file is gitignored and must never be committed.");
