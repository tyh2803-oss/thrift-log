-- Additive, explicit purchase-cost corrections. Requires schema 6+.
-- Prepare only: do not apply to production without approval. Original order lines remain immutable.
begin;
alter table public.financial_events add column "costItemId" uuid;
alter table public.financial_events drop constraint financial_events_kind_check;
alter table public.financial_events add constraint financial_events_kind_check check(kind in('Refund','Fee adjustment','Revenue adjustment','Direct cost adjustment','Return','Reversal','Cost basis adjustment'));
do $$ declare c record;n integer:=0; begin
 for c in select conname from pg_catalog.pg_constraint where conrelid='public.financial_events'::regclass and contype='c'
  and pg_catalog.pg_get_constraintdef(oid) like '%amount%' and pg_catalog.pg_get_constraintdef(oid) like '%Return%' and pg_catalog.pg_get_constraintdef(oid) like '%Reversal%'
 loop execute format('alter table public.financial_events drop constraint %I',c.conname);n:=n+1;end loop;
 if n<>1 then raise exception 'financial_amount_constraint_not_recognized';end if;
end $$;
alter table public.financial_events add constraint financial_event_amounts check(
 (kind not in('Return','Reversal','Cost basis adjustment') and amount<>0) or
 (kind in('Return','Reversal') and amount=0) or kind='Cost basis adjustment');
alter table public.financial_events add constraint cost_item_kind check((kind='Cost basis adjustment')=("costItemId" is not null));
alter table public.financial_events add constraint cost_item_owned_sale foreign key(user_id,"orderId","costItemId") references public.order_lines(user_id,order_id,"itemId");
create function thrift_log_private.validate_cost_correction() returns trigger language plpgsql set search_path='' as $$
declare sale_date timestamptz; basis bigint;
begin
 if new.kind='Reversal' and exists(select 1 from public.financial_events e where e.user_id=new.user_id and e.id=new."reversesId" and e.kind='Cost basis adjustment') then raise exception 'correct_purchase_cost_with_new_adjustment';end if;
 if new.kind='Cost basis adjustment' then
  select o.date,l."costBasis" into sale_date,basis from public.order_lines l join public.orders o on o.user_id=l.user_id and o.id=l.order_id where l.user_id=new.user_id and l.order_id=new."orderId" and l."itemId"=new."costItemId";
  if not found or new.date is distinct from sale_date or new.amount not between -100000000 and 100000000 or new."reversesId" is not null then raise exception 'invalid_purchase_cost_correction';end if;
  if exists(select 1 from public.financial_event_returns r where r.user_id=new.user_id and r.event_id=new.id) then raise exception 'cost_correction_cannot_return_inventory';end if;
  select basis+new.amount+coalesce(sum(e.amount),0) into basis from public.financial_events e where e.user_id=new.user_id and e."orderId"=new."orderId" and e."costItemId"=new."costItemId" and e.id<>new.id;
  if basis<0 or basis>100000000 then raise exception 'invalid_corrected_purchase_cost';end if;
 end if;
 return new;
end $$;
revoke all on function thrift_log_private.validate_cost_correction() from public,anon,authenticated;
create trigger validate_cost_correction before insert on public.financial_events for each row execute function thrift_log_private.validate_cost_correction();
-- Add the nullable field to the established service-only transaction, preserving its
-- row lock, owner/beta wrappers, immutable-posting triggers and all existing checks.
do $$ declare sql text;before_sql text;begin
 sql=pg_catalog.pg_get_functiondef('thrift_log_private.commit_workspace_v3(uuid,bigint,jsonb)'::regprocedure);before_sql=sql;
 sql=replace(sql,'"reversesId",category) select p_user_id','"reversesId",category,"costItemId") select p_user_id');
 sql=replace(sql,'"reversesId",category from jsonb_populate_recordset','"reversesId",category,"costItemId" from jsonb_populate_recordset');
 sql=replace(sql,'category=excluded.category;','category=excluded.category,"costItemId"=excluded."costItemId";');
 if sql=before_sql or position('"costItemId"=excluded."costItemId"' in sql)=0 then raise exception 'cost_commit_function_not_recognized';end if;
 execute sql;
end $$;
-- Keep return allocations restricted to events which actually return physical pieces.
create function thrift_log_private.validate_return_event() returns trigger language plpgsql set search_path='' as $$begin
 if not exists(select 1 from public.financial_events e where e.user_id=new.user_id and e.id=new.event_id and e."orderId"=new.order_id and e.kind in('Refund','Return')) then raise exception 'event_cannot_return_inventory';end if;
 return new;
end $$;
revoke all on function thrift_log_private.validate_return_event() from public,anon,authenticated;
create trigger validate_return_event before insert on public.financial_event_returns for each row execute function thrift_log_private.validate_return_event();
create function public.purchase_costs_ready() returns boolean language sql security invoker set search_path='' as $$
 select (select relrowsecurity from pg_catalog.pg_class where oid='public.financial_events'::regclass)
 and exists(select 1 from pg_catalog.pg_constraint where conrelid='public.financial_events'::regclass and conname='cost_item_owned_sale')
 and exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.financial_events'::regclass and tgname='validate_cost_correction' and tgenabled='O');
$$;
revoke all on function public.purchase_costs_ready() from public,anon,authenticated;
grant execute on function public.purchase_costs_ready() to service_role;
commit;
