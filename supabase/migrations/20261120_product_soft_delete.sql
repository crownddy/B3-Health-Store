-- B3 Health Store: product deletion (soft delete for products with history)
--
-- Additive and idempotent: safe to re-run. It only adds a nullable column and an
-- index and replaces read-only functions and one writer (record_stock_movement).
-- It never drops a column, row, policy or history record, so every existing
-- product, batch and stock movement is preserved, and ON DELETE RESTRICT on
-- product_batches.product_id and stock_movements.product_id is untouched.
--
-- Why: deleting a product used to be refused outright as soon as it had any
-- batch or stock movement, so a product could never be removed from the active
-- catalogue once it had history. This migration adds a nullable `deleted_at`
-- marker so a product with history can be *soft deleted* — hidden from every
-- active screen while its batches, stock movements and audit trail stay in the
-- database. A product with no history is still hard deleted by the server
-- action (nothing to preserve), which this migration does not affect.
--
-- `deleted_at` is deliberately distinct from `status = 'archived'`:
--   * archived  — kept in the catalogue, shown under the "Archived" filter and
--                 restorable from the product page;
--   * deleted   — removed from the active list and from every selection,
--                 adjustment and sales screen, but still present in the table
--                 for history/audit.
-- Every read path below therefore excludes `deleted_at is not null`.

-- The soft-delete marker. Nullable, so every existing row is "not deleted".
alter table public.products
  add column if not exists deleted_at timestamptz;

-- The active-list queries filter on this column, so index it.
create index if not exists products_deleted_at_idx
  on public.products (deleted_at);

-- ---------------------------------------------------------------------------
-- Re-assert the read-only functions with deleted products excluded.
-- SECURITY INVOKER and STABLE are unchanged, so Row Level Security still
-- governs every read and the Super Admin / Staff split is untouched.
-- ---------------------------------------------------------------------------

-- The Inventory list: exclude soft-deleted products from the rows and the total.
create or replace function public.list_inventory_products(
  p_search text default null,
  p_expiry text default null,
  p_page integer default 0,
  p_page_size integer default 10,
  p_soon_days integer default 120
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with batch_agg as (
    select
      b.product_id,
      count(*)::int as batch_count,
      max(
        case
          when b.expiration_date is null then 0
          when b.expiration_date < current_date then 3
          when b.expiration_date <= current_date + greatest(coalesce(p_soon_days, 120), 0) then 2
          else 1
        end
      ) filter (where b.quantity_remaining > 0) as urgency
    from public.product_batches b
    group by b.product_id
  ),
  scored as (
    select
      p.id,
      p.name,
      p.category,
      p.image_url,
      p.quantity,
      p.minimum_stock,
      p.status,
      p.created_at,
      coalesce(ba.batch_count, 0) as batch_count,
      coalesce(ba.urgency, 0) as urgency
    from public.products p
    left join batch_agg ba on ba.product_id = p.id
    where p.deleted_at is null
  ),
  labelled as (
    select
      scored.*,
      case urgency
        when 3 then 'expired'
        when 2 then 'expiring_soon'
        when 1 then 'valid'
        else 'no_date'
      end as expiry_status
    from scored
  ),
  filtered as (
    select * from labelled
    where (
      nullif(btrim(coalesce(p_search, '')), '') is null
      or name ilike '%' || btrim(p_search) || '%'
    )
    and (
      nullif(btrim(coalesce(p_expiry, '')), '') is null
      or btrim(p_expiry) = 'all'
      or expiry_status = btrim(p_expiry)
    )
  ),
  counted as (
    select count(*)::int as total from filtered
  ),
  shaped as (
    select
      total,
      greatest(coalesce(p_page_size, 10), 1) as size,
      greatest(ceil(total::numeric / greatest(coalesce(p_page_size, 10), 1))::int, 1) as pages
    from counted
  ),
  placed as (
    select
      total,
      pages,
      size,
      least(greatest(coalesce(p_page, 0), 0), pages - 1) as page
    from shaped
  ),
  ranked as (
    select
      f.*,
      row_number() over (order by f.created_at desc, f.id) as rn
    from filtered f
  ),
  page_rows as (
    select r.*
    from ranked r
    cross join placed pl
    where r.rn > pl.page * pl.size
      and r.rn <= (pl.page + 1) * pl.size
  )
  select jsonb_build_object(
    'total', (select total from placed),
    'page', (select page from placed),
    'pages', (select pages from placed),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'name', pr.name,
          'category', pr.category,
          'image_url', pr.image_url,
          'quantity', pr.quantity,
          'minimum_stock', pr.minimum_stock,
          'status', pr.status,
          'batch_count', pr.batch_count,
          'expiry_status', pr.expiry_status
        )
        order by pr.rn
      )
      from page_rows pr
    ), '[]'::jsonb)
  );
$$;

-- The Inventory "Batches & expiry" slice: exclude batches of deleted products.
create or replace function public.list_inventory_batches(
  p_expiry text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_soon_days integer default 120
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with classified as (
    select
      b.id,
      b.batch_number,
      b.expiration_date,
      b.quantity_remaining,
      p.name as product_name,
      case
        when b.expiration_date is null then 'no_date'
        when b.expiration_date < current_date then 'expired'
        when b.expiration_date <= current_date + greatest(coalesce(p_soon_days, 120), 0) then 'expiring_soon'
        else 'valid'
      end as expiry_status
    from public.product_batches b
    left join public.products p on p.id = b.product_id
    where p.deleted_at is null
  ),
  filtered as (
    select * from classified
    where (
      nullif(btrim(coalesce(p_expiry, '')), '') is null
      or btrim(p_expiry) = 'all'
      or expiry_status = btrim(p_expiry)
    )
  )
  select jsonb_build_object(
    'total', (select count(*)::int from filtered),
    'expired', (select count(*)::int from classified where expiry_status = 'expired'),
    'expiring_soon', (select count(*)::int from classified where expiry_status = 'expiring_soon'),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'batch_number', f.batch_number,
          'expiration_date', f.expiration_date,
          'quantity_remaining', f.quantity_remaining,
          'product_name', f.product_name
        )
        order by f.expiration_date asc nulls last, f.id
      )
      from (
        select * from filtered
        order by expiration_date asc nulls last, id
        limit greatest(coalesce(p_limit, 50), 0)
        offset greatest(coalesce(p_offset, 0), 0)
      ) f
    ), '[]'::jsonb)
  );
$$;

-- The dashboard figures: counts and current stock exclude deleted products. The
-- recent-movements feed is deliberately left as-is — it is an audit/history feed,
-- so movements of a deleted product stay visible.
create or replace function public.dashboard_metrics(
  p_soon_days integer default 120
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select greatest(coalesce(p_soon_days, 120), 0) as soon_days
  )
  select jsonb_build_object(
    'totalProducts', (select count(*)::int from public.products where deleted_at is null),
    'visibleProducts', (
      select count(*)::int from public.products
      where is_visible_on_homepage and deleted_at is null
    ),
    'totalCategories', (select count(*)::int from public.categories),
    'totalStaff', (select count(*)::int from public.profiles),
    'inventoryValue', (
      select coalesce(sum(selling_price * quantity), 0) from public.products
      where deleted_at is null
    ),
    'stockUnits', (
      select coalesce(sum(quantity), 0)::int from public.products where deleted_at is null
    ),
    'lowStockCount', (
      select count(*)::int from public.products
      where deleted_at is null and quantity > 0 and quantity <= minimum_stock
    ),
    'outOfStockCount', (
      select count(*)::int from public.products
      where deleted_at is null and quantity <= 0
    ),
    'expiringSoonCount', (
      select count(*)::int
      from public.product_batches b
      join public.products p on p.id = b.product_id, cfg
      where p.deleted_at is null
        and b.expiration_date >= current_date
        and b.expiration_date <= current_date + cfg.soon_days
    ),
    'expiredCount', (
      select count(*)::int
      from public.product_batches b
      join public.products p on p.id = b.product_id
      where p.deleted_at is null and b.expiration_date < current_date
    ),
    'recentMovements', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'movement_type', m.movement_type,
          'quantity', m.quantity,
          'note', m.note,
          'created_at', m.created_at,
          'products', case when p.id is null then null else jsonb_build_object('name', p.name) end
        )
        order by m.created_at desc
      )
      from (
        select * from public.stock_movements
        order by created_at desc
        limit 6
      ) m
      left join public.products p on p.id = m.product_id
    ), '[]'::jsonb),
    'lowStockProducts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'quantity', p.quantity,
          'minimum_stock', p.minimum_stock,
          'shelf_number', p.shelf_number
        )
        order by p.created_at desc, p.id
      )
      from (
        select * from public.products
        where deleted_at is null and quantity > 0 and quantity <= minimum_stock
        order by created_at desc, id
        limit 5
      ) p
    ), '[]'::jsonb),
    'expiringBatches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'batch_number', b.batch_number,
          'expiration_date', b.expiration_date,
          'quantity_remaining', b.quantity_remaining,
          'products', case when p.id is null then null else jsonb_build_object('name', p.name) end
        )
        order by b.expiration_date asc
      )
      from (
        select pb.* from public.product_batches pb
        join public.products p on p.id = pb.product_id, cfg
        where p.deleted_at is null
          and pb.expiration_date >= current_date
          and pb.expiration_date <= current_date + cfg.soon_days
        order by pb.expiration_date asc
        limit 5
      ) b
      left join public.products p on p.id = b.product_id
    ), '[]'::jsonb)
  );
$$;

-- The Sold screen list: a deleted product must never be offered for sale.
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
    where p.status = 'active' and p.deleted_at is null
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

-- ---------------------------------------------------------------------------
-- Guard the stock writer: a deleted product must not be adjustable even if a
-- forged request reaches the function directly. Everything else in the function
-- is unchanged (atomic, row-locked, FEFO, history preserved).
-- ---------------------------------------------------------------------------
create or replace function public.record_stock_movement(
  p_product_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_note text default null,
  p_batch_number text default null,
  p_expiration_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_quantity integer := p_quantity;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_batch public.product_batches%rowtype;
  v_batch_found boolean := false;
  v_batch_id uuid;
  v_row_batch_id uuid;
  v_row_remaining integer;
  v_remaining integer;
  v_deduction integer;
  v_sellable integer;
  v_unbatched integer;
  v_available integer;
  v_next integer;
begin
  if v_actor is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only Super Admins can change stock.' using errcode = '42501';
  end if;

  if p_movement_type not in ('stock_in', 'stock_out', 'adjustment') then
    raise exception 'Select a valid movement type.' using errcode = '22023';
  end if;

  if v_quantity is null or v_quantity <= 0 then
    raise exception 'Quantity must be a whole number greater than zero.' using errcode = '22023';
  end if;

  -- Lock the product row: concurrent stock operations on the same product now
  -- queue here instead of both reading the same starting quantity.
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'That product could not be found.' using errcode = 'P0002';
  end if;

  -- A deleted product is out of the catalogue: refuse to touch its stock so it
  -- can never reappear through a stock adjustment.
  if v_product.deleted_at is not null then
    raise exception 'That product has been deleted.' using errcode = 'P0002';
  end if;

  if p_movement_type = 'stock_in' then
    -- Join an existing batch only when the number AND the expiry both match.
    if v_batch_number is not null then
      select * into v_batch
      from public.product_batches
      where product_id = p_product_id
        and btrim(batch_number) = v_batch_number
        and expiration_date is not distinct from p_expiration_date
      order by created_at
      limit 1
      for update;
      v_batch_found := found;
    end if;

    if v_batch_found then
      -- Top up the quantities; the expiration date is deliberately untouched.
      update public.product_batches
      set quantity_received = quantity_received + v_quantity,
          quantity_remaining = quantity_remaining + v_quantity
      where id = v_batch.id
      returning id into v_batch_id;
    else
      v_batch_number := public.generate_batch_number(p_product_id, p_batch_number);
      insert into public.product_batches (
        product_id, batch_number, quantity_received, quantity_remaining, expiration_date
      )
      values (
        p_product_id, v_batch_number, v_quantity, v_quantity, p_expiration_date
      )
      returning id into v_batch_id;
    end if;

    insert into public.stock_movements (
      product_id, batch_id, movement_type, quantity, note, created_by
    )
    values (p_product_id, v_batch_id, 'stock_in', v_quantity, v_note, v_actor);

    update public.products
    set quantity = quantity + v_quantity, updated_at = now()
    where id = p_product_id
    returning quantity into v_next;

    return jsonb_build_object(
      'product_id', p_product_id,
      'quantity', v_next,
      'batch_number', v_batch_number,
      'movement_type', 'stock_in'
    );
  end if;

  if p_movement_type = 'stock_out' then
    -- Sellable stock is every batch with units left that is not expired, plus
    -- any legacy unbatched portion of the product total.
    select coalesce(sum(quantity_remaining), 0) into v_sellable
    from public.product_batches
    where product_id = p_product_id
      and quantity_remaining > 0
      and (expiration_date is null or expiration_date >= current_date);

    select greatest(
      0,
      v_product.quantity - coalesce((
        select sum(quantity_remaining) from public.product_batches
        where product_id = p_product_id
      ), 0)
    ) into v_unbatched;

    v_available := least(v_product.quantity, v_sellable + v_unbatched);
    if v_quantity > v_available then
      raise exception 'Only % unit(s) are available to sell.', v_available using errcode = 'P0001';
    end if;

    v_remaining := v_quantity;
    -- FEFO: earliest expiration first, undated batches last. FOR UPDATE locks
    -- every batch this deduction may touch.
    for v_row_batch_id, v_row_remaining in
      select id, quantity_remaining
      from public.product_batches
      where product_id = p_product_id
        and quantity_remaining > 0
        and (expiration_date is null or expiration_date >= current_date)
      order by expiration_date asc nulls last, id
      for update
    loop
      exit when v_remaining <= 0;

      v_deduction := least(v_row_remaining, v_remaining);
      update public.product_batches
      set quantity_remaining = quantity_remaining - v_deduction
      where id = v_row_batch_id;

      insert into public.stock_movements (
        product_id, batch_id, movement_type, quantity, note, created_by
      )
      values (p_product_id, v_row_batch_id, 'stock_out', v_deduction, v_note, v_actor);

      v_remaining := v_remaining - v_deduction;
    end loop;

    -- Any shortfall comes from the unbatched portion, recorded with no batch.
    if v_remaining > 0 then
      insert into public.stock_movements (
        product_id, batch_id, movement_type, quantity, note, created_by
      )
      values (p_product_id, null, 'stock_out', v_remaining, v_note, v_actor);
    end if;

    update public.products
    set quantity = greatest(0, quantity - v_quantity), updated_at = now()
    where id = p_product_id
    returning quantity into v_next;

    return jsonb_build_object(
      'product_id', p_product_id,
      'quantity', v_next,
      'batch_number', null,
      'movement_type', 'stock_out'
    );
  end if;

  -- Adjustment: set the exact on-hand figure, recording a movement but leaving
  -- batch rows untouched so batch history survives.
  insert into public.stock_movements (
    product_id, movement_type, quantity, note, created_by
  )
  values (p_product_id, 'adjustment', v_quantity, v_note, v_actor);

  update public.products
  set quantity = v_quantity, updated_at = now()
  where id = p_product_id
  returning quantity into v_next;

  return jsonb_build_object(
    'product_id', p_product_id,
    'quantity', v_next,
    'batch_number', null,
    'movement_type', 'adjustment'
  );
end;
$$;

-- Only signed-in users may call these. Row Level Security still decides whether
-- the writes inside them are permitted, so this is an extra door, not the only
-- one. The service-role key is not required and is never sent to the browser.
revoke execute on function public.list_inventory_products(text, text, integer, integer, integer) from public, anon;
revoke execute on function public.list_inventory_batches(text, integer, integer, integer) from public, anon;
revoke execute on function public.dashboard_metrics(integer) from public, anon;
revoke execute on function public.list_sellable_products(text, integer, integer) from public, anon;
revoke execute on function public.record_stock_movement(uuid, text, integer, text, text, date) from public, anon;

grant execute on function public.list_inventory_products(text, text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.list_inventory_batches(text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.dashboard_metrics(integer) to authenticated, service_role;
grant execute on function public.list_sellable_products(text, integer, integer) to authenticated, service_role;
grant execute on function public.record_stock_movement(uuid, text, integer, text, text, date) to authenticated, service_role;

-- Tell PostgREST to pick up the new column and functions. Without this, a
-- project that is already running would keep serving the old schema cache.
-- Harmless on a fresh database.
notify pgrst, 'reload schema';
