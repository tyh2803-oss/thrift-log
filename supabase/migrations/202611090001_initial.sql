-- Thrift Log: private owner-scoped relational storage. Run in Supabase SQL editor.
begin;
create table public.workspaces(user_id uuid primary key references auth.users(id), revision bigint not null default 0, settings jsonb not null default '{}'::jsonb);
create table public.imports(user_id uuid not null references auth.users(id), id uuid, filename text not null, kind text not null, "importedAt" timestamptz not null, "rawCsv" text not null, mapping jsonb not null, "recordIds" jsonb not null, primary key(user_id,id));
create table public.locations(user_id uuid not null references auth.users(id), id uuid, name text not null, address text not null, latitude double precision, longitude double precision, primary key(user_id,id));
create table public.trips(user_id uuid not null references auth.users(id), id uuid, "locationId" uuid, name text not null, date timestamptz not null, "totalSpent" bigint not null check ("totalSpent">=0), notes text not null, primary key(user_id,id));
create table public.shows(user_id uuid not null references auth.users(id), id uuid, name text not null, date timestamptz not null, type text not null check(type in ('Whatnot','In person')), status text not null check(status in ('Planned','Live','Ended')), notes text not null, "externalId" text not null, checklist jsonb not null, lineup jsonb not null, "durationMinutes" integer not null check("durationMinutes">=0), primary key(user_id,id));
create table public.items(user_id uuid not null references auth.users(id), id uuid, sku text not null, title text not null, brand text not null, category text not null, size text not null, color text not null, condition text not null, description text not null, cost bigint not null check(cost>=0), asking bigint not null check(asking>=0), "purchasedAt" timestamptz not null, source text not null, storage text not null, notes text not null, status text not null check(status in ('Purchased','Unprocessed','Ready to List','Listed','Reserved','Sold','Returned','Archived')), "tripId" uuid, photos jsonb not null, "createdAt" timestamptz not null, primary key(user_id,id));
create table public.listings(user_id uuid not null references auth.users(id), id uuid, "itemId" uuid not null, marketplace text not null, price bigint not null check(price>=0), "originalPrice" bigint not null check("originalPrice">=0), "externalId" text not null, url text not null, "listedAt" timestamptz not null, status text not null, format text not null, "lastSync" timestamptz, primary key(user_id,id));
create table public.orders(user_id uuid not null references auth.users(id), id uuid, marketplace text not null, "externalId" text not null, date timestamptz not null, "showId" uuid, discount bigint not null check(discount>=0), "shippingCollected" bigint not null check("shippingCollected">=0), fees bigint not null check(fees>=0), processing bigint not null check(processing>=0), shipping bigint not null check(shipping>=0), packaging bigint not null check(packaging>=0), other bigint not null check(other>=0), refund bigint not null check(refund>=0), "feeCredit" bigint not null check("feeCredit">=0), adjustment bigint not null, tips bigint not null check(tips>=0), type text not null check(type in ('Sale','Giveaway','Tip')), status text not null check(status in ('Completed','Cancelled','Returned')), fulfillment text not null, payout text not null, provenance text not null, "importKey" text not null, primary key(user_id,id));
create table public.expenses(user_id uuid not null references auth.users(id), id uuid, title text not null, category text not null, amount bigint not null check(amount>=0), date timestamptz not null, "showId" uuid, "tripId" uuid, primary key(user_id,id));
create table public.sessions(user_id uuid not null references auth.users(id), id uuid, category text not null check(category in ('Buying','Listing','Selling')), subcategory text not null, notes text not null, "showId" uuid, "tripId" uuid, "locationId" uuid, segments jsonb not null, state text not null check(state in ('Running','Paused','Ended','Deleted')), primary key(user_id,id));

create table public.order_lines(user_id uuid not null, order_id uuid not null, "itemId" uuid not null, price bigint not null check(price>=0), "costBasis" bigint not null check("costBasis">=0), primary key(user_id,order_id,"itemId"), foreign key(user_id,order_id) references public.orders(user_id,id), foreign key(user_id,"itemId") references public.items(user_id,id));
create table public.financial_audit(id bigint generated always as identity primary key, user_id uuid not null references auth.users(id), order_id uuid not null, changed_at timestamptz not null default now(), previous_record jsonb, new_record jsonb not null);
create unique index item_sku on public.items(user_id,lower(sku));
create unique index external_orders on public.orders(user_id,marketplace,"externalId") where "externalId" <> '';
create unique index imported_orders on public.orders(user_id,"importKey") where "importKey" <> '';
create unique index external_listings on public.listings(user_id,marketplace,"externalId") where "externalId" <> '';
create unique index one_open_timer on public.sessions(user_id) where state in ('Running','Paused');
create index order_dates on public.orders(user_id,date);
create index expense_dates on public.expenses(user_id,date);
create index item_status on public.items(user_id,status);
alter table public.items add foreign key(user_id,"tripId") references public.trips(user_id,id);
alter table public.trips add foreign key(user_id,"locationId") references public.locations(user_id,id);
alter table public.listings add foreign key(user_id,"itemId") references public.items(user_id,id);
alter table public.orders add foreign key(user_id,"showId") references public.shows(user_id,id);
alter table public.expenses add foreign key(user_id,"showId") references public.shows(user_id,id), add foreign key(user_id,"tripId") references public.trips(user_id,id);
alter table public.sessions add foreign key(user_id,"showId") references public.shows(user_id,id), add foreign key(user_id,"tripId") references public.trips(user_id,id), add foreign key(user_id,"locationId") references public.locations(user_id,id);
create function public.audit_order() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='INSERT' then insert into public.financial_audit(user_id,order_id,new_record) values(new.user_id,new.id,to_jsonb(new));
 elsif to_jsonb(old) is distinct from to_jsonb(new) then insert into public.financial_audit(user_id,order_id,previous_record,new_record) values(new.user_id,new.id,to_jsonb(old),to_jsonb(new)); end if;
 return new;
end; $$;
create trigger audit_order after insert or update on public.orders for each row execute function public.audit_order();
create function public.audit_order_line() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='INSERT' then insert into public.financial_audit(user_id,order_id,new_record) values(new.user_id,new.order_id,to_jsonb(new));
 elsif to_jsonb(old) is distinct from to_jsonb(new) then insert into public.financial_audit(user_id,order_id,previous_record,new_record) values(new.user_id,new.order_id,to_jsonb(old),to_jsonb(new)); end if;
 return new;
end; $$;
create trigger audit_order_line after insert or update on public.order_lines for each row execute function public.audit_order_line();
alter table public.workspaces enable row level security;
create policy owner_read on public.workspaces for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.workspaces from anon, authenticated;
grant select on public.workspaces to authenticated;
alter table public.imports enable row level security;
create policy owner_read on public.imports for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.imports from anon, authenticated;
grant select on public.imports to authenticated;
alter table public.locations enable row level security;
create policy owner_read on public.locations for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.locations from anon, authenticated;
grant select on public.locations to authenticated;
alter table public.trips enable row level security;
create policy owner_read on public.trips for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.trips from anon, authenticated;
grant select on public.trips to authenticated;
alter table public.shows enable row level security;
create policy owner_read on public.shows for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.shows from anon, authenticated;
grant select on public.shows to authenticated;
alter table public.items enable row level security;
create policy owner_read on public.items for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.items from anon, authenticated;
grant select on public.items to authenticated;
alter table public.listings enable row level security;
create policy owner_read on public.listings for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.listings from anon, authenticated;
grant select on public.listings to authenticated;
alter table public.orders enable row level security;
create policy owner_read on public.orders for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;
alter table public.expenses enable row level security;
create policy owner_read on public.expenses for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;
alter table public.sessions enable row level security;
create policy owner_read on public.sessions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to authenticated;
alter table public.order_lines enable row level security;
create policy owner_read on public.order_lines for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.order_lines from anon, authenticated;
grant select on public.order_lines to authenticated;
alter table public.financial_audit enable row level security;
create policy owner_read on public.financial_audit for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.financial_audit from anon, authenticated;
grant select on public.financial_audit to authenticated;

-- Only the server service role can commit. The server authenticates the cookie first.
create function public.load_workspace(p_user_id uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 select jsonb_build_object('revision',revision,'settings',settings) into result from public.workspaces where user_id=p_user_id;
 if result is null then return null; end if;
 result=result||jsonb_build_object('imports',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.imports t where user_id=p_user_id));
 result=result||jsonb_build_object('locations',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.locations t where user_id=p_user_id));
 result=result||jsonb_build_object('trips',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.trips t where user_id=p_user_id));
 result=result||jsonb_build_object('shows',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.shows t where user_id=p_user_id));
 result=result||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.items t where user_id=p_user_id));
 result=result||jsonb_build_object('listings',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.listings t where user_id=p_user_id));
 result=result||jsonb_build_object('orders',(select coalesce(jsonb_agg((to_jsonb(t)-'user_id')||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)-'user_id'-'order_id'),'[]'::jsonb) from public.order_lines l where l.user_id=p_user_id and l.order_id=t.id))),'[]'::jsonb) from public.orders t where user_id=p_user_id));
 result=result||jsonb_build_object('expenses',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.expenses t where user_id=p_user_id));
 result=result||jsonb_build_object('sessions',(select coalesce(jsonb_agg(to_jsonb(t)-'user_id'),'[]'::jsonb) from public.sessions t where user_id=p_user_id));
 return result;
end; $$;
create function public.commit_workspace(p_user_id uuid,p_expected_revision bigint,p_payload jsonb) returns bigint language plpgsql security invoker set search_path=public as $$
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
 -- Defense in depth against two completed sales for one physical item.
 if exists(select 1 from public.order_lines l join public.orders o on o.user_id=l.user_id and o.id=l.order_id where o.user_id=p_user_id and o.status='Completed' group by l."itemId" having count(*)>1) then raise exception 'duplicate_physical_sale'; end if;
 update public.workspaces set revision=current_revision+1,settings=p_payload->'settings' where user_id=p_user_id;
 return current_revision+1;
end; $$;
revoke all on function public.load_workspace(uuid) from public,anon,authenticated;
revoke all on function public.commit_workspace(uuid,bigint,jsonb) from public,anon,authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
grant execute on function public.load_workspace(uuid) to service_role;
grant execute on function public.commit_workspace(uuid,bigint,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('inventory-photos','inventory-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Storage access is through authenticated server routes; no public bucket policy.
commit;
