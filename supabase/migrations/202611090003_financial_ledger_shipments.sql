-- Additive financial ledger and fulfillment storage. Never rewrites existing migrations or records.
begin;
create schema if not exists thrift_log_private;
revoke all on schema thrift_log_private from public,anon,authenticated;
grant usage on schema thrift_log_private to service_role;
alter function public.load_workspace(uuid) set schema thrift_log_private;
alter function public.commit_workspace(uuid,bigint,jsonb) set schema thrift_log_private;
alter function public.verify_thrift_log() set schema thrift_log_private;
create or replace function thrift_log_private.commit_workspace(p_user_id uuid,p_expected_revision bigint,p_payload jsonb) returns bigint language plpgsql security invoker set search_path=public as $$
declare current_revision bigint; order_record jsonb;
begin
 insert into public.workspaces(user_id) values(p_user_id) on conflict do nothing;
 select revision into current_revision from public.workspaces where user_id=p_user_id for update;
 if current_revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
 insert into public.imports(user_id,id, filename, kind, "importedAt", "rawCsv", mapping, "recordIds")
 select p_user_id,id, filename, kind, "importedAt", "rawCsv", mapping, "recordIds" from jsonb_populate_recordset(null::public.imports,p_payload->'imports')
 on conflict(user_id,id) do update set filename=excluded.filename, kind=excluded.kind, "importedAt"=excluded."importedAt", "rawCsv"=excluded."rawCsv", mapping=excluded.mapping, "recordIds"=excluded."recordIds";
 insert into public.locations(user_id,id, name, address, latitude, longitude)
 select p_user_id,id, name, address, latitude, longitude from jsonb_populate_recordset(null::public.locations,p_payload->'locations')
 on conflict(user_id,id) do update set name=excluded.name, address=excluded.address, latitude=excluded.latitude, longitude=excluded.longitude;
 insert into public.trips(user_id,id, "locationId", name, date, "totalSpent", notes)
 select p_user_id,id, "locationId", name, date, "totalSpent", notes from jsonb_populate_recordset(null::public.trips,p_payload->'trips')
 on conflict(user_id,id) do update set "locationId"=excluded."locationId", name=excluded.name, date=excluded.date, "totalSpent"=excluded."totalSpent", notes=excluded.notes;
 insert into public.shows(user_id,id, name, date, type, status, notes, "externalId", checklist, lineup, "durationMinutes")
 select p_user_id,id, name, date, type, status, notes, "externalId", checklist, lineup, "durationMinutes" from jsonb_populate_recordset(null::public.shows,p_payload->'shows')
 on conflict(user_id,id) do update set name=excluded.name, date=excluded.date, type=excluded.type, status=excluded.status, notes=excluded.notes, "externalId"=excluded."externalId", checklist=excluded.checklist, lineup=excluded.lineup, "durationMinutes"=excluded."durationMinutes";
 insert into public.items(user_id,id, sku, title, brand, category, size, color, condition, description, cost, asking, "purchasedAt", source, storage, notes, status, "tripId", photos, "createdAt")
 select p_user_id,id, sku, title, brand, category, size, color, condition, description, cost, asking, "purchasedAt", source, storage, notes, status, "tripId", photos, "createdAt" from jsonb_populate_recordset(null::public.items,p_payload->'items')
 on conflict(user_id,id) do update set sku=excluded.sku, title=excluded.title, brand=excluded.brand, category=excluded.category, size=excluded.size, color=excluded.color, condition=excluded.condition, description=excluded.description, cost=excluded.cost, asking=excluded.asking, "purchasedAt"=excluded."purchasedAt", source=excluded.source, storage=excluded.storage, notes=excluded.notes, status=excluded.status, "tripId"=excluded."tripId", photos=excluded.photos, "createdAt"=excluded."createdAt";
 insert into public.listings(user_id,id, "itemId", marketplace, price, "originalPrice", "externalId", url, "listedAt", status, format, "lastSync")
 select p_user_id,id, "itemId", marketplace, price, "originalPrice", "externalId", url, "listedAt", status, format, "lastSync" from jsonb_populate_recordset(null::public.listings,p_payload->'listings')
 on conflict(user_id,id) do update set "itemId"=excluded."itemId", marketplace=excluded.marketplace, price=excluded.price, "originalPrice"=excluded."originalPrice", "externalId"=excluded."externalId", url=excluded.url, "listedAt"=excluded."listedAt", status=excluded.status, format=excluded.format, "lastSync"=excluded."lastSync";
 insert into public.orders(user_id,id, marketplace, "externalId", date, "showId", discount, "shippingCollected", fees, processing, shipping, packaging, other, refund, "feeCredit", adjustment, tips, type, status, fulfillment, payout, provenance, "importKey")
 select p_user_id,id, marketplace, "externalId", date, "showId", discount, "shippingCollected", fees, processing, shipping, packaging, other, refund, "feeCredit", adjustment, tips, type, status, fulfillment, payout, provenance, "importKey" from jsonb_populate_recordset(null::public.orders,p_payload->'orders')
 on conflict(user_id,id) do update set marketplace=excluded.marketplace, "externalId"=excluded."externalId", date=excluded.date, "showId"=excluded."showId", discount=excluded.discount, "shippingCollected"=excluded."shippingCollected", fees=excluded.fees, processing=excluded.processing, shipping=excluded.shipping, packaging=excluded.packaging, other=excluded.other, refund=excluded.refund, "feeCredit"=excluded."feeCredit", adjustment=excluded.adjustment, tips=excluded.tips, type=excluded.type, status=excluded.status, fulfillment=excluded.fulfillment, payout=excluded.payout, provenance=excluded.provenance, "importKey"=excluded."importKey";
 insert into public.expenses(user_id,id, title, category, amount, date, "showId", "tripId")
 select p_user_id,id, title, category, amount, date, "showId", "tripId" from jsonb_populate_recordset(null::public.expenses,p_payload->'expenses')
 on conflict(user_id,id) do update set title=excluded.title, category=excluded.category, amount=excluded.amount, date=excluded.date, "showId"=excluded."showId", "tripId"=excluded."tripId";
 insert into public.sessions(user_id,id, category, subcategory, notes, "showId", "tripId", "locationId", segments, state)
 select p_user_id,id, category, subcategory, notes, "showId", "tripId", "locationId", segments, state from jsonb_populate_recordset(null::public.sessions,p_payload->'sessions')
 on conflict(user_id,id) do update set category=excluded.category, subcategory=excluded.subcategory, notes=excluded.notes, "showId"=excluded."showId", "tripId"=excluded."tripId", "locationId"=excluded."locationId", segments=excluded.segments, state=excluded.state;

 for order_record in select value from jsonb_array_elements(p_payload->'orders') loop
  insert into public.order_lines(user_id,order_id,"itemId",price,"costBasis")
  select p_user_id,(order_record->>'id')::uuid,"itemId",price,"costBasis" from jsonb_populate_recordset(null::public.order_lines,order_record->'lines')
  on conflict(user_id,order_id,"itemId") do update set price=excluded.price;
 end loop;
 update public.workspaces set revision=current_revision+1,settings=p_payload->'settings' where user_id=p_user_id;
 return current_revision+1;
end; $$;
create table public.financial_events(user_id uuid not null references auth.users(id),id uuid, "orderId" uuid not null, date timestamptz not null, kind text not null check(kind in ('Refund','Fee adjustment','Revenue adjustment','Direct cost adjustment','Return','Reversal')), amount bigint not null, reason text not null, "externalId" text not null, "reversesId" uuid, category text not null check(category in ('Shipping','Packaging','Other')),primary key(user_id,id));
create table public.payouts(user_id uuid not null references auth.users(id),id uuid, marketplace text not null, date timestamptz not null, reference text not null, amount bigint not null check(amount>0), notes text not null, "reversalOf" uuid,primary key(user_id,id));
create table public.shipments(user_id uuid not null references auth.users(id),id uuid, marketplace text not null, date timestamptz not null, carrier text not null, tracking text not null, status text not null check(status in ('Preparing','Shipped','Delivered')), "labelCost" bigint not null check("labelCost">=0), notes text not null, "allocatedShipping" boolean not null,primary key(user_id,id));

alter table public.financial_events add unique(user_id,id,"orderId"), add foreign key(user_id,"orderId") references public.orders(user_id,id), add foreign key(user_id,"reversesId","orderId") references public.financial_events(user_id,id,"orderId");
alter table public.financial_events add check((kind='Reversal')=("reversesId" is not null)), add check((kind not in ('Return','Reversal') and amount<>0) or (kind in ('Return','Reversal') and amount=0)), add check(kind<>'Refund' or amount>0);
alter table public.payouts add foreign key(user_id,"reversalOf") references public.payouts(user_id,id);
create unique index financial_external_ids on public.financial_events(user_id,"orderId","externalId") where "externalId"<>'';
create unique index one_event_reversal on public.financial_events(user_id,"reversesId") where "reversesId" is not null;
create unique index payout_references on public.payouts(user_id,marketplace,reference) where "reversalOf" is null;
create unique index one_payout_reversal on public.payouts(user_id,"reversalOf") where "reversalOf" is not null;
create index financial_event_dates on public.financial_events(user_id,date);
create table public.financial_event_returns(user_id uuid not null,event_id uuid not null,order_id uuid not null,"itemId" uuid not null,primary key(user_id,event_id,"itemId"),foreign key(user_id,event_id,order_id) references public.financial_events(user_id,id,"orderId"),foreign key(user_id,order_id,"itemId") references public.order_lines(user_id,order_id,"itemId"));
create table public.payout_allocations(user_id uuid not null,payout_id uuid not null,"orderId" uuid not null,amount bigint not null check(amount>0),primary key(user_id,payout_id,"orderId"),foreign key(user_id,payout_id) references public.payouts(user_id,id),foreign key(user_id,"orderId") references public.orders(user_id,id));
create table public.shipment_orders(user_id uuid not null,shipment_id uuid not null,order_id uuid not null,primary key(user_id,shipment_id,order_id),unique(user_id,order_id),foreign key(user_id,shipment_id) references public.shipments(user_id,id),foreign key(user_id,order_id) references public.orders(user_id,id));
create function thrift_log_private.immutable_posting() returns trigger language plpgsql set search_path='' as $$begin
 if TG_OP='DELETE' then raise exception 'posted_record_immutable'; end if;
 if to_jsonb(old) is distinct from to_jsonb(new) then raise exception 'posted_record_immutable'; end if;
 return new;
end;$$;
alter table public.financial_events enable row level security;
revoke all on public.financial_events from public,anon,authenticated;
grant select on public.financial_events to authenticated;
grant select,insert,update on public.financial_events to service_role;
create policy owner_read on public.financial_events for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_posting before update or delete on public.financial_events for each row execute function thrift_log_private.immutable_posting();
alter table public.payouts enable row level security;
revoke all on public.payouts from public,anon,authenticated;
grant select on public.payouts to authenticated;
grant select,insert,update on public.payouts to service_role;
create policy owner_read on public.payouts for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_posting before update or delete on public.payouts for each row execute function thrift_log_private.immutable_posting();
alter table public.shipments enable row level security;
revoke all on public.shipments from public,anon,authenticated;
grant select on public.shipments to authenticated;
grant select,insert,update on public.shipments to service_role;
create policy owner_read on public.shipments for select to authenticated using(user_id=(select auth.uid()));
alter table public.financial_event_returns enable row level security;
revoke all on public.financial_event_returns from public,anon,authenticated;
grant select on public.financial_event_returns to authenticated;
grant select,insert,update on public.financial_event_returns to service_role;
create policy owner_read on public.financial_event_returns for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_posting before update or delete on public.financial_event_returns for each row execute function thrift_log_private.immutable_posting();
alter table public.payout_allocations enable row level security;
revoke all on public.payout_allocations from public,anon,authenticated;
grant select on public.payout_allocations to authenticated;
grant select,insert,update on public.payout_allocations to service_role;
create policy owner_read on public.payout_allocations for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_posting before update or delete on public.payout_allocations for each row execute function thrift_log_private.immutable_posting();
alter table public.shipment_orders enable row level security;
revoke all on public.shipment_orders from public,anon,authenticated;
grant select on public.shipment_orders to authenticated;
grant select,insert,update on public.shipment_orders to service_role;
create policy owner_read on public.shipment_orders for select to authenticated using(user_id=(select auth.uid()));

create function thrift_log_private.lock_posted_order() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.financial_events e where e.user_id=old.user_id and e."orderId"=old.id) and
 (to_jsonb(old)-'fulfillment'-'payout'-'provenance'-'externalId'-'showId') is distinct from (to_jsonb(new)-'fulfillment'-'payout'-'provenance'-'externalId'-'showId') then raise exception 'financial_basis_immutable'; end if;
 return new;
end;$$;
create trigger lock_posted_order before update on public.orders for each row execute function thrift_log_private.lock_posted_order();
create function thrift_log_private.lock_posted_line() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.financial_events e where e.user_id=old.user_id and e."orderId"=old.order_id) and (old.price is distinct from new.price or old."costBasis" is distinct from new."costBasis") then raise exception 'financial_basis_immutable';end if;return new;
end;$$;
create trigger lock_posted_line before update on public.order_lines for each row execute function thrift_log_private.lock_posted_line();
create function thrift_log_private.lock_shipping_allocation() returns trigger language plpgsql set search_path='' as $$begin
 if old."allocatedShipping" and (old."labelCost" is distinct from new."labelCost" or not new."allocatedShipping") then raise exception 'shipping_allocation_immutable';end if;return new;
end;$$;
create trigger lock_shipping_allocation before update on public.shipments for each row execute function thrift_log_private.lock_shipping_allocation();
create function public.load_workspace(p_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result=thrift_log_private.load_workspace(p_user_id);
 if result is null then return null;end if;
 result=result||jsonb_build_object('financialEvents',(select coalesce(jsonb_agg((to_jsonb(t)-'user_id')||jsonb_build_object('itemIds',(select coalesce(jsonb_agg(r."itemId" order by r."itemId"),'[]'::jsonb) from public.financial_event_returns r where r.user_id=p_user_id and r.event_id=t.id)) order by t.date,t.id),'[]'::jsonb) from public.financial_events t where t.user_id=p_user_id));
 result=result||jsonb_build_object('payouts',(select coalesce(jsonb_agg((to_jsonb(t)-'user_id')||jsonb_build_object('allocations',(select coalesce(jsonb_agg(jsonb_build_object('orderId',a."orderId",'amount',a.amount) order by a."orderId"),'[]'::jsonb) from public.payout_allocations a where a.user_id=p_user_id and a.payout_id=t.id)) order by t.date,t.id),'[]'::jsonb) from public.payouts t where t.user_id=p_user_id));
 result=result||jsonb_build_object('shipments',(select coalesce(jsonb_agg((to_jsonb(t)-'user_id')||jsonb_build_object('orderIds',(select coalesce(jsonb_agg(a.order_id order by a.order_id),'[]'::jsonb) from public.shipment_orders a where a.user_id=p_user_id and a.shipment_id=t.id)) order by t.date,t.id),'[]'::jsonb) from public.shipments t where t.user_id=p_user_id));
 return result;
end;$$;
create function public.commit_workspace(p_user_id uuid,p_expected_revision bigint,p_payload jsonb) returns bigint language plpgsql security invoker set search_path='' as $$
declare revision bigint; entry jsonb; existing_events uuid[];existing_payouts uuid[];existing_shipments uuid[];
begin
 -- Base commit owns the per-user row lock. Any later failure rolls back the entire transaction.
 revision=thrift_log_private.commit_workspace(p_user_id,p_expected_revision,p_payload);
 select coalesce(array_agg(id),array[]::uuid[]) into existing_events from public.financial_events where user_id=p_user_id;
 select coalesce(array_agg(id),array[]::uuid[]) into existing_payouts from public.payouts where user_id=p_user_id;
 select coalesce(array_agg(id),array[]::uuid[]) into existing_shipments from public.shipments where user_id=p_user_id;
insert into public.financial_events(user_id,id,"orderId",date,kind,amount,reason,"externalId","reversesId",category) select p_user_id,id,"orderId",date,kind,amount,reason,"externalId","reversesId",category from jsonb_populate_recordset(null::public.financial_events,coalesce(p_payload->'financialEvents','[]'::jsonb)) on conflict(user_id,id) do update set "orderId"=excluded."orderId",date=excluded.date,kind=excluded.kind,amount=excluded.amount,reason=excluded.reason,"externalId"=excluded."externalId","reversesId"=excluded."reversesId",category=excluded.category;
insert into public.payouts(user_id,id,marketplace,date,reference,amount,notes,"reversalOf") select p_user_id,id,marketplace,date,reference,amount,notes,"reversalOf" from jsonb_populate_recordset(null::public.payouts,coalesce(p_payload->'payouts','[]'::jsonb)) on conflict(user_id,id) do update set marketplace=excluded.marketplace,date=excluded.date,reference=excluded.reference,amount=excluded.amount,notes=excluded.notes,"reversalOf"=excluded."reversalOf";
insert into public.shipments(user_id,id,marketplace,date,carrier,tracking,status,"labelCost",notes,"allocatedShipping") select p_user_id,id,marketplace,date,carrier,tracking,status,"labelCost",notes,"allocatedShipping" from jsonb_populate_recordset(null::public.shipments,coalesce(p_payload->'shipments','[]'::jsonb)) on conflict(user_id,id) do update set marketplace=excluded.marketplace,date=excluded.date,carrier=excluded.carrier,tracking=excluded.tracking,status=excluded.status,"labelCost"=excluded."labelCost",notes=excluded.notes,"allocatedShipping"=excluded."allocatedShipping";

 for entry in select value from jsonb_array_elements(coalesce(p_payload->'financialEvents','[]')) loop
  if (entry->>'id')::uuid=any(existing_events) and
   (select coalesce(jsonb_agg("itemId" order by "itemId"),'[]'::jsonb) from public.financial_event_returns where user_id=p_user_id and event_id=(entry->>'id')::uuid) is distinct from
   (select coalesce(jsonb_agg(value::uuid order by value::uuid),'[]'::jsonb) from jsonb_array_elements_text(entry->'itemIds')) then raise exception 'posted_record_immutable';end if;
  insert into public.financial_event_returns(user_id,event_id,order_id,"itemId") select p_user_id,(entry->>'id')::uuid,(entry->>'orderId')::uuid,value::uuid from jsonb_array_elements_text(entry->'itemIds') on conflict do nothing;
 end loop;
 for entry in select value from jsonb_array_elements(coalesce(p_payload->'payouts','[]')) loop
  if (entry->>'id')::uuid=any(existing_payouts) and
   (select coalesce(jsonb_agg(jsonb_build_object('orderId',"orderId",'amount',amount) order by "orderId"),'[]'::jsonb) from public.payout_allocations where user_id=p_user_id and payout_id=(entry->>'id')::uuid) is distinct from
   (select coalesce(jsonb_agg(jsonb_build_object('orderId',"orderId",'amount',amount) order by "orderId"),'[]'::jsonb) from jsonb_populate_recordset(null::public.payout_allocations,entry->'allocations')) then raise exception 'posted_record_immutable';end if;
  insert into public.payout_allocations(user_id,payout_id,"orderId",amount) select p_user_id,(entry->>'id')::uuid,"orderId",amount from jsonb_populate_recordset(null::public.payout_allocations,entry->'allocations') on conflict do nothing;
 end loop;
 for entry in select value from jsonb_array_elements(coalesce(p_payload->'shipments','[]')) loop
  if (entry->>'id')::uuid=any(existing_shipments) and
   (select coalesce(jsonb_agg(order_id order by order_id),'[]'::jsonb) from public.shipment_orders where user_id=p_user_id and shipment_id=(entry->>'id')::uuid) is distinct from
   (select coalesce(jsonb_agg(value::uuid order by value::uuid),'[]'::jsonb) from jsonb_array_elements_text(entry->'orderIds')) then raise exception 'shipment_membership_immutable';end if;
  insert into public.shipment_orders(user_id,shipment_id,order_id) select p_user_id,(entry->>'id')::uuid,value::uuid from jsonb_array_elements_text(entry->'orderIds') on conflict(user_id,shipment_id,order_id) do nothing;
 end loop;
 if exists(select 1 from public.order_lines l join public.orders o on o.user_id=l.user_id and o.id=l.order_id where o.user_id=p_user_id and o.status='Completed' and not exists(select 1 from public.financial_event_returns r join public.financial_events e on e.user_id=r.user_id and e.id=r.event_id where r.user_id=p_user_id and r.order_id=o.id and r."itemId"=l."itemId" and not exists(select 1 from public.financial_events v where v.user_id=e.user_id and v."reversesId"=e.id)) group by l."itemId" having count(*)>1) then raise exception 'duplicate_physical_sale';end if;
 if exists(select 1 from public.financial_event_returns r join public.financial_events e on e.user_id=r.user_id and e.id=r.event_id where r.user_id=p_user_id and not exists(select 1 from public.financial_events v where v.user_id=e.user_id and v."reversesId"=e.id) group by r.order_id,r."itemId" having count(*)>1) then raise exception 'duplicate_physical_return';end if;
 if exists(select 1 from public.payouts p where p.user_id=p_user_id and p.amount<>(select coalesce(sum(a.amount),0) from public.payout_allocations a where a.user_id=p_user_id and a.payout_id=p.id)) then raise exception 'payout_allocation_mismatch';end if;
 return revision;
end;$$;
create function public.verify_thrift_log() returns jsonb language sql security invoker set search_path='' as $$
 select thrift_log_private.verify_thrift_log()||jsonb_build_object('schemaVersion',3,'financialLedger',true,'shipmentStorage',true,'rlsEnabled',(thrift_log_private.verify_thrift_log()->>'rlsEnabled')::boolean and (select count(*)=6 and bool_and(c.relrowsecurity) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('financial_events','payouts','shipments','financial_event_returns','payout_allocations','shipment_orders')));
$$;
revoke all on function public.load_workspace(uuid),public.commit_workspace(uuid,bigint,jsonb),public.verify_thrift_log() from public,anon,authenticated;
grant execute on function public.load_workspace(uuid),public.commit_workspace(uuid,bigint,jsonb),public.verify_thrift_log() to service_role;
revoke all on function thrift_log_private.immutable_posting(),thrift_log_private.lock_posted_order(),thrift_log_private.lock_posted_line(),thrift_log_private.lock_shipping_allocation() from public,anon,authenticated;
commit;
