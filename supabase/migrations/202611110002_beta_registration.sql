-- Apply only with approval, after schema 6. No Auth users or business records are changed.
begin;
create table thrift_log_private.beta_registration_limits (
 key text primary key check(key ~ '^[a-f0-9]{64}$'),
 window_start timestamptz not null,
 attempts integer not null check(attempts>0)
);
create table thrift_log_private.beta_registration_claims (
 email text primary key references thrift_log_private.beta_access(email),
 token uuid not null,
 expires_at timestamptz not null
);
create index beta_registration_limits_expiry on thrift_log_private.beta_registration_limits(window_start);
alter table thrift_log_private.beta_registration_limits enable row level security;
alter table thrift_log_private.beta_registration_claims enable row level security;
revoke all on thrift_log_private.beta_registration_limits,thrift_log_private.beta_registration_claims from public,anon,authenticated;
grant select,insert,update,delete on thrift_log_private.beta_registration_limits,thrift_log_private.beta_registration_claims to service_role;

create function public.beta_begin_registration(p_email text,p_email_key text,p_client_key text,p_global_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_email text=lower(trim(p_email)); a thrift_log_private.beta_access; c thrift_log_private.beta_registration_claims;
 k text; n integer; maximum integer;
begin
 if p_email_key !~ '^[a-f0-9]{64}$' or p_client_key !~ '^[a-f0-9]{64}$' or p_global_key !~ '^[a-f0-9]{64}$'
 or p_email_key is null or p_client_key is null or p_global_key is null
 or p_email_key=p_client_key or p_email_key=p_global_key or p_client_key=p_global_key then raise exception 'invalid_registration_keys'; end if;
 delete from thrift_log_private.beta_registration_limits where window_start<now()-interval '1 day';
 -- Fixed global -> client -> email lock order across server instances. Stop before allocating
 -- more distinct keys once a higher-level budget is exhausted, bounding counter-table growth.
 foreach k in array array[p_global_key,p_client_key,p_email_key] loop
  insert into thrift_log_private.beta_registration_limits as l(key,window_start,attempts) values(k,now(),1)
  on conflict(key) do update set
   window_start=case when l.window_start<=now()-interval '15 minutes' then now() else l.window_start end,
   attempts=case when l.window_start<=now()-interval '15 minutes' then 1 else least(l.attempts+1,1001) end
  returning attempts into n;
  maximum=case when k=p_email_key then 5 when k=p_client_key then 20 else 100 end;
  if n>maximum then return jsonb_build_object('status','limited'); end if;
 end loop;
 -- Return rather than raise, so rejected requests still commit their attempt counters.
 select * into a from thrift_log_private.beta_access where email=v_email for update;
 if not found or not a.active or a.role<>'tester' then return jsonb_build_object('status','denied'); end if;
 if a.user_id is not null or exists(select 1 from auth.users where lower(email)=v_email) then
  return jsonb_build_object('status','existing');
 end if;
 select * into c from thrift_log_private.beta_registration_claims where email=v_email;
 if found and c.expires_at>now() then return jsonb_build_object('status','busy'); end if;
 insert into thrift_log_private.beta_registration_claims(email,token,expires_at) values(v_email,gen_random_uuid(),now()+interval '2 minutes')
 on conflict(email) do update set token=excluded.token,expires_at=excluded.expires_at returning * into c;
 return jsonb_build_object('status','allowed','token',c.token);
end;$$;

create function public.beta_finish_registration(p_email text,p_token uuid,p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a thrift_log_private.beta_access;
begin
 select * into a from thrift_log_private.beta_access where email=lower(trim(p_email)) for update;
 if not found or not a.active or a.role<>'tester' or (a.user_id is not null and a.user_id<>p_user_id)
 or not exists(select 1 from thrift_log_private.beta_registration_claims where email=a.email and token=p_token and expires_at>now())
 or not exists(select 1 from auth.users where id=p_user_id and lower(email)=a.email) then return false; end if;
 update thrift_log_private.beta_access set user_id=p_user_id,updated_at=now() where email=a.email;
 delete from thrift_log_private.beta_registration_claims where email=a.email;
 return true;
end;$$;
-- Release only this operation's claim after a definitive Auth rejection; timeouts stay reserved briefly.
create function public.beta_cancel_registration(p_email text,p_token uuid) returns void
language sql security definer set search_path='' as $$
 delete from thrift_log_private.beta_registration_claims where email=lower(trim(p_email)) and token=p_token;
$$;

revoke all on function public.beta_begin_registration(text,text,text,text),public.beta_finish_registration(text,uuid,uuid),public.beta_cancel_registration(text,uuid) from public,anon,authenticated;
grant execute on function public.beta_begin_registration(text,text,text,text),public.beta_finish_registration(text,uuid,uuid),public.beta_cancel_registration(text,uuid) to service_role;
alter function public.verify_thrift_log() rename to verify_thrift_log_v6;
alter function public.verify_thrift_log_v6() set schema thrift_log_private;
create function public.verify_thrift_log() returns jsonb language sql security invoker set search_path='' as $$
 select thrift_log_private.verify_thrift_log_v6() || jsonb_build_object('schemaVersion',7,'betaRegistration',
 not pg_catalog.has_function_privilege('authenticated','public.beta_begin_registration(text,text,text,text)','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.beta_begin_registration(text,text,text,text)','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.beta_finish_registration(text,uuid,uuid)','EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated','public.beta_finish_registration(text,uuid,uuid)','EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated','public.beta_cancel_registration(text,uuid)','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.beta_cancel_registration(text,uuid)','EXECUTE')
 and (select count(*)=2 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='thrift_log_private' and c.relname in ('beta_registration_limits','beta_registration_claims') and c.relrowsecurity));
$$;
revoke all on function public.verify_thrift_log(),thrift_log_private.verify_thrift_log_v6() from public,anon,authenticated;
grant execute on function public.verify_thrift_log(),thrift_log_private.verify_thrift_log_v6() to service_role;
commit;
