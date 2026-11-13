-- Additive, optional feature. Apply only after explicit approval, after invite-only beta (schema 6 or later).
-- Does not rewrite business records, Auth accounts, financial constraints, or photo policies.
begin;
create table thrift_log_private.whatnot_connections (
 user_id uuid primary key references auth.users(id), seller_id text not null check(seller_id ~ '^[1-9][0-9]{0,18}$'), username text not null,
 token_ciphertext text, webhook_ciphertext text, webhook_id uuid not null default gen_random_uuid() unique,
 enabled boolean not null default true, version uuid not null default gen_random_uuid(),
 status text not null default 'connected' check(status in ('connected','syncing','partial','synced','error','auth_error','disconnected')),
 checkpoint jsonb not null default '{}'::jsonb, last_sync timestamptz, last_attempt timestamptz,
 next_due timestamptz default now(), last_error text, lease uuid, lease_until timestamptz, dirty boolean not null default false,
 check(not enabled or (token_ciphertext is not null and token_ciphertext like 'v1.%')), check(octet_length(checkpoint::text)<=1000000)
);
create unique index whatnot_one_active_workspace_per_seller on thrift_log_private.whatnot_connections(seller_id) where enabled;
create table thrift_log_private.whatnot_records (
 user_id uuid not null references auth.users(id), seller_id text not null,
 kind text not null check(kind in ('order','show','analytics','transaction','shipment','report')), external_id text not null check(length(external_id) between 1 and 200),
 payload jsonb not null check(jsonb_typeof(payload)='object'), hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('pending','applied','review','ignored')), issue text not null default '', local_id uuid,
 resolution jsonb not null default '{}'::jsonb check(jsonb_typeof(resolution)='object'), updated_at timestamptz not null default now(),
 primary key(user_id,seller_id,kind,external_id), check(octet_length(payload::text)<=1000000), check(length(issue)<=1000), check(octet_length(resolution::text)<=100000)
);
create index whatnot_pending on thrift_log_private.whatnot_records(user_id,seller_id,state,kind);
create index whatnot_order_transactions on thrift_log_private.whatnot_records(user_id,seller_id,(payload->>'orderId')) where kind='transaction';
create table thrift_log_private.whatnot_webhook_events (
 user_id uuid not null references auth.users(id), endpoint uuid not null, event_id text not null check(length(event_id)<=200), created_at timestamptz not null default now(),
 primary key(endpoint,event_id)
);
alter table thrift_log_private.whatnot_connections enable row level security;
alter table thrift_log_private.whatnot_records enable row level security;
alter table thrift_log_private.whatnot_webhook_events enable row level security;
-- These tables contain credentials/private provider data and have NO client policies or grants.
revoke all on thrift_log_private.whatnot_connections,thrift_log_private.whatnot_records,thrift_log_private.whatnot_webhook_events from public,anon,authenticated;
grant usage on schema thrift_log_private to service_role;
grant select,insert,update,delete on thrift_log_private.whatnot_connections,thrift_log_private.whatnot_records,thrift_log_private.whatnot_webhook_events to service_role;

create function public.whatnot_admin(p_action text,p_user_id uuid default null,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c thrift_log_private.whatnot_connections; r jsonb; result jsonb; revision bigint; more boolean; n integer;
begin
 if p_action='due' then
  return (select coalesce(jsonb_agg(t.user_id),'[]'::jsonb) from (
   select user_id from thrift_log_private.whatnot_connections where enabled and status<>'auth_error' and next_due<=now()
    and (lease_until is null or lease_until<now()) and thrift_log_private.beta_allowed(user_id) order by next_due limit 5
  ) t);
 end if;
 if p_action='webhook_connection' then
  select * into c from thrift_log_private.whatnot_connections where webhook_id=(p_data->>'endpoint')::uuid and enabled;
  if not found or not thrift_log_private.beta_allowed(c.user_id) then return null; end if;
  return jsonb_build_object('user_id',c.user_id,'seller_id',c.seller_id,'webhook_ciphertext',c.webhook_ciphertext,'version',c.version);
 end if;
 if p_user_id is null or not thrift_log_private.beta_allowed(p_user_id) then raise exception 'workspace_access_denied'; end if;
 -- Serialize membership revocation with every credential/record change as the workspace RPC does.
 perform 1 from thrift_log_private.beta_access where user_id=p_user_id and active for share;
 if not found then raise exception 'workspace_access_denied'; end if;
 if p_action='connect' then
  if length(p_data->>'token_ciphertext')>20000 or coalesce(p_data->>'token_ciphertext','') not like 'v1.%'
   or coalesce(p_data->>'seller_id','') !~ '^[1-9][0-9]{0,18}$' or length(coalesce(p_data->>'username','')) not between 1 and 500
   or (p_data->>'webhook_ciphertext' is not null and (length(p_data->>'webhook_ciphertext')>20000 or p_data->>'webhook_ciphertext' not like 'v1.%')) then raise exception 'invalid_connection'; end if;
  select * into c from thrift_log_private.whatnot_connections where user_id=p_user_id for update;
  if found and c.enabled and c.seller_id<>p_data->>'seller_id' then raise exception 'disconnect_before_switching_seller'; end if;
  insert into thrift_log_private.whatnot_connections(user_id,seller_id,username,token_ciphertext,webhook_ciphertext)
  values(p_user_id,p_data->>'seller_id',p_data->>'username',p_data->>'token_ciphertext',p_data->>'webhook_ciphertext')
  on conflict(user_id) do update set seller_id=excluded.seller_id,username=excluded.username,token_ciphertext=excluded.token_ciphertext,
   webhook_ciphertext=case when thrift_log_private.whatnot_connections.seller_id=excluded.seller_id then coalesce(excluded.webhook_ciphertext,thrift_log_private.whatnot_connections.webhook_ciphertext) else excluded.webhook_ciphertext end,
   webhook_id=case when thrift_log_private.whatnot_connections.seller_id=excluded.seller_id then thrift_log_private.whatnot_connections.webhook_id else gen_random_uuid() end,
   enabled=true,version=gen_random_uuid(),status='connected',checkpoint='{}',next_due=now(),last_error=null,lease=null,lease_until=null,dirty=false;
  return jsonb_build_object('connected',true);
 end if;
 select * into c from thrift_log_private.whatnot_connections where user_id=p_user_id for update;
 if p_action='status' then
  if not found then return jsonb_build_object('ready',true,'connected',false); end if;
  select count(*) into n from thrift_log_private.whatnot_records where user_id=p_user_id and seller_id=c.seller_id and state='review';
  return jsonb_build_object('ready',true,'connected',c.enabled,'username',c.username,'status',c.status,'last_sync',c.last_sync,'last_attempt',c.last_attempt,
   'error',c.last_error,'progress',coalesce(c.checkpoint->>'phase','reports'),'pending',n,'webhook_id',c.webhook_id,'has_webhook',c.webhook_ciphertext is not null,
   'hasMore',c.enabled and coalesce(c.checkpoint->>'phase','reports')<>'done');
 end if;
 if not found then return null; end if;
 if p_action='disconnect' then
  update thrift_log_private.whatnot_connections set enabled=false,token_ciphertext=null,webhook_ciphertext=null,version=gen_random_uuid(),status='disconnected',checkpoint='{}',last_error=null,lease=null,lease_until=null,next_due=null,dirty=false where user_id=p_user_id;
  return jsonb_build_object('connected',false);
 end if;
 if not c.enabled then
  if p_action in ('finish','error') then raise exception 'stale_sync_lease'; end if;
  return null;
 end if;
 if p_action='webhook' then
  if coalesce(p_data->>'ciphertext','') not like 'v1.%' or length(p_data->>'ciphertext')>20000 then raise exception 'invalid_webhook_secret'; end if;
  update thrift_log_private.whatnot_connections set webhook_ciphertext=p_data->>'ciphertext',version=gen_random_uuid(),lease=null,lease_until=null,next_due=now() where user_id=p_user_id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='read' then
  return (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
   select kind,external_id,payload,hash,state,issue,local_id,resolution from thrift_log_private.whatnot_records
   where user_id=p_user_id and seller_id=c.seller_id
   and (p_data->>'kind' is null or kind=p_data->>'kind')
   and (p_data->>'state' is null or state=p_data->>'state')
   and (p_data->>'localId' is null or local_id=(p_data->>'localId')::uuid)
   and (p_data->>'orderId' is null or payload->>'orderId'=p_data->>'orderId')
   and (not (p_data ? 'ids') or external_id in(select jsonb_array_elements_text(p_data->'ids')))
   and (coalesce((p_data->>'resolved')::boolean,false)=false or resolution<>'{}'::jsonb)
   order by updated_at,external_id limit least(200,greatest(1,coalesce((p_data->>'limit')::integer,100)))
  ) t);
 end if;
 if p_action='claim' then
  if c.status='auth_error' or c.lease_until>now() then return null; end if;
  if c.last_attempt>now()-interval '2 seconds' then return null; end if;
  if coalesce((p_data->>'force')::boolean,false)=false and c.next_due>now() then return null; end if;
  update thrift_log_private.whatnot_connections set lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',last_attempt=now(),status='syncing',
   dirty=case when coalesce(checkpoint->>'phase','done')='done' then false else dirty end
   where user_id=p_user_id returning * into c;
  return to_jsonb(c);
 end if;
 if p_action='resolve' then
  if c.lease_until>now() then raise exception 'sync_busy'; end if;
  if jsonb_typeof(p_data->'resolution')<>'object' or octet_length((p_data->'resolution')::text)>100000 then raise exception 'invalid_resolution'; end if;
  update thrift_log_private.whatnot_records set resolution=p_data->'resolution',state='pending',issue='',updated_at=now()
   where user_id=p_user_id and seller_id=c.seller_id and kind=p_data->>'kind' and external_id=p_data->>'id' and state='review';
  if not found then raise exception 'review_record_not_found'; end if;
  update thrift_log_private.whatnot_connections set next_due=now(),dirty=true where user_id=p_user_id;
  return jsonb_build_object('queued',true);
 end if;
 if p_action='enqueue' then
  if c.webhook_id<>(p_data->>'endpoint')::uuid or c.seller_id<>p_data->>'seller_id' or c.webhook_ciphertext is null or c.version<>(p_data->>'version')::uuid then raise exception 'invalid_webhook'; end if;
  delete from thrift_log_private.whatnot_webhook_events where user_id=p_user_id and created_at<now()-interval '30 days';
  insert into thrift_log_private.whatnot_webhook_events(user_id,endpoint,event_id) values(p_user_id,c.webhook_id,p_data->>'event_id') on conflict do nothing;
  get diagnostics n=row_count;
  if n>0 then update thrift_log_private.whatnot_connections set dirty=true,next_due=now() where user_id=p_user_id; end if;
  return jsonb_build_object('accepted',n>0);
 end if;
 if c.lease is distinct from (p_data->>'lease')::uuid or c.version is distinct from (p_data->>'version')::uuid or c.lease_until<now() or c.lease is null then raise exception 'stale_sync_lease'; end if;
 if p_action='error' then
  update thrift_log_private.whatnot_connections set lease=null,lease_until=null,status=case when p_data->>'code' in('auth','credential') then 'auth_error' else 'error' end,
   last_error=left(p_data->>'code',60),next_due=now()+interval '5 minutes' where user_id=p_user_id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='finish' then
  if jsonb_array_length(p_data->'records')>200 then raise exception 'sync_batch_too_large'; end if;
  select w.revision into revision from public.workspaces w where w.user_id=p_user_id for update;
  if coalesce(revision,0)<>(p_data->>'revision')::bigint then raise exception 'revision_conflict'; end if;
  if p_data->'workspace' is not null and p_data->'workspace'<>'null'::jsonb then
   revision=public.commit_workspace(p_user_id,coalesce(revision,0),p_data->'workspace');
  end if;
  for r in select value from jsonb_array_elements(p_data->'records') loop
   insert into thrift_log_private.whatnot_records(user_id,seller_id,kind,external_id,payload,hash,state,issue,local_id,resolution)
   values(p_user_id,c.seller_id,r->>'kind',r->>'external_id',r->'payload',r->>'hash',r->>'state',coalesce(r->>'issue',''),(r->>'local_id')::uuid,coalesce(r->'resolution','{}'::jsonb))
   on conflict(user_id,seller_id,kind,external_id) do update set payload=excluded.payload,hash=excluded.hash,state=excluded.state,issue=excluded.issue,
    local_id=excluded.local_id,resolution=excluded.resolution,updated_at=now();
  end loop;
  more=coalesce((p_data->>'more')::boolean,false);
  update thrift_log_private.whatnot_connections set lease=null,lease_until=null,status=case when more or c.dirty then 'partial' else 'synced' end,
   checkpoint=case when not more and c.dirty then '{}'::jsonb else p_data->'checkpoint' end,
   last_sync=case when not more then now() else last_sync end,last_error=null,
   next_due=case when more or c.dirty then now() else now()+interval '5 minutes' end,
   dirty=case when not more then false else dirty end where user_id=p_user_id;
  return jsonb_build_object('revision',coalesce(revision,0),'hasMore',more or c.dirty);
 end if;
 raise exception 'unsupported_whatnot_action';
end;$$;
revoke all on function public.whatnot_admin(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.whatnot_admin(text,uuid,jsonb) to service_role;
commit;
