# AGENTS.md — B3 Health Store

Next.js 15 (App Router, React 19) + Supabase admin console and public catalogue.
Mobile-first. TypeScript strict. No CSS framework — hand-written CSS in
`src/app/globals.css` (storefront) and `src/app/admin.css` (admin console).

## Layout

- `src/app/page.tsx` — public storefront (client component, demo data fallback).
- `src/app/admin/(dashboard)/**` — admin console pages. `layout.tsx` calls
  `requireAdmin()` (server gate) and renders the sidebar/topbar.
- `src/components/admin/**` — admin UI (client components for interactivity).
- `src/lib/data.ts` — every read the admin screens use. Uses the request-scoped
  Supabase client, so Row Level Security applies to the signed-in user. The
  Inventory list and the dashboard read through the RPCs
  `list_inventory_products` / `list_inventory_batches` / `dashboard_metrics`
  (`20261119_inventory_query_pushdown.sql`) so search, expiry filtering, paging
  and the totals are computed in the database — never load the whole catalogue
  and filter in app code. A deployment can reach a database that does not have
  that migration yet (e.g. a Vercel preview pointed at the existing project), so
  these three reads fall back to the original application-side query when
  PostgREST reports the function is missing (`isMissingRpcFunction` in
  `src/lib/supabase/rpc.ts`). Only that specific "function not found" error
  falls back — every other error still throws.
- `src/lib/products/**` — pure, unit-testable helpers (expiry, stock, policy,
  validation, pagination). Server actions live next to their pages in
  `actions.ts` files.
- `supabase/schema.sql` + `supabase/migrations/*.sql` — all additive/idempotent.

## Key invariants (do not break)

- **Stock only changes through `record_stock_movement`** (stock in / out /
  adjustment) and `create_product_with_initial_stock`. Both are transactional
  RPCs in `20261117b_atomic_inventory_operations.sql`. Editing a product never
  touches `quantity`.
- **FEFO**: stock out takes from the batch with the earliest valid expiry first,
  spanning batches; expired batches are never sold; batch quantities never go
  negative; every movement is recorded (history preserved).
- **Deletes are restricted**: `product_batches.product_id` and
  `stock_movements.product_id` are `ON DELETE RESTRICT`. Never delete history to
  make a product deletable — archive instead (`canDeleteProduct`).
- **Authorization is server-side and doubled**: `requireAdmin()` /
  `requireSuperAdmin()` in server components + actions, *and* Postgres RLS /
  `is_super_admin()` in the RPCs. Staff are read-only. Never use the service-role
  key in browser code.
- Product read RLS: anon sees only published+active; staff see only what the
  "Provisioned users can read batches" policy allows for batches and the public
  product policy otherwise; super admin sees everything.

## Expiry

- `src/lib/products/batches.ts` is the single source of truth for expiry
  presentation logic. `EXPIRING_SOON_DAYS` is the warning threshold (4 months /
  ~120 days). `productExpiryStatus()` reduces a product's in-stock batches to one
  status: expired > expiring_soon > valid > no_date.
- The database uses `current_date` for the same rule inside `sellable_quantity`
  and the FEFO deduction, so the UI and the deduction agree.

## Commands

```bash
npm test                      # unit tests (node:test, no DB)
npx tsc --noEmit              # type-check
npm run build                 # production build
npm run test:integration:setup   # start + seed local Supabase (Docker)
npm run test:integration:rls
npm run test:integration:transactions
npm run test:integration:sold
npm run test:integration:inventory
npm run test:integration:e2e     # needs `npm run build` first
npm run test:integration:down
```

Integration suites are hard-wired to loopback (`tests/integration/scripts/env.mjs`)
and can never touch a hosted project. `npm run lint` is broken repo-wide
(ESLint 9 has no `eslint.config.js`) — pre-existing, not a change you introduced.

## Conventions

- URL-driven state for search/filter/pagination (shareable, back button works);
  reset `page` when the search or filter changes.
- Admin inputs are 14px on desktop but must be ≥16px on mobile (≤860px) so iOS
  Safari does not zoom on focus.
- Do not add `maximumScale`/`user-scalable=no` to the viewport.
