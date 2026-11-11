-- Review/apply only with approval, after 202611100001. No business rows are rewritten.
-- Bootstrap the existing owner's verified Auth UUID with beta_bootstrap_owner before rollout.
begin;
create table thrift_log_private.beta_access (
 email text primary key check(email=lower(trim(email)) and length(email)<=320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 user_id uuid unique references auth.users(id),
 role text not null check(role in ('owner','tester')),
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
create unique index one_beta_owner on thrift_log_private.beta_access(role) where role='owner';
alter table thrift_log_private.beta_access enable row level security;
revoke all on thrift_log_private.beta_access from public,anon,authenticated;
grant select,insert,update on thrift_log_private.beta_access to service_role;

create function thrift_log_private.beta_allowed(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from thrift_log_private.beta_access a join auth.users u on u.id=a.user_id
 where a.user_id=p_user_id and a.active and u.email_confirmed_at is not null and lower(u.email)=a.email);
$$;
revoke all on function thrift_log_private.beta_allowed(uuid) from public,anon,authenticated;
grant execute on function thrift_log_private.beta_allowed(uuid) to service_role;
-- No caller-supplied identity for policy checks. Policies see live membership, not JWT metadata.
create function public.beta_has_access() returns boolean language sql stable security definer set search_path='' as $$
 select thrift_log_private.beta_allowed(auth.uid());
$$;
revoke all on function public.beta_has_access() from public,anon;
grant execute on function public.beta_has_access() to authenticated,service_role;

create function public.beta_bootstrap_owner(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
 select lower(email) into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
 if v_email is null then raise exception 'verified_owner_required'; end if;
 if exists(select 1 from thrift_log_private.beta_access where role='owner' and user_id<>p_user_id) then
  raise exception 'owner_already_configured';
 end if;
 insert into thrift_log_private.beta_access(email,user_id,role) values(v_email,p_user_id,'owner')
 on conflict(email) do update set user_id=excluded.user_id,role='owner',active=true,updated_at=now();
end;$$;

create function public.beta_check_access(p_user_id uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 -- Bind an approved email once, only after Supabase verifies that account's email.
 update thrift_log_private.beta_access a set user_id=u.id,updated_at=now() from auth.users u
 where u.id=p_user_id and u.email_confirmed_at is not null and a.email=lower(u.email)
 and a.active and a.user_id is null;
 if not thrift_log_private.beta_allowed(p_user_id) then return null; end if;
 return (select role from thrift_log_private.beta_access where user_id=p_user_id);
end;$$;

create function public.beta_manage_access(p_actor_id uuid,p_email text default null,p_active boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_email text=lower(trim(p_email)); v_user_id uuid;
begin
 perform 1 from thrift_log_private.beta_access where user_id=p_actor_id and role='owner' and active for share;
 if not found or not thrift_log_private.beta_allowed(p_actor_id) then raise exception 'owner_required'; end if;
 if p_email is not null then
  if p_active is null then raise exception 'access_state_required'; end if;
  if exists(select 1 from thrift_log_private.beta_access where role='owner' and email=v_email) then
   raise exception 'owner_access_protected';
  end if;
  select id into v_user_id from auth.users where lower(email)=v_email;
  insert into thrift_log_private.beta_access(email,user_id,role,active) values(v_email,v_user_id,'tester',p_active)
  on conflict(email) do update set active=excluded.active,updated_at=now();
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('email',email,'active',active,'linked',user_id is not null)
 order by email) from thrift_log_private.beta_access where role='tester'),'[]'::jsonb);
end;$$;

-- Keep existing owner_read policies, adding a restrictive gate on every business table.
do $$declare t text; begin
 foreach t in array array['workspaces','imports','locations','trips','shows','items','listings','orders','expenses','sessions','order_lines','financial_audit','financial_events','payouts','shipments','financial_event_returns','payout_allocations','shipment_orders'] loop
 execute format('create policy beta_active on public.%I as restrictive for select to authenticated using ((select public.beta_has_access()))',t);
 end loop;
end;$$;
-- App routes proxy bytes with a live membership check. Deny raw client reads/signing, so a
-- tester cannot mint a long-lived bearer URL which remains usable after revocation.
create policy thrift_log_beta_photos_proxy on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'inventory-photos');

-- Defense in depth for trusted server writes: membership and business commit share a DB transaction.
-- A revoke waits for an in-flight commit; later commits cannot pass using an old Auth session.
alter function public.load_workspace(uuid) rename to load_workspace_v5;
alter function public.load_workspace_v5(uuid) set schema thrift_log_private;
alter function public.commit_workspace(uuid,bigint,jsonb) rename to commit_workspace_v5;
alter function public.commit_workspace_v5(uuid,bigint,jsonb) set schema thrift_log_private;
create function public.load_workspace(p_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from thrift_log_private.beta_access where user_id=p_user_id and active for share;
 if not found or not thrift_log_private.beta_allowed(p_user_id) then raise exception 'workspace_access_denied'; end if;
 return thrift_log_private.load_workspace_v5(p_user_id);
end;$$;
create function public.commit_workspace(p_user_id uuid,p_expected_revision bigint,p_payload jsonb) returns bigint
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from thrift_log_private.beta_access where user_id=p_user_id and active for share;
 if not found or not thrift_log_private.beta_allowed(p_user_id) then raise exception 'workspace_access_denied'; end if;
 return thrift_log_private.commit_workspace_v5(p_user_id,p_expected_revision,p_payload);
end;$$;

alter function public.verify_thrift_log() rename to verify_thrift_log_v5;
alter function public.verify_thrift_log_v5() set schema thrift_log_private;
create function public.verify_thrift_log() returns jsonb language sql security invoker set search_path='' as $$
 select thrift_log_private.verify_thrift_log_v5() || jsonb_build_object('schemaVersion',6,
 'inviteOnlyBeta',
 (select count(*)=18 from pg_catalog.pg_policies where schemaname='public' and policyname='beta_active' and permissive='RESTRICTIVE')
 and exists(select 1 from pg_catalog.pg_policies where schemaname='storage' and tablename='objects' and policyname='thrift_log_beta_photos_proxy' and permissive='RESTRICTIVE')
 and not pg_catalog.has_function_privilege('authenticated','public.beta_manage_access(uuid,text,boolean)','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.beta_check_access(uuid)','EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated','public.beta_bootstrap_owner(uuid)','EXECUTE'),
 'betaOwnerConfigured',exists(select 1 from thrift_log_private.beta_access a where a.role='owner' and thrift_log_private.beta_allowed(a.user_id)));
$$;
revoke all on function public.beta_bootstrap_owner(uuid),public.beta_check_access(uuid),public.beta_manage_access(uuid,text,boolean),
 public.load_workspace(uuid),public.commit_workspace(uuid,bigint,jsonb),public.verify_thrift_log(),
 thrift_log_private.load_workspace_v5(uuid),thrift_log_private.commit_workspace_v5(uuid,bigint,jsonb),thrift_log_private.verify_thrift_log_v5()
 from public,anon,authenticated;
grant execute on function public.beta_bootstrap_owner(uuid),public.beta_check_access(uuid),public.beta_manage_access(uuid,text,boolean),
 public.load_workspace(uuid),public.commit_workspace(uuid,bigint,jsonb),public.verify_thrift_log(),
 thrift_log_private.load_workspace_v5(uuid),thrift_log_private.commit_workspace_v5(uuid,bigint,jsonb),thrift_log_private.verify_thrift_log_v5() to service_role;
commit;
