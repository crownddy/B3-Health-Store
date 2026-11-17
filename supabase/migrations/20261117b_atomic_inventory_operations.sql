-- B3 Health Store: atomic inventory operations
--
-- Additive and idempotent: safe to re-run. It only creates/replaces functions
-- and grants; it never drops, rewrites or deletes a column, row or policy, so
-- every existing product, batch and stock movement is preserved.
--
-- Why: the server actions used to perform several separate writes (batch row,
-- stock movement, products.quantity). A failure between them could leave the
-- batch quantities, the movement history and the product total disagreeing.
-- These functions run the whole operation inside one transaction, so either
-- every write lands or none of them do.
--
-- Concurrency: each function takes a row lock (SELECT ... FOR UPDATE) on the
-- product and on the affected batches before it reads or writes a quantity.
-- Two simultaneous stock operations therefore serialise instead of overselling
-- or computing a total from stale data.
--
-- Authorization: the functions are SECURITY INVOKER, so they run with the
-- caller's privileges and Row Level Security still applies to every statement.
-- Because RLS *filters* rather than errors (an UPDATE a policy forbids simply
-- affects no rows), each function also checks the role itself and raises, so a
-- non-super-admin gets a hard failure instead of a silent no-op that would
-- report a bogus success. The service-role key is never involved and never
-- needs to be exposed to the browser.

-- Generates a batch number when the user does not supply one.
--
-- The number is date-stamped and made unique against the numbers already used
-- for the product, so a generated number never collides with an existing batch.
create or replace function public.generate_batch_number(
  p_product_id uuid,
  p_supplied text default null
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_supplied text := nullif(btrim(coalesce(p_supplied, '')), '');
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
begin
  -- Use the supplied number when it is free; otherwise (including a supplied
  -- number already used with a different expiry) generate a distinct one so an
  -- existing batch is never reused or overwritten.
  if v_supplied is not null and not exists (
    select 1 from public.product_batches
    where product_id = p_product_id and batch_number = v_supplied
  ) then
    return v_supplied;
  end if;

  v_base := 'B3-' || to_char(current_date, 'YYYYMMDD');
  v_candidate := v_base;
  while exists (
    select 1 from public.product_batches
    where product_id = p_product_id and batch_number = v_candidate
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix;
  end loop;
  return v_candidate;
end;
$$;

-- Creates a product and, when opening stock is supplied, its first batch, the
-- matching opening stock movement and the correct total quantity — all in one
-- transaction. If any step fails, the product is not created at all.
--
-- A quantity of zero/null means "no batch", exactly as before. The product's
-- quantity is never set directly by the caller: it starts at 0 and is only
-- raised through a recorded batch + movement.
create or replace function public.create_product_with_initial_stock(
  p_name text,
  p_description text,
  p_category text,
  p_sku text,
  p_barcode text,
  p_image_url text,
  p_purchase_price numeric,
  p_selling_price numeric,
  p_minimum_stock integer,
  p_shelf_number text,
  p_is_visible_on_homepage boolean,
  p_is_featured boolean,
  p_initial_quantity integer,
  p_initial_expiration_date date,
  p_initial_batch_number text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_product_id uuid;
  v_quantity integer := greatest(coalesce(p_initial_quantity, 0), 0);
  v_batch_number text;
  v_batch_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only Super Admins can change stock.' using errcode = '42501';
  end if;

  insert into public.products (
    name, description, category, sku, barcode, image_url,
    purchase_price, selling_price, quantity, minimum_stock, shelf_number,
    is_visible_on_homepage, is_featured
  )
  values (
    p_name, p_description, p_category, p_sku, p_barcode, p_image_url,
    coalesce(p_purchase_price, 0), coalesce(p_selling_price, 0), 0,
    coalesce(p_minimum_stock, 0), p_shelf_number,
    coalesce(p_is_visible_on_homepage, false), coalesce(p_is_featured, false)
  )
  returning id into v_product_id;

  if v_quantity > 0 then
    v_batch_number := public.generate_batch_number(v_product_id, p_initial_batch_number);

    insert into public.product_batches (
      product_id, batch_number, quantity_received, quantity_remaining, expiration_date
    )
    values (
      v_product_id, v_batch_number, v_quantity, v_quantity, p_initial_expiration_date
    )
    returning id into v_batch_id;

    insert into public.stock_movements (
      product_id, batch_id, movement_type, quantity, note, created_by
    )
    values (
      v_product_id, v_batch_id, 'stock_in', v_quantity, 'Opening stock', v_actor
    );

    update public.products
    set quantity = v_quantity, updated_at = now()
    where id = v_product_id;
  end if;

  return jsonb_build_object('product_id', v_product_id, 'batch_id', v_batch_id);
end;
$$;

-- Records a stock in, stock out or adjustment as a single transaction.
--
-- Stock in: each receipt carries its own expiration date. The receipt joins an
-- existing batch only when both the batch number and the expiration date match
-- (so a different batch never overwrites a stored expiry); otherwise a new
-- batch is created, with a generated number when none is supplied.
--
-- Stock out: FEFO — units come from the batch with the earliest valid
-- expiration date first, spanning several batches when needed. Expired batches
-- are never sold, batch quantities never go negative, and every movement is
-- recorded so history is preserved. Batch rows are only ever reduced, never
-- deleted.
--
-- Adjustment: records a movement and sets the exact on-hand figure without
-- rewriting batch rows, so batch history is left intact.
--
-- Returns jsonb: { product_id, quantity (new total), batch_number, movement_type }.
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
revoke execute on function public.generate_batch_number(uuid, text) from public, anon;
revoke execute on function public.create_product_with_initial_stock(
  text, text, text, text, text, text, numeric, numeric, integer, text, boolean, boolean, integer, date, text
) from public, anon;
revoke execute on function public.record_stock_movement(uuid, text, integer, text, text, date) from public, anon;

grant execute on function public.generate_batch_number(uuid, text) to authenticated, service_role;
grant execute on function public.create_product_with_initial_stock(
  text, text, text, text, text, text, numeric, numeric, integer, text, boolean, boolean, integer, date, text
) to authenticated, service_role;
grant execute on function public.record_stock_movement(uuid, text, integer, text, text, date) to authenticated, service_role;

-- Tell PostgREST to pick up the new functions. Without this, a project that is
-- already running would keep serving the old schema cache and the RPCs would
-- return 404 until it restarted. Harmless on a fresh database.
notify pgrst, 'reload schema';
