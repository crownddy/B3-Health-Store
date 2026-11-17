/**
 * Shared configuration + safety guard for the integration suites.
 *
 * Every suite loads its targets through here so a single check can guarantee
 * the run can only ever touch a local Supabase instance. If any target host is
 * not local, the process exits before a request is made.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..", "..");
export const KEYS_FILE = join(REPO_ROOT, ".local-test", "keys.env");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

export function loadKeys() {
  if (!existsSync(KEYS_FILE)) {
    throw new Error(
      `Missing ${KEYS_FILE}. Run "npm run test:integration:keys" first.`
    );
  }
  const env = {};
  for (const line of readFileSync(KEYS_FILE, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/** Throws unless the URL points at a loopback host. */
export function assertLocalUrl(label, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`${label} is not a valid URL: ${url}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run integration tests against a non-local target.\n` +
        `  ${label} = ${url}\n` +
        `Integration tests may only target 127.0.0.1 / localhost.`
    );
  }
  return url;
}

/**
 * Resolves every target the suites use and asserts they are all local.
 * Returns the resolved config.
 */
export function resolveConfig(keys = loadKeys()) {
  const supabaseUrl = assertLocalUrl("LOCAL_SUPABASE_URL", keys.LOCAL_SUPABASE_URL);
  const appUrl = assertLocalUrl("LOCAL_APP_URL", keys.LOCAL_APP_URL);

  return {
    supabaseUrl,
    appUrl,
    anonKey: keys.LOCAL_ANON_KEY,
    serviceKey: keys.LOCAL_SERVICE_KEY,
    superAdmin: { email: keys.SUPER_ADMIN_EMAIL, password: keys.SUPER_ADMIN_PASSWORD },
    staff: { email: keys.STAFF_EMAIL, password: keys.STAFF_PASSWORD }
  };
}
