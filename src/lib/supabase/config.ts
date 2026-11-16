/**
 * Single source of truth for the Supabase connection settings.
 *
 * supabase-js appends the service path itself (`/auth/v1`, `/rest/v1`, …) to
 * whatever URL it is given. If `NEXT_PUBLIC_SUPABASE_URL` already ends in one of
 * those paths — which is easy to do by copying the REST endpoint out of the
 * Supabase dashboard instead of the project URL — every request is sent to a
 * doubled path and fails. Login then fails with a 404 that the UI reports as
 * "Invalid email address or password", which hides the real problem.
 *
 * Normalising here means a stray service path can never break authentication
 * again, while a correctly configured project URL is left untouched.
 */

const SERVICE_PATH = /\/(auth|rest|storage|realtime|functions|graphql)\/v1\/?$/i;

export function normalizeSupabaseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const stripped = trimmed.replace(SERVICE_PATH, "").replace(/\/+$/, "");
  return stripped || null;
}

export const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * True when the configured URL contained a service path that had to be removed.
 * Used only to surface a configuration warning in the admin settings screen.
 */
export const supabaseUrlWasNormalized =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) !==
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
