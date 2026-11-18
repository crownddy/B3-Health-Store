/**
 * Recognising "this function does not exist yet" RPC errors.
 *
 * The admin reads are pushed down into Postgres functions added by a migration
 * (see supabase/migrations/20261119_inventory_query_pushdown.sql). A deployment
 * can go out before an operator has applied that migration — for example a
 * Vercel preview pointed at the existing project. PostgREST then answers the
 * call with PGRST202, "Could not find the function ... in the schema cache",
 * and a hard throw turns the whole page into a server-side exception.
 *
 * This only detects that one, specific condition so callers can fall back to a
 * slower but correct read. Any other error — a permission failure, a network
 * error, a bad argument — is NOT a missing function and must still surface.
 */

/** PostgREST's code for "no function matches this name/signature". */
const MISSING_FUNCTION_CODE = "PGRST202";

/**
 * PostgREST's wording for the same condition, used as a backstop for older
 * versions that may not set `code`. Kept narrow so a genuine "function raised
 * an exception" message can never match it.
 */
const MISSING_FUNCTION_MESSAGE = /could not find the function .* in the schema cache/i;

/** True when an error means the RPC function is not present in the database. */
export function isMissingRpcFunction(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === MISSING_FUNCTION_CODE) return true;
  return typeof message === "string" && MISSING_FUNCTION_MESSAGE.test(message);
}

/**
 * Logs a one-line warning when a read falls back because a migration has not
 * been applied. Deliberately visible: the fallback keeps the app working, but
 * the operator should still know the database-side query is not in use yet.
 */
export function warnMissingRpcFunction(fn: string, migration: string): void {
  console.warn(
    `[supabase] ${fn} is not in the database; using the slower application-side ` +
      `fallback. Apply ${migration} to enable the database-side query.`
  );
}
