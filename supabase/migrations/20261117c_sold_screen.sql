-- B3 Health Store: Sold screen support
--
-- Additive and idempotent: safe to re-run. It only creates/replaces two
-- read-only functions and their grants. It never drops, rewrites or deletes a
-- column, row or policy, so every existing product, batch and stock movement is
-- preserved.
--
-- Why: the Sold screen lists the products that can actually be sold and shows
-- how many units are sellable. "Sellable" is the same figure the stock-out
-- function already uses: units in batches that have not expired, plus any
-- legacy unbatched portion of the product total. Computing it here keeps one
-- definition, so the number the admin sees and the number the database will
-- deduct can never disagree (for example, a product whose only remaining stock
-- is expired shows zero and cannot be sold).
--
-- Recording a sale itself is NOT done here. It goes through the existing
-- record_stock_movement function (see 20261117b_atomic_inventory_operations.sql),
-- so FEFO deduction, expiry exclusion, history and concurrency guarantees are
-- all reused rather than reimplemented.
--
-- Security: both functions are SECURITY INVOKER and STABLE, so they run with
-- the caller's privileges and every table read is still governed by Row Level
-- Security. They only ever read; they cannot change stock. The service-role key
-- is not required and is never sent to the browser.

-- Sellable units for one product: the same rule record_stock_movement applies
-- when it validates a stock out.
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

  -- Only batches that have not expired (or carry no date) can be sold.
  select coalesce(sum(quantity_remaining), 0) into v_sellable
  from public.product_batches
  where product_id = p_product_id
    and quantity_remaining > 0
    and (expiration_date is null or expiration_date >= current_date);

  -- Legacy stock that is not yet batched is sellable too, so the figure never
  -- exceeds the product total.
  return least(v_total, v_sellable + greatest(0, v_total - v_batched));
end;
$$;

-- Paginated, searchable list of products that can be sold right now.
--
-- Returns jsonb { total, items: [{ id, name, quantity }] } so the total is
-- always reported, even when the requested page is past the end. Only active
-- products with a sellable quantity greater than zero are returned.
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

-- Only signed-in users may call these. Row Level Security still decides which
-- products and batches each caller can read, so staff see only what they are
-- already allowed to see.
revoke execute on function public.sellable_quantity(uuid) from public, anon;
revoke execute on function public.list_sellable_products(text, integer, integer) from public, anon;

grant execute on function public.sellable_quantity(uuid) to authenticated, service_role;
grant execute on function public.list_sellable_products(text, integer, integer) to authenticated, service_role;

-- Tell PostgREST to pick up the new functions. Without this, a project that is
-- already running would keep serving the old schema cache and the RPCs would
-- return 404 until it restarted. Harmless on a fresh database.
notify pgrst, 'reload schema';
