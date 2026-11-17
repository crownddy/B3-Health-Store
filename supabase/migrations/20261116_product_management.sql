-- B3 Health Store: product management
--
-- Adds the two columns product management needs that the original schema did
-- not have, and tightens the batch foreign key so history survives deletion.
-- Additive and idempotent: safe to re-run, and it does not drop or rewrite any
-- existing column, row or policy.
--
-- Run this in the Supabase SQL Editor against the existing project.

-- Lifecycle status. 'archived' products are kept for history and hidden from
-- the storefront instead of being deleted.
alter table public.products
  add column if not exists status text not null default 'active'
  check (status in ('active', 'archived'));

-- Barcode is optional and unique when present. NULLs are allowed and do not
-- collide, so products without a barcode are fine.
alter table public.products
  add column if not exists barcode text;

create unique index if not exists products_barcode_key
  on public.products (barcode)
  where barcode is not null;

create index if not exists products_status_idx
  on public.products (status);

-- Historical batch records must survive a product deletion, exactly like stock
-- movements. The original schema declared this foreign key ON DELETE CASCADE,
-- so removing a product silently destroyed its batch and expiry history. The
-- application already refuses the delete when batches exist; this makes the
-- database enforce the same rule so a forged or stale request cannot bypass it.
-- stock_movements.product_id is already ON DELETE RESTRICT, so both history
-- tables now agree.
alter table public.product_batches
  drop constraint if exists product_batches_product_id_fkey;
alter table public.product_batches
  add constraint product_batches_product_id_fkey
  foreign key (product_id) references public.products(id) on delete restrict;

-- A product that is archived must never be visible on the storefront, even if
-- its homepage flag is left on. This tightens the existing public read policy;
-- it does not change any other policy.
drop policy if exists "Public can view published products" on public.products;
create policy "Public can view published products"
on public.products for select
using (is_visible_on_homepage = true and status = 'active');
