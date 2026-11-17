-- B3 Health Store starter schema
-- Safe to run on a new Supabase project and safe to re-run: tables, the bucket
-- and every policy are created idempotently.
-- Run this in the Supabase SQL Editor. Create an Auth user for the first Super
-- Admin, then set that user's profile role to 'super_admin' (see README).

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'staff' check (role in ('staff', 'super_admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  sku text unique,
  barcode text,
  image_url text,
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  shelf_number text,
  status text not null default 'active' check (status in ('active', 'archived')),
  is_visible_on_homepage boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bring an existing project up to date. Additive and idempotent.
alter table public.products
  add column if not exists barcode text;
alter table public.products
  add column if not exists status text not null default 'active'
  check (status in ('active', 'archived'));

create unique index if not exists products_barcode_key
  on public.products (barcode)
  where barcode is not null;
create index if not exists products_status_idx
  on public.products (status);


create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  batch_number text,
  quantity_received integer not null default 0 check (quantity_received >= 0),
  quantity_remaining integer not null default 0 check (quantity_remaining >= 0),
  production_date date,
  expiration_date date,
  created_at timestamptz not null default now()
);

-- FEFO reads a product's batches ordered by expiration date; the expiry screens
-- read across all products by expiration date.
create index if not exists product_batches_product_expiry_idx
  on public.product_batches (product_id, expiration_date);
create index if not exists product_batches_expiration_idx
  on public.product_batches (expiration_date);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete set null,
  movement_type text not null check (movement_type in ('stock_in','stock_out','adjustment')),
  quantity integer not null check (quantity > 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Sellable units for a product: units in batches that have not expired, plus
-- any legacy unbatched portion of the product total. This is the same rule the
-- stock-out function applies, so the Sold screen and the deduction agree.
create or replace function public.sellable_quantity(p_product_id uuid)
returns integer
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_batched integer;
  v_sellable integer;
begin
  select quantity into v_total from public.products where id = p_product_id;
  if v_total is null then
    return 0;
  end if;

  select coalesce(sum(quantity_remaining), 0) into v_batched
  from public.product_batches
  where product_id = p_product_id;

  select coalesce(sum(quantity_remaining), 0) into v_sellable
  from public.product_batches
  where product_id = p_product_id
    and quantity_remaining > 0
    and (expiration_date is null or expiration_date >= current_date);

  return least(v_total, v_sellable + greatest(0, v_total - v_batched));
end;
$$;

-- Paginated, searchable list of products that can be sold right now. Only
-- active products with a sellable quantity greater than zero are returned.
create or replace function public.list_sellable_products(
  p_search text default null,
  p_limit integer default 8,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with sellable as (
    select p.id, p.name, public.sellable_quantity(p.id) as quantity
    from public.products p
    where p.status = 'active'
  ),
  filtered as (
    select * from sellable
    where quantity > 0
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or name ilike '%' || btrim(p_search) || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'quantity', quantity)
        order by name
      )
      from (
        select * from filtered
        order by name asc
        limit greatest(coalesce(p_limit, 8), 0)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_batches enable row level security;
alter table public.stock_movements enable row level security;

-- Public visitors can only read products explicitly published to the homepage.
-- Archived products are never public, even if the homepage flag is left on.
drop policy if exists "Public can view published products" on public.products;
create policy "Public can view published products"
on public.products for select
using (is_visible_on_homepage = true and status = 'active');

-- Super Admin policies. Do not expose the service-role key in the browser.
drop policy if exists "Super admin full access to products" on public.products;
create policy "Super admin full access to products"
on public.products for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "Super admin manage categories" on public.categories;
create policy "Super admin manage categories"
on public.categories for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "Super admin manage batches" on public.product_batches;
create policy "Super admin manage batches"
on public.product_batches for all
using (public.is_super_admin())
with check (public.is_super_admin());

-- Provisioned staff may read batches (inventory and expiry screens need the
-- batch number, quantity and expiration date). This grants no write access.
drop policy if exists "Provisioned users can read batches" on public.product_batches;
create policy "Provisioned users can read batches"
on public.product_batches for select
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "Super admin manage stock movements" on public.stock_movements;
create policy "Super admin manage stock movements"
on public.stock_movements for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "Super admin can manage profiles" on public.profiles;
create policy "Super admin can manage profiles"
on public.profiles for all
using (public.is_super_admin())
with check (public.is_super_admin());

-- Storage: create a public bucket named product-images in Supabase Storage.
-- Keep product images public, but restrict upload/update/delete to Super Admin
-- through Storage policies configured after the first admin profile is created.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
on storage.objects for select
using (bucket_id = 'product-images');

drop policy if exists "Super admin can upload product images" on storage.objects;
create policy "Super admin can upload product images"
on storage.objects for insert
with check (bucket_id = 'product-images' and public.is_super_admin());

drop policy if exists "Super admin can update product images" on storage.objects;
create policy "Super admin can update product images"
on storage.objects for update
using (bucket_id = 'product-images' and public.is_super_admin())
with check (bucket_id = 'product-images' and public.is_super_admin());

drop policy if exists "Super admin can delete product images" on storage.objects;
create policy "Super admin can delete product images"
on storage.objects for delete
using (bucket_id = 'product-images' and public.is_super_admin());
