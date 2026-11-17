-- B3 Health Store: inventory management improvements
--
-- Additive and idempotent: safe to re-run. It never drops, rewrites or deletes
-- a column, row or policy, so every existing product, batch and stock movement
-- is preserved. Run it in the Supabase SQL Editor against the existing project,
-- after the earlier migrations in this directory.
--
-- The per-batch expiry workflow (one batch per receipt, each with its own
-- expiration_date, FEFO stock out) already exists and is unchanged. This
-- migration only adds the indexes the improved Inventory screens read through,
-- and re-asserts the guarantees those screens rely on.

-- The Inventory product-details page lists a single product's stock movement
-- history, newest first. Index that exact access path. `created_at desc` matches
-- the ORDER BY so the index can serve the query without a sort.
create index if not exists stock_movements_product_created_idx
  on public.stock_movements (product_id, created_at desc);

-- The Inventory list reduces a product's batches to one expiration status, so it
-- reads batches by product. The earlier migration already created
-- product_batches_product_expiry_idx for this; re-assert it here so the
-- guarantee holds on any project, however it was created.
create index if not exists product_batches_product_expiry_idx
  on public.product_batches (product_id, expiration_date);

-- Historical batch records must survive a product deletion, so a batch is never
-- a casualty of tidying up the catalogue. Re-assert ON DELETE RESTRICT
-- idempotently (dropping and re-adding the same definition is a no-op).
alter table public.product_batches
  drop constraint if exists product_batches_product_id_fkey;
alter table public.product_batches
  add constraint product_batches_product_id_fkey
  foreign key (product_id) references public.products(id) on delete restrict;

-- A batch can never hold a negative quantity. The application refuses such a
-- deduction; this CHECK makes it a database guarantee as well.
alter table public.product_batches
  drop constraint if exists product_batches_quantity_remaining_check;
alter table public.product_batches
  add constraint product_batches_quantity_remaining_check
  check (quantity_remaining >= 0);

-- Staff may read batches (added by the earlier migration) so they can see batch
-- numbers, quantities and expiry dates. This re-asserts that read-only policy;
-- it grants no write access — the super-admin "for all" policy still governs
-- inserts, updates and deletes, and Row Level Security still enforces the role.
drop policy if exists "Provisioned users can read batches" on public.product_batches;
create policy "Provisioned users can read batches"
on public.product_batches for select
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
  )
);
