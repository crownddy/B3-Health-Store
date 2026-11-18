-- B3 Health Store: inventory query push-down
--
-- Additive and idempotent: safe to re-run. It only creates/replaces read-only
-- functions and one index. It never drops, rewrites or deletes a column, row or
-- policy, so every existing product, batch and stock movement is preserved.
--
-- Why: the Inventory screen used to load the whole catalogue (every product and
-- every batch) and then search, filter by expiration status and page in
-- application code. That cost grows with the catalogue even though one page
-- shows ten rows. These functions push that work into PostgreSQL so only the
-- requested page crosses the wire, while the totals stay exact.
--
-- Security: both functions are SECURITY INVOKER and STABLE. They run with the
-- caller's privileges and every table read is still governed by Row Level
-- Security, so the Super Admin / Staff split is unchanged. They only ever read;
-- they cannot change stock, batches or history. The service-role key is not
-- required and is never sent to the browser.

-- The Inventory list orders products newest-first. Index that access path so the
-- page and its total are served without sorting the whole table.
create index if not exists products_created_at_idx
  on public.products (created_at desc, id);

-- One page of the Inventory product list, with database-level search, expiration
-- filtering and pagination.
--
-- Returns jsonb { total, page, pages, items: [...] }. `total` is the number of
-- products matching the search and filter (not the page size), so the pager and
-- its counts stay correct. `page` is clamped into range, matching the previous
-- application behaviour where an out-of-range page fell back to the last page.
--
-- Each item carries the product fields the list renders plus:
--   * batch_count   — how many batches the product has (including emptied ones,
--                     which are history, not a current risk);
--   * expiry_status — the most urgent expiration status across the product's
--                     in-stock batches, using the same rule as the UI:
--                     expired > expiring_soon > valid > no_date. A product with
--                     no in-stock batches reads as no_date. Expiry is measured
--                     against current_date, the same clock the FEFO deduction and
--                     sellable_quantity use.
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

-- The dashboard figures, computed in the database.
--
-- The overview page only needs totals, five low-stock rows, five upcoming
-- expiries and the six latest movements, but it used to load every product and
-- every dated batch to derive them. This returns exactly what is displayed, with
-- the same definitions as before:
--   * low stock     — quantity > 0 and quantity <= minimum_stock;
--   * out of stock  — quantity <= 0;
--   * expiring soon — expires on/after today and within p_soon_days;
--   * expired       — expired before today.
-- Row Level Security still decides what each caller can count and read, so the
-- figures match the previous per-role behaviour.
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
    'totalProducts', (select count(*)::int from public.products),
    'visibleProducts', (select count(*)::int from public.products where is_visible_on_homepage),
    'totalCategories', (select count(*)::int from public.categories),
    'totalStaff', (select count(*)::int from public.profiles),
    'inventoryValue', (select coalesce(sum(selling_price * quantity), 0) from public.products),
    'stockUnits', (select coalesce(sum(quantity), 0)::int from public.products),
    'lowStockCount', (
      select count(*)::int from public.products
      where quantity > 0 and quantity <= minimum_stock
    ),
    'outOfStockCount', (
      select count(*)::int from public.products where quantity <= 0
    ),
    'expiringSoonCount', (
      select count(*)::int
      from public.product_batches b, cfg
      where b.expiration_date >= current_date
        and b.expiration_date <= current_date + cfg.soon_days
    ),
    'expiredCount', (
      select count(*)::int from public.product_batches
      where expiration_date < current_date
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
        where quantity > 0 and quantity <= minimum_stock
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
        select pb.* from public.product_batches pb, cfg
        where pb.expiration_date >= current_date
          and pb.expiration_date <= current_date + cfg.soon_days
        order by pb.expiration_date asc
        limit 5
      ) b
      left join public.products p on p.id = b.product_id
    ), '[]'::jsonb)
  );
$$;

-- A bounded page of batches for the Inventory "Batches & expiry" section.
--
-- That section used to load every batch in the store and filter it in app code.
-- This returns only the requested slice (most urgent expiry first) plus the
-- counts the header needs, so a large batch history never has to be shipped to
-- render a handful of rows. `total`/`expired`/`expiring_soon` are exact counts
-- over the whole table (under Row Level Security), independent of the slice.
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

-- Only signed-in users may call these. Row Level Security still decides which
-- products, batches and movements each caller can read.
revoke execute on function public.list_inventory_products(text, text, integer, integer, integer) from public, anon;
revoke execute on function public.list_inventory_batches(text, integer, integer, integer) from public, anon;
revoke execute on function public.dashboard_metrics(integer) from public, anon;

grant execute on function public.list_inventory_products(text, text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.list_inventory_batches(text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.dashboard_metrics(integer) to authenticated, service_role;

-- Tell PostgREST to pick up the new functions. Without this, a project that is
-- already running would keep serving the old schema cache and the RPCs would
-- return 404 until it restarted. Harmless on a fresh database.
notify pgrst, 'reload schema';
