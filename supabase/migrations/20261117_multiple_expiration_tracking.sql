-- B3 Health Store: multiple expiration-date tracking (per-batch expiry)
--
-- Additive and idempotent: safe to re-run. It never drops, rewrites or deletes
-- an existing column, row or policy, so every existing product and batch record
-- is preserved. Run this in the Supabase SQL Editor against the existing
-- project, after supabase/schema.sql and 20261116_product_management.sql.
--
-- The application already stores stock against product_batches rows (one row
-- per receipt, each with its own expiration_date). This migration only adds the
-- indexes that make that workflow efficient and re-asserts the two guarantees
-- the FEFO workflow depends on.

-- FEFO (First Expired, First Out) reads a product's batches ordered by
-- expiration date, so index exactly that access path.
create index if not exists product_batches_product_expiry_idx
  on public.product_batches (product_id, expiration_date);

-- The expiry screens ask "which batches expire soon / have expired" across all
-- products, so index expiration_date on its own too.
create index if not exists product_batches_expiration_idx
  on public.product_batches (expiration_date);

-- Historical batch records must survive a product deletion. The 20261116
-- migration already tightened this foreign key to ON DELETE RESTRICT; this
-- re-asserts it so the guarantee holds on any project, however it was created.
-- Dropping and re-adding the same definition is idempotent.
alter table public.product_batches
  drop constraint if exists product_batches_product_id_fkey;
alter table public.product_batches
  add constraint product_batches_product_id_fkey
  foreign key (product_id) references public.products(id) on delete restrict;

-- A batch can never hold a negative quantity. The application refuses such a
-- deduction, and this CHECK makes it a database guarantee as well. Re-asserted
-- idempotently for projects created before the constraint was named.
alter table public.product_batches
  drop constraint if exists product_batches_quantity_remaining_check;
alter table public.product_batches
  add constraint product_batches_quantity_remaining_check
  check (quantity_remaining >= 0);

-- Staff can view inventory (they can already read products), but the original
-- schema only let super admins read product_batches. Add a read-only SELECT
-- policy for provisioned users so staff can see batch numbers, quantities and
-- expiry dates. It grants no write access: the super-admin "for all" policy
-- still governs inserts, updates and deletes.
drop policy if exists "Provisioned users can read batches" on public.product_batches;
create policy "Provisioned users can read batches"
on public.product_batches for select
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
  )
);
