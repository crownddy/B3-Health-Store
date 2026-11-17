/**
 * Runs SQL against the local integration database.
 *
 * Connects as supabase_admin using the generated LOCAL_POSTGRES_PASSWORD from
 * .local-test/keys.env, so no credential is hard-coded anywhere.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, loadKeys } from "./env.mjs";

const COMPOSE_FILE = join(REPO_ROOT, "tests", "integration", "docker-compose.yml");
const KEYS_FILE = join(REPO_ROOT, ".local-test", "keys.env");

function execPsql(args, input) {
  const keys = loadKeys();
  const result = spawnSync(
    "docker",
    [
      "compose", "--env-file", KEYS_FILE, "-f", COMPOSE_FILE,
      "exec", "-T", "-e", `PGPASSWORD=${keys.LOCAL_POSTGRES_PASSWORD}`,
      "db", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
      ...args
    ],
    { encoding: "utf8", input }
  );
  if (result.status !== 0) {
    throw new Error(`psql failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Runs a scalar query and returns the trimmed result. */
export function psql(sql) {
  return execPsql(["-tAc", sql]);
}

/** Runs a .sql file through psql. */
export function psqlFile(path) {
  return execPsql([], readFileSync(path, "utf8"));
}
