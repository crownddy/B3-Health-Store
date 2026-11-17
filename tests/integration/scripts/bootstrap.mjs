/**
 * Bootstraps the local integration database: role passwords, the app schema,
 * the product-management migration, test accounts and a small seed catalogue.
 *
 * Everything runs against the local compose stack only (see docker-compose.yml
 * and scripts/env.mjs, which refuses non-local targets).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { REPO_ROOT, loadKeys, resolveConfig } from "./env.mjs";
import { psql, psqlFile } from "./db.mjs";

const COMPOSE_FILE = join(REPO_ROOT, "tests", "integration", "docker-compose.yml");
const KEYS_FILE = join(REPO_ROOT, ".local-test", "keys.env");

function compose(args) {
  return spawnSync("docker", ["compose", "--env-file", KEYS_FILE, "-f", COMPOSE_FILE, ...args], {
    encoding: "utf8"
  });
}

/**
 * Wait until the database is stable. The image restarts Postgres during its
 * first-run init, so a single successful connection is not enough: require
 * several consecutive successes before treating it as ready.
 */
export async function waitForDb() {
  let consecutive = 0;
  for (let i = 0; i < 180; i++) {
    try {
      if (psql("select 1") === "1") {
        consecutive++;
        if (consecutive >= 3) return;
      } else {
        consecutive = 0;
      }
    } catch {
      consecutive = 0;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Database did not stabilise in time.");
}

/**
 * Wait until storage-api has finished its own schema migration. It adds the
 * `public` column to storage.buckets on first start; the app schema needs that
 * column to exist before it inserts the bucket row.
 */
export async function waitForStorage() {
  for (let i = 0; i < 90; i++) {
    const col = psql(
      "select count(*) from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='public'"
    );
    if (col === "1") return;
    if (i === 89) throw new Error("storage-api did not finish its schema migration in time.");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Point the auth/storage DB roles at the generated passwords before those services start. */
export function setRolePasswords() {
  const keys = loadKeys();
  psql(`alter user supabase_auth_admin with password '${keys.LOCAL_AUTH_DB_PASSWORD}';`);
  psql(`alter user supabase_storage_admin with password '${keys.LOCAL_STORAGE_DB_PASSWORD}';`);
}

/** Applies schema.sql then every migration in order, and grants the API roles access. */
export function applySchema() {
  psqlFile(join(REPO_ROOT, "supabase", "schema.sql"));
  const migrationsDir = join(REPO_ROOT, "supabase", "migrations");
  // Filenames are date-prefixed, so a plain sort applies them oldest first.
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    psqlFile(join(migrationsDir, file));
  }
  psql(`
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all tables in schema storage to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;
  `);
}

async function authAdminFetch(path, init, keys) {
  return fetch(`${keys.LOCAL_SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: keys.LOCAL_SERVICE_KEY,
      Authorization: `Bearer ${keys.LOCAL_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
}

/** Creates (or reuses) the two test accounts and gives them the right profile role. */
export async function createTestUsers() {
  const keys = loadKeys();
  const config = resolveConfig(keys);

  const accounts = [
    { ...config.superAdmin, role: "super_admin", name: "Super Admin" },
    { ...config.staff, role: "staff", name: "Staff Member" }
  ];

  const listResponse = await authAdminFetch("/admin/users", {}, keys);
  const listBody = await listResponse.json();
  const existing = new Map((listBody.users || []).map((u) => [u.email, u.id]));

  for (const account of accounts) {
    let id = existing.get(account.email);
    if (!id) {
      const created = await authAdminFetch(
        "/admin/users",
        {
          method: "POST",
          body: JSON.stringify({ email: account.email, password: account.password, email_confirm: true })
        },
        keys
      );
      const body = await created.json();
      if (!created.ok) throw new Error(`Failed to create ${account.email}: ${JSON.stringify(body)}`);
      id = body.id;
    }
    psql(
      `insert into public.profiles (id, full_name, role) values ('${id}', '${account.name}', '${account.role}')
       on conflict (id) do update set role = excluded.role;`
    );
  }
}

/** A tiny catalogue that exercises active, archived, low-stock and published states. */
export function seedData() {
  psql(`
    insert into public.products
      (name, category, sku, barcode, purchase_price, selling_price, quantity, minimum_stock, shelf_number, status, is_visible_on_homepage, is_featured)
    values
      ('Vitamin C 1000mg', 'Vitamins', 'VITC-1', '6151100111111', 5000, 8500, 18, 5, 'A1', 'active', true, true),
      ('Herbal Tea Blend', 'Wellness', 'TEA-1', null, 4000, 7200, 4, 6, 'B2', 'active', true, false),
      ('B-Complex', 'Vitamins', 'BCOMP-1', null, 8000, 12500, 0, 3, 'A2', 'active', false, false),
      ('Vitamin C', 'Vitamins', 'VIT-C', null, 100, 150, 0, 0, null, 'archived', true, false)
    on conflict (sku) do update set
      name = excluded.name,
      category = excluded.category,
      barcode = excluded.barcode,
      purchase_price = excluded.purchase_price,
      selling_price = excluded.selling_price,
      quantity = excluded.quantity,
      minimum_stock = excluded.minimum_stock,
      shelf_number = excluded.shelf_number,
      status = excluded.status,
      is_visible_on_homepage = excluded.is_visible_on_homepage,
      is_featured = excluded.is_featured;
  `);
}

export function isStackRunning() {
  const result = compose(["ps", "-q", "db"]);
  return result.status === 0 && result.stdout.trim().length > 0;
}
