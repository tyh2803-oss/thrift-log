-- Additive order operations. Existing financial basis, ledger, RLS and revision lock remain authoritative.
begin;
alter table public.orders add column "itemFulfillments" jsonb not null default '[]'::jsonb check(jsonb_typeof("itemFulfillments")='array'), add column "amountsConfirmed" boolean not null default false;
-- Keep the proven version-3 transaction intact behind a restricted, invoker-only wrapper.
alter function public.commit_workspace(uuid,bigint,jsonb) rename to commit_workspace_v3;
alter function public.commit_workspace_v3(uuid,bigint,jsonb) set schema thrift_log_private;
create function public.commit_workspace(p_user_id uuid,p_expected_revision bigint,p_payload jsonb) returns bigint language plpgsql security invoker set search_path='' as $$
declare revision bigint; entry jsonb; details jsonb; piece jsonb;
begin
 revision=thrift_log_private.commit_workspace_v3(p_user_id,p_expected_revision,p_payload);
 for entry in select value from jsonb_array_elements(p_payload->'orders') loop
  if entry ? 'itemFulfillments' then
   details=entry->'itemFulfillments';
   if jsonb_typeof(details)<>'array' or jsonb_array_length(details)>500 then raise exception 'invalid_item_fulfillment';end if;
   if jsonb_array_length(details)>0 then
    if entry->>'status'<>'Completed' or exists(select 1 from public.shipment_orders where user_id=p_user_id and order_id=(entry->>'id')::uuid) then raise exception 'item_fulfillment_conflict';end if;
    if (select count(*)<>count(distinct value->>'itemId') from jsonb_array_elements(details)) then raise exception 'duplicate_item_fulfillment';end if;
    for piece in select value from jsonb_array_elements(details) loop
     if not exists(select 1 from public.order_lines where user_id=p_user_id and order_id=(entry->>'id')::uuid and "itemId"=(piece->>'itemId')::uuid) or piece->>'status' not in ('Unfulfilled','Shipped','Delivered','Handed over') or piece->>'status' is null then raise exception 'invalid_item_fulfillment';end if;
     if (piece->>'status'='Unfulfilled' and piece->>'date' is not null) or (piece->>'date' is not null and ((piece->>'date')::timestamptz<(entry->>'date')::timestamptz or (piece->>'date')::timestamptz>now()+interval '5 minutes')) then raise exception 'invalid_fulfillment_date';end if;
    end loop;
    if entry->>'fulfillment' is distinct from (case
     when exists(select 1 from public.order_lines l where l.user_id=p_user_id and l.order_id=(entry->>'id')::uuid and not exists(select 1 from jsonb_array_elements(details) d where (d->>'itemId')::uuid=l."itemId" and d->>'status'<>'Unfulfilled')) then 'Unfulfilled'
     when not exists(select 1 from jsonb_array_elements(details) d where d->>'status'<>'Delivered') then 'Delivered' else 'Shipped' end) then raise exception 'fulfillment_rollup_mismatch';end if;
   end if;
   update public.orders set "itemFulfillments"=details where user_id=p_user_id and id=(entry->>'id')::uuid and "itemFulfillments" is distinct from details;
  end if;
  if entry ? 'amountsConfirmed' then
   if jsonb_typeof(entry->'amountsConfirmed')<>'boolean' then raise exception 'invalid_amount_confirmation';end if;
   update public.orders set "amountsConfirmed"=(entry->>'amountsConfirmed')::boolean where user_id=p_user_id and id=(entry->>'id')::uuid and "amountsConfirmed" is distinct from (entry->>'amountsConfirmed')::boolean;
  end if;
 end loop;
 return revision;
end;$$;
alter function public.verify_thrift_log() rename to verify_thrift_log_v3;
alter function public.verify_thrift_log_v3() set schema thrift_log_private;
create function public.verify_thrift_log() returns jsonb language sql security invoker set search_path='' as $$
 select thrift_log_private.verify_thrift_log_v3()||jsonb_build_object('schemaVersion',4,'itemFulfillment',
 (select count(*)=2 from information_schema.columns where table_schema='public' and table_name='orders' and column_name in ('itemFulfillments','amountsConfirmed')));
$$;
revoke all on function public.commit_workspace(uuid,bigint,jsonb),public.verify_thrift_log(),thrift_log_private.commit_workspace_v3(uuid,bigint,jsonb),thrift_log_private.verify_thrift_log_v3() from public,anon,authenticated;
grant execute on function public.commit_workspace(uuid,bigint,jsonb),public.verify_thrift_log(),thrift_log_private.commit_workspace_v3(uuid,bigint,jsonb),thrift_log_private.verify_thrift_log_v3() to service_role;
commit;
