-- B3 Health Store: product management
--
-- Adds the two columns product management needs that the original schema did
-- not have. Additive and idempotent: safe to re-run, and it does not drop or
-- rewrite any existing column, row or policy.
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

-- A product that is archived must never be visible on the storefront, even if
-- its homepage flag is left on. This tightens the existing public read policy;
-- it does not change any other policy.
drop policy if exists "Public can view published products" on public.products;
create policy "Public can view published products"
on public.products for select
using (is_visible_on_homepage = true and status = 'active');
