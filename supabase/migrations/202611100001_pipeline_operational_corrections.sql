-- Operational fulfillment corrections must not rewrite a posted financial basis.
-- Apply only after migration 20261109203443; this does not update any business records.
begin;
create or replace function thrift_log_private.lock_posted_order() returns trigger
language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.financial_events e where e.user_id=old.user_id and e."orderId"=old.id) and
 (to_jsonb(old)-'fulfillment'-'itemFulfillments'-'payout'-'provenance'-'externalId'-'showId') is distinct from
 (to_jsonb(new)-'fulfillment'-'itemFulfillments'-'payout'-'provenance'-'externalId'-'showId') then
   raise exception 'financial_basis_immutable';
 end if;
 return new;
end;$$;
alter function public.verify_thrift_log() rename to verify_thrift_log_v4;
alter function public.verify_thrift_log_v4() set schema thrift_log_private;
create function public.verify_thrift_log() returns jsonb language sql security invoker set search_path='' as $$
 select thrift_log_private.verify_thrift_log_v4() || jsonb_build_object('schemaVersion',5,'pipelineMoves',true);
$$;
revoke all on function public.verify_thrift_log(),thrift_log_private.verify_thrift_log_v4() from public,anon,authenticated;
grant execute on function public.verify_thrift_log(),thrift_log_private.verify_thrift_log_v4() to service_role;
commit;
