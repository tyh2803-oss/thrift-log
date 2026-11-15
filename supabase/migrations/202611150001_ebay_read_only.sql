-- Optional eBay integration; apply once only after approval. Requires invite-only beta/schema 6+.
-- Additive: existing Auth, business data, schema version, RLS and private photos are unchanged.
begin;
create table thrift_log_private.ebay_connections (
 user_id uuid primary key references auth.users(id), seller_id text not null check(length(seller_id) between 1 and 200), username text not null check(length(username) between 1 and 500),
 environment text not null check(environment in ('production','sandbox')), financials boolean not null default false,
 token_ciphertext text, enabled boolean not null default true, version uuid not null default gen_random_uuid(),
 status text not null default 'connected' check(status in ('connected','syncing','partial','synced','error','auth_error','disconnected')),
 checkpoint jsonb not null default '{}', last_sync timestamptz, last_financial_sync timestamptz, last_attempt timestamptz, next_due timestamptz default now(),
 last_error text, financial_error text, lease uuid, lease_until timestamptz,
 check(not enabled or (token_ciphertext like 'v1.%' and token_ciphertext is not null)), check(octet_length(checkpoint::text)<=10000)
);
create unique index ebay_one_active_workspace_per_seller on thrift_log_private.ebay_connections(environment,seller_id) where enabled;
create table thrift_log_private.ebay_oauth_states (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'), user_id uuid not null references auth.users(id),
 financials boolean not null, environment text not null check(environment in ('production','sandbox')),
 created_at timestamptz not null default now(), consumed boolean not null default false, completed boolean not null default false
);
create index ebay_state_owner on thrift_log_private.ebay_oauth_states(user_id,created_at);
create table thrift_log_private.ebay_records (
 user_id uuid not null references auth.users(id), seller_id text not null, environment text not null check(environment in ('production','sandbox')),
 kind text not null check(kind in ('order','transaction','payout')), external_id text not null check(length(external_id) between 1 and 300),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=1000000),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'), state text not null check(state in ('pending','applied','review','ignored')),
 issue text not null default '' check(length(issue)<=1000), local_id uuid,
 resolution jsonb not null default '{}' check(jsonb_typeof(resolution)='object' and octet_length(resolution::text)<=100000), updated_at timestamptz not null default now(),
 primary key(user_id,environment,seller_id,kind,external_id)
);
create index ebay_review on thrift_log_private.ebay_records(user_id,environment,seller_id,state,kind);
create index ebay_order_transactions on thrift_log_private.ebay_records(user_id,environment,seller_id,(payload->>'orderId')) where kind='transaction';
alter table thrift_log_private.ebay_connections enable row level security;
alter table thrift_log_private.ebay_oauth_states enable row level security;
alter table thrift_log_private.ebay_records enable row level security;
revoke all on thrift_log_private.ebay_connections,thrift_log_private.ebay_oauth_states,thrift_log_private.ebay_records from public,anon,authenticated;
grant usage on schema thrift_log_private to service_role;
grant select,insert,update,delete on thrift_log_private.ebay_connections,thrift_log_private.ebay_oauth_states,thrift_log_private.ebay_records to service_role;
create table thrift_log_private.ebay_deletion_events (
 event_hash text primary key check(event_hash ~ '^[a-f0-9]{64}$'), received_at timestamptz not null default now()
);
alter table thrift_log_private.ebay_deletion_events enable row level security;
revoke all on thrift_log_private.ebay_deletion_events from public,anon,authenticated;
grant select,insert on thrift_log_private.ebay_deletion_events to service_role;
create function public.ebay_admin(p_action text,p_user_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c thrift_log_private.ebay_connections; s thrift_log_private.ebay_oauth_states; r jsonb; revision bigint; more boolean; n integer;
begin
 if p_action='account_deletion' then
  if coalesce(p_data->>'environment','') not in ('production','sandbox') or coalesce(p_data->>'seller_id','')='' then raise exception 'invalid_deletion'; end if;
  -- Only verified notification handling can call this service-only action. No business ledger is deleted.
  insert into thrift_log_private.ebay_deletion_events(event_hash) values(p_data->>'event_hash') on conflict do nothing;
  get diagnostics n=row_count;
  if n=0 then return jsonb_build_object('accepted',true); end if;
  for c in select * from thrift_log_private.ebay_connections where seller_id=p_data->>'seller_id' and environment=p_data->>'environment' loop
   perform pg_advisory_xact_lock(hashtextextended('ebay:'||c.user_id::text,0));
   delete from thrift_log_private.ebay_oauth_states where user_id=c.user_id;
   delete from thrift_log_private.ebay_records where user_id=c.user_id and seller_id=c.seller_id and environment=c.environment;
   delete from thrift_log_private.ebay_connections where user_id=c.user_id;
  end loop;
  return jsonb_build_object('accepted',true);
 end if;
 if p_action='due' then
  return (select coalesce(jsonb_agg(t.user_id),'[]') from (
   select user_id from thrift_log_private.ebay_connections where enabled and status<>'auth_error' and next_due<=now()
    and (lease_until is null or lease_until<now()) and thrift_log_private.beta_allowed(user_id) order by next_due limit 5
  ) t);
 end if;
 if p_user_id is null or not thrift_log_private.beta_allowed(p_user_id) then raise exception 'workspace_access_denied'; end if;
 perform 1 from thrift_log_private.beta_access where user_id=p_user_id and active for share;
 if not found then raise exception 'workspace_access_denied'; end if;
 -- Serialize account mutations even before the first connection exists.
 perform pg_advisory_xact_lock(hashtextextended('ebay:'||p_user_id::text,0));
 if p_action='begin_oauth' then
  delete from thrift_log_private.ebay_oauth_states where user_id=p_user_id and created_at<now()-interval '1 hour';
  select count(*) into n from thrift_log_private.ebay_oauth_states where user_id=p_user_id;
  if n>=10 then raise exception 'oauth_rate_limit'; end if;
  insert into thrift_log_private.ebay_oauth_states(state_hash,user_id,financials,environment)
   values(p_data->>'state_hash',p_user_id,(p_data->>'financials')::boolean,p_data->>'environment');
  return jsonb_build_object('saved',true);
 end if;
 if p_action='consume_oauth' then
  update thrift_log_private.ebay_oauth_states set consumed=true where user_id=p_user_id and state_hash=p_data->>'state_hash'
    and not consumed and not completed and created_at>now()-interval '10 minutes' returning * into s;
  if not found then raise exception 'invalid_oauth_state'; end if;
  return jsonb_build_object('financials',s.financials,'environment',s.environment);
 end if;
 if p_action='connect' then
  select * into s from thrift_log_private.ebay_oauth_states where user_id=p_user_id and state_hash=p_data->>'state_hash'
   and consumed and not completed and created_at>now()-interval '10 minutes' for update;
  if not found then raise exception 'invalid_oauth_state'; end if;
  if length(coalesce(p_data->>'token_ciphertext','')) not between 10 and 40000 or p_data->>'token_ciphertext' not like 'v1.%' then raise exception 'invalid_credential'; end if;
  select * into c from thrift_log_private.ebay_connections where user_id=p_user_id for update;
  if found and c.enabled and (c.seller_id<>p_data->>'seller_id' or c.environment<>s.environment) then raise exception 'disconnect_before_switching'; end if;
  insert into thrift_log_private.ebay_connections(user_id,seller_id,username,environment,financials,token_ciphertext)
   values(p_user_id,p_data->>'seller_id',p_data->>'username',s.environment,s.financials,p_data->>'token_ciphertext')
   on conflict(user_id) do update set seller_id=excluded.seller_id,username=excluded.username,environment=excluded.environment,financials=excluded.financials,
    token_ciphertext=excluded.token_ciphertext,enabled=true,version=gen_random_uuid(),status='connected',checkpoint='{}',next_due=now(),last_sync=null,last_financial_sync=null,last_attempt=null,last_error=null,financial_error=null,lease=null,lease_until=null;
  update thrift_log_private.ebay_oauth_states set completed=true where state_hash=s.state_hash;
  return jsonb_build_object('connected',true);
 end if;
 select * into c from thrift_log_private.ebay_connections where user_id=p_user_id for update;
 if p_action='status' then
  if not found then return jsonb_build_object('ready',true,'connected',false); end if;
  select count(*) into n from thrift_log_private.ebay_records where user_id=p_user_id and seller_id=c.seller_id and environment=c.environment and state='review';
  return jsonb_build_object('ready',true,'connected',c.enabled,'username',c.username,'environment',c.environment,'financials',c.financials,
   'status',c.status,'last_sync',c.last_sync,'last_financial_sync',c.last_financial_sync,'last_attempt',c.last_attempt,'error',c.last_error,'financial_error',c.financial_error,
   'pending',n,'progress',coalesce(c.checkpoint->>'phase','orders'),'hasMore',c.enabled and coalesce(c.checkpoint->>'phase','orders')<>'done');
 end if;
 if p_action='disconnect' then
  update thrift_log_private.ebay_oauth_states set completed=true where user_id=p_user_id;
  update thrift_log_private.ebay_connections set enabled=false,token_ciphertext=null,version=gen_random_uuid(),status='disconnected',checkpoint='{}',last_error=null,lease=null,lease_until=null,next_due=null where user_id=p_user_id;
  return jsonb_build_object('connected',false);
 end if;
 if not found then
  if p_action in ('finish','error') then raise exception 'stale_sync_lease'; end if;
  return null;
 end if;
 if not c.enabled then
  if p_action in ('finish','error') then raise exception 'stale_sync_lease'; end if;
  return null;
 end if;
 if p_action='read' then
  return (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
   select kind,external_id,payload,hash,state,issue,local_id,resolution from thrift_log_private.ebay_records where user_id=p_user_id and seller_id=c.seller_id and environment=c.environment
    and (p_data->>'kind' is null or kind=p_data->>'kind') and (p_data->>'state' is null or state=p_data->>'state')
    and (p_data->>'orderId' is null or payload->>'orderId'=p_data->>'orderId')
    and (p_data->>'payoutId' is null or payload->>'payoutId'=p_data->>'payoutId')
    and (not(p_data ? 'ids') or external_id in(select jsonb_array_elements_text(p_data->'ids')))
    and (not coalesce((p_data->>'resolved')::boolean,false) or resolution<>'{}')
   order by updated_at,external_id limit least(200,greatest(1,coalesce((p_data->>'limit')::integer,100)))
  ) t);
 end if;
 if p_action='resolve' then
  if c.lease_until>now() then raise exception 'sync_busy'; end if;
  if jsonb_typeof(p_data->'resolution') is distinct from 'object' or octet_length((p_data->'resolution')::text)>100000 then raise exception 'invalid_resolution'; end if;
  update thrift_log_private.ebay_records set resolution=p_data->'resolution',state='pending',issue='',updated_at=now()
   where user_id=p_user_id and seller_id=c.seller_id and environment=c.environment and kind=p_data->>'kind' and external_id=p_data->>'id' and state='review';
  if not found then raise exception 'review_record_not_found'; end if;
  update thrift_log_private.ebay_connections set next_due=now() where user_id=p_user_id;
  return jsonb_build_object('queued',true);
 end if;
 if p_action='claim' then
  if c.status='auth_error' or c.lease_until>now() or c.last_attempt>now()-interval '2 seconds' then return null; end if;
  if not coalesce((p_data->>'force')::boolean,false) and c.next_due>now() then return null; end if;
  update thrift_log_private.ebay_connections set lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',last_attempt=now(),status='syncing' where user_id=p_user_id returning * into c;
  return to_jsonb(c);
 end if;
 if c.lease is null or c.lease is distinct from (p_data->>'lease')::uuid or c.version is distinct from (p_data->>'version')::uuid or c.lease_until<now() then raise exception 'stale_sync_lease'; end if;
 if p_action='error' then
  update thrift_log_private.ebay_connections set lease=null,lease_until=null,status=case when p_data->>'code'='auth' then 'auth_error' else 'error' end,
    last_error=left(p_data->>'code',60),next_due=now()+interval '5 minutes' where user_id=p_user_id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='finish' then
  if jsonb_typeof(p_data->'records') is distinct from 'array' or jsonb_array_length(p_data->'records')>200 then raise exception 'sync_batch_too_large'; end if;
  select w.revision into revision from public.workspaces w where w.user_id=p_user_id for update;
  if coalesce(revision,0)<>(p_data->>'revision')::bigint then raise exception 'revision_conflict'; end if;
  if p_data->'workspace' is not null and p_data->'workspace'<>'null'::jsonb then
   revision=public.commit_workspace(p_user_id,coalesce(revision,0),p_data->'workspace');
  end if;
  for r in select value from jsonb_array_elements(p_data->'records') loop
   insert into thrift_log_private.ebay_records(user_id,seller_id,environment,kind,external_id,payload,hash,state,issue,local_id,resolution)
   values(p_user_id,c.seller_id,c.environment,r->>'kind',r->>'external_id',r->'payload',r->>'hash',r->>'state',coalesce(r->>'issue',''),(r->>'local_id')::uuid,coalesce(r->'resolution','{}'))
   on conflict(user_id,environment,seller_id,kind,external_id) do update set payload=excluded.payload,hash=excluded.hash,state=excluded.state,issue=excluded.issue,local_id=excluded.local_id,resolution=excluded.resolution,updated_at=now();
  end loop;
  more=coalesce((p_data->>'more')::boolean,false);
  update thrift_log_private.ebay_connections set lease=null,lease_until=null,status=case when more or p_data->>'financial_error' is not null then 'partial' else 'synced' end,
   checkpoint=p_data->'checkpoint',last_sync=case when not more then coalesce((p_data->'checkpoint'->>'end')::timestamptz,now()) else last_sync end,
   last_financial_sync=case when not more and c.financials and p_data->>'financial_error' is null then coalesce((p_data->'checkpoint'->>'end')::timestamptz,now()) else last_financial_sync end,last_error=null,
   financial_error=p_data->>'financial_error',token_ciphertext=coalesce(p_data->>'token_ciphertext',token_ciphertext),
   next_due=case when more then now() else now()+interval '5 minutes' end where user_id=p_user_id;
  return jsonb_build_object('revision',coalesce(revision,0),'hasMore',more);
 end if;
 raise exception 'unsupported_ebay_action';
end;$$;
revoke all on function public.ebay_admin(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_admin(text,uuid,jsonb) to service_role;
commit;
