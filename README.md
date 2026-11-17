# B3 Health Store

Mobile-first public product catalogue and inventory-management foundation for B3 Health Store.

## Included in this starter

- 3-second branded splash screen; no Get Started button.
- Public homepage with search, categories and product cards.
- Product details view.
- B3 Health Store logo asset.
- Supabase client configuration.
- Supabase SQL schema for products, categories, batches, stock movements and Super Admin role.
- Public homepage visibility control (`is_visible_on_homepage`).
- Product fields for purchase/selling price, stock, shelf number and batch production/expiry dates.
- Multiple expiration-date tracking: every stock receipt is its own batch with
  its own expiry, stock out follows FEFO, and inventory/expiry screens show and
  filter batches by expiration status.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local`.
3. Add your Supabase project URL and publishable/anon key.
4. Run:

   ```bash
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`.

If Supabase is not configured, the homepage uses clearly-labelled sample/demo products in memory. No demo data is written to a database.

## Tests

```bash
npm test                     # unit tests (no database needed)
```

Integration suites run against a real local Supabase stack (Docker). They cover
RLS/authorization and the admin console in a browser, and they are hard-wired to
local targets only. See [tests/integration/README.md](tests/integration/README.md)
for setup and run instructions.

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. If the project already has data, run the additive, idempotent migrations in
   `supabase/migrations/` in filename order. They are safe to re-run and never
   drop or rewrite existing products, batches or policies. In the SQL Editor,
   paste each file in turn:

   - `20261116_product_management.sql`
   - `20261117_multiple_expiration_tracking.sql`

4. In Supabase Authentication, create the first admin user.
5. In SQL Editor, promote that user (replace the email):

   ```sql
   insert into public.profiles (id, full_name, role)
   select id, 'B3 Super Admin', 'super_admin'
   from auth.users
   where email = 'YOUR_ADMIN_EMAIL'
   on conflict (id) do update set role = 'super_admin';
   ```

5. Add the project URL and publishable/anon key to `.env.local` and Vercel environment variables.

## Troubleshooting: "Invalid email address or password"

That message is shown for *any* sign-in failure, so it does not tell you whether
the password is wrong. Work through the causes in order:

1. **Is `NEXT_PUBLIC_SUPABASE_URL` the plain project URL?** It must be
   `https://<project-ref>.supabase.co`, with no `/rest/v1` or `/auth/v1` suffix.
   A suffix makes supabase-js request `/rest/v1/auth/v1/token`, which returns 404
   and is reported to the user as a bad password. After changing the variable in
   Vercel, **redeploy** — `NEXT_PUBLIC_*` values are baked in at build time.
2. **Does the account have a `profiles` row with `role = 'super_admin'`?**
   Without a profile, sign-in succeeds but admin access is refused.
3. **Is the email confirmed?** An unconfirmed account cannot use password sign-in.

A trailing service path in the URL is corrected automatically at runtime, and
the admin settings screen shows a warning when it had to be corrected. Fix the
variable in Vercel as well, so the configured value and the behaviour match.

## Important security notes

- Never put the Supabase `service_role` secret in browser code or a `NEXT_PUBLIC_` variable.
- The SQL policies allow public reads only for products explicitly published to the homepage.
- Inventory write operations must be implemented behind authenticated Super Admin checks.
- Expiry alerts should be computed from `product_batches.expiration_date`, not from a single product-level date.
- Before production, add an authenticated admin interface, server-side validation, stock transaction workflows, scheduled expiry notifications, audit logs and automated tests.

## Deploy

Push this project to GitHub, import the repository into Vercel, and configure the two environment variables from `.env.example`.
