-- Additive: preserve business records and existing application schema.
begin;
-- Trigger functions are internal implementation details, not public RPCs.
revoke all on function public.audit_order() from public, anon, authenticated;
revoke all on function public.audit_order_line() from public, anon, authenticated;
alter function public.audit_order() set search_path = '';
alter function public.audit_order_line() set search_path = '';
-- The application only ever uses this named private bucket.
update storage.buckets set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='inventory-photos';
create policy thrift_log_owner_photos on storage.objects for select to authenticated
  using (bucket_id='inventory-photos' and split_part(name,'/',1)=(select auth.uid())::text);
-- No client insert/update/delete storage policy: writes go through authorized server routes.
create function public.verify_thrift_log() returns jsonb language sql security invoker set search_path='' as $$
 with expected(name) as (values ('workspaces'),('imports'),('locations'),('trips'),('shows'),('items'),('listings'),('orders'),('expenses'),('sessions'),('order_lines'),('financial_audit')),
 checks as (
   select count(c.oid)=12 as tables_present,
     count(c.oid)=12 and bool_and(c.relrowsecurity) as rls_enabled,
     count(c.oid)=12 and bool_and(not pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') and not pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as client_writes_blocked
   from expected e left join pg_catalog.pg_class c on c.relname=e.name and c.relnamespace='public'::regnamespace
 ) select jsonb_build_object(
   'schemaVersion',2,'tablesPresent',tables_present,'rlsEnabled',rls_enabled,'clientWritesBlocked',client_writes_blocked,
   'privatePhotosBucket',exists(select 1 from storage.buckets where id='inventory-photos' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp']),
   'serverRpcRestricted',not pg_catalog.has_function_privilege('anon','public.load_workspace(uuid)','EXECUTE') and not pg_catalog.has_function_privilege('authenticated','public.load_workspace(uuid)','EXECUTE') and not pg_catalog.has_function_privilege('anon','public.commit_workspace(uuid,bigint,jsonb)','EXECUTE') and not pg_catalog.has_function_privilege('authenticated','public.commit_workspace(uuid,bigint,jsonb)','EXECUTE'),
   'privatePhotoReadPolicy',exists(select 1 from pg_catalog.pg_policies where schemaname='storage' and tablename='objects' and policyname='thrift_log_owner_photos')
 ) from checks;
$$;
revoke all on function public.verify_thrift_log() from public,anon,authenticated;
grant execute on function public.verify_thrift_log() to service_role;
commit;
