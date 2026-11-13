-- Optional, additive feature. Apply only after explicit approval; requires invite-only beta/schema 6+.
-- No existing business rows, Auth accounts, grants, financial constraints or photo policies change.
begin;
create table thrift_log_private.assistant_conversations (
 user_id uuid primary key references auth.users(id),
 revision bigint not null default 0 check(revision>=0), messages jsonb not null default '[]'::jsonb,
 request_id uuid, input_hash text, response jsonb, saved_response jsonb, lease uuid, lease_until timestamptz,
 rate_start timestamptz not null default now(), attempts integer not null default 0,
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(messages)='array' and jsonb_array_length(messages)<=40 and octet_length(messages::text)<=1500000),
 check(response is null or (jsonb_typeof(response)='object' and octet_length(response::text)<=2500000)),
 check(saved_response is null or (jsonb_typeof(saved_response)='object' and octet_length(saved_response::text)<=2500000))
);
alter table thrift_log_private.assistant_conversations enable row level security;
revoke all on thrift_log_private.assistant_conversations from public,anon,authenticated;
grant usage on schema thrift_log_private to service_role;
grant select,insert,update,delete on thrift_log_private.assistant_conversations to service_role;

create table thrift_log_private.assistant_files (
 user_id uuid not null references auth.users(id), id uuid not null, name text not null check(length(name) between 1 and 200),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf','text/csv')),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'), size integer not null check(size between 1 and 5242880),
 path text not null, created_at timestamptz not null default now(), primary key(user_id,id), unique(path)
);
alter table thrift_log_private.assistant_files enable row level security;
revoke all on thrift_log_private.assistant_files from public,anon,authenticated;
grant select,insert,update,delete on thrift_log_private.assistant_files to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('assistant-files','assistant-files',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf','text/csv']) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='assistant-files' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf','text/csv'])
 then raise exception 'assistant_files_bucket_configuration_mismatch'; end if;
end $$;
-- Server proxy only. This restrictive policy leaves every existing photo policy effective.
create policy assistant_files_server_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'assistant-files') with check(bucket_id<>'assistant-files');

create function thrift_log_private.assistant_ready() returns boolean language sql security invoker set search_path='' as $$
 select (select count(*)=2 and bool_and(c.relrowsecurity
  and not pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='thrift_log_private' and c.relname in('assistant_conversations','assistant_files'))
 and exists(select 1 from storage.buckets where id='assistant-files' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf','text/csv'])
 and (select relrowsecurity from pg_catalog.pg_class where oid='storage.objects'::regclass)
 and exists(select 1 from pg_catalog.pg_policies where schemaname='storage' and tablename='objects' and policyname='assistant_files_server_only' and permissive='RESTRICTIVE' and cmd='ALL'
  and roles @> array['anon','authenticated']::name[] and qual='(bucket_id <> ''assistant-files''::text)' and with_check='(bucket_id <> ''assistant-files''::text)');
$$;
revoke all on function thrift_log_private.assistant_ready() from public,anon,authenticated;
grant execute on function thrift_log_private.assistant_ready() to service_role;

create function public.assistant_file(p_action text,p_user_id uuid,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f thrift_log_private.assistant_files; v_path text;
begin
 if current_user<>'service_role' then raise exception 'workspace_access_denied'; end if;
 if p_user_id is null or not thrift_log_private.beta_allowed(p_user_id) then raise exception 'workspace_access_denied'; end if;
 if not thrift_log_private.assistant_ready() then raise exception 'assistant_security_not_ready'; end if;
 perform 1 from thrift_log_private.beta_access where user_id=p_user_id and active for share;
 if not found then raise exception 'workspace_access_denied'; end if;
 if p_action='list' then
  if p_data ? 'ids' and (jsonb_typeof(p_data->'ids') is distinct from 'array' or jsonb_array_length(p_data->'ids')>400) then raise exception 'invalid_file_ids'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
   select id,name,mime,hash,size,path from thrift_log_private.assistant_files where user_id=p_user_id
    and (not(p_data ? 'ids') or id in(select v::uuid from jsonb_array_elements_text(p_data->'ids') as ids(v))) order by created_at desc limit 400
  ) t);
 end if;
 if p_action='delete' then
  if jsonb_typeof(p_data->'ids') is distinct from 'array' or jsonb_array_length(p_data->'ids')>400 then raise exception 'invalid_file_ids'; end if;
  delete from thrift_log_private.assistant_files where user_id=p_user_id and id in(select v::uuid from jsonb_array_elements_text(p_data->'ids') as ids(v));
  return jsonb_build_object('deleted',true);
 end if;
 if p_action<>'create' or p_data->>'id' is null then raise exception 'invalid_file_action'; end if;
 perform pg_advisory_xact_lock(hashtext('assistant-files:'||p_user_id::text));
 if not exists(select 1 from thrift_log_private.assistant_files where user_id=p_user_id and id=(p_data->>'id')::uuid)
 and (select count(*) from thrift_log_private.assistant_files where user_id=p_user_id)>=200 then raise exception 'assistant_files_limit'; end if;
 v_path=p_user_id::text||'/'||(p_data->>'id')::uuid::text||case p_data->>'mime' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' when 'application/pdf' then '.pdf' when 'text/csv' then '.csv' else null end;
 if v_path is null then raise exception 'invalid_file_type'; end if;
 insert into thrift_log_private.assistant_files(user_id,id,name,mime,hash,size,path)
 values(p_user_id,(p_data->>'id')::uuid,p_data->>'name',p_data->>'mime',p_data->>'hash',(p_data->>'size')::integer,v_path) on conflict(user_id,id) do nothing;
 select * into f from thrift_log_private.assistant_files where user_id=p_user_id and id=(p_data->>'id')::uuid;
 if f.hash is distinct from p_data->>'hash' or f.mime is distinct from p_data->>'mime' then raise exception 'file_identity_changed'; end if;
 return jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'hash',f.hash,'size',f.size,'path',f.path);
end;
$$;
revoke all on function public.assistant_file(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assistant_file(text,uuid,jsonb) to service_role;

create function public.assistant_chat(p_action text,p_user_id uuid,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c thrift_log_private.assistant_conversations; history jsonb;
begin
 if current_user<>'service_role' then raise exception 'workspace_access_denied'; end if;
 if p_user_id is null or not thrift_log_private.beta_allowed(p_user_id) then raise exception 'workspace_access_denied'; end if;
 if not thrift_log_private.assistant_ready() then raise exception 'assistant_security_not_ready'; end if;
 -- Serialize revocation with every read or conversation change.
 perform 1 from thrift_log_private.beta_access where user_id=p_user_id and active for share;
 if not found then raise exception 'workspace_access_denied'; end if;
 if p_action='load' then
  select * into c from thrift_log_private.assistant_conversations where user_id=p_user_id;
  return jsonb_build_object('revision',coalesce(c.revision,0),'messages',coalesce(c.messages,'[]'::jsonb),'response',c.saved_response);
 end if;
 insert into thrift_log_private.assistant_conversations(user_id) values(p_user_id) on conflict do nothing;
 select * into c from thrift_log_private.assistant_conversations where user_id=p_user_id for update;
 if p_action='claim' then
  if p_data->>'revision' is null then raise exception 'assistant_context_changed'; end if;
  if (p_data->>'requestId')::uuid is null or coalesce(p_data->>'inputHash','') !~ '^[a-f0-9]{64}$' then raise exception 'invalid_assistant_turn'; end if;
  if c.request_id=(p_data->>'requestId')::uuid then
   if c.input_hash<>p_data->>'inputHash' then raise exception 'assistant_turn_changed'; end if;
   if c.response is not null then return jsonb_build_object('replayed',true,'revision',c.revision,'response',c.response); end if;
  end if;
  if c.lease_until>now() then raise exception 'assistant_busy'; end if;
  if c.revision<>(p_data->>'revision')::bigint then raise exception 'assistant_context_changed'; end if;
  if c.rate_start>now()-interval '1 minute' and c.attempts>=10 then raise exception 'assistant_rate_limit'; end if;
  update thrift_log_private.assistant_conversations set request_id=(p_data->>'requestId')::uuid,input_hash=p_data->>'inputHash',response=null,
   lease=gen_random_uuid(),lease_until=now()+interval '4 minutes',
   attempts=case when rate_start<=now()-interval '1 minute' then 1 else attempts+1 end,
   rate_start=case when rate_start<=now()-interval '1 minute' then now() else rate_start end where user_id=p_user_id returning * into c;
  return jsonb_build_object('revision',c.revision,'messages',c.messages,'lease',c.lease);
 end if;
 if p_action='clear' then
  if p_data->>'revision' is null then raise exception 'assistant_context_changed'; end if;
  if c.revision<>(p_data->>'revision')::bigint then raise exception 'assistant_context_changed'; end if;
  update thrift_log_private.assistant_conversations set messages='[]',response=null,saved_response=null,request_id=null,input_hash=null,lease=null,lease_until=null,revision=revision+1,updated_at=now() where user_id=p_user_id returning * into c;
  return jsonb_build_object('revision',c.revision,'messages',c.messages,'response',null);
 end if;
 if c.lease is null or c.lease is distinct from (p_data->>'lease')::uuid or c.request_id is distinct from (p_data->>'requestId')::uuid then raise exception 'assistant_stale_turn'; end if;
 if p_action='cancel' then
  update thrift_log_private.assistant_conversations set lease=null,lease_until=null where user_id=p_user_id;
  return jsonb_build_object('cancelled',true);
 end if;
 if p_action<>'finish' then raise exception 'invalid_assistant_action'; end if;
 if c.lease_until<=now() then raise exception 'assistant_stale_turn'; end if;
 if jsonb_typeof(p_data->'messages') is distinct from 'array' or jsonb_array_length(p_data->'messages')<>2
 or p_data->'messages'->0->>'role' is distinct from 'user' or p_data->'messages'->1->>'role' is distinct from 'assistant'
 or jsonb_typeof(p_data->'response') is distinct from 'object' then raise exception 'invalid_assistant_response'; end if;
 if exists(select 1 from jsonb_array_elements(p_data->'messages') m
   where m->>'text' is null or length(m->>'text')>6000 or length(coalesce(m->>'context',''))>48000) then raise exception 'invalid_assistant_message'; end if;
 select coalesce(jsonb_agg(m order by ordinal),'[]'::jsonb) into history from (
  select m,ordinal from jsonb_array_elements(c.messages || (p_data->'messages')) with ordinality as t(m,ordinal) order by ordinal desc limit 40
 ) last_messages;
 update thrift_log_private.assistant_conversations set messages=history,response=p_data->'response',saved_response=p_data->'response',revision=revision+1,lease=null,lease_until=null,updated_at=now() where user_id=p_user_id returning * into c;
 return jsonb_build_object('revision',c.revision,'messages',c.messages,'response',c.response);
end;
$$;
revoke all on function public.assistant_chat(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assistant_chat(text,uuid,jsonb) to service_role;
commit;
