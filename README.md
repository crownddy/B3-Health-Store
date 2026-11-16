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

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Supabase Authentication, create the first admin user.
4. In SQL Editor, promote that user (replace the email):

   ```sql
   insert into public.profiles (id, full_name, role)
   select id, 'B3 Super Admin', 'super_admin'
   from auth.users
   where email = 'YOUR_ADMIN_EMAIL'
   on conflict (id) do update set role = 'super_admin';
   ```

5. Add the project URL and publishable/anon key to `.env.local` and Vercel environment variables.

## Important security notes

- Never put the Supabase `service_role` secret in browser code or a `NEXT_PUBLIC_` variable.
- The SQL policies allow public reads only for products explicitly published to the homepage.
- Inventory write operations must be implemented behind authenticated Super Admin checks.
- Expiry alerts should be computed from `product_batches.expiration_date`, not from a single product-level date.
- Before production, add an authenticated admin interface, server-side validation, stock transaction workflows, scheduled expiry notifications, audit logs and automated tests.

## Deploy

Push this project to GitHub, import the repository into Vercel, and configure the two environment variables from `.env.example`.
