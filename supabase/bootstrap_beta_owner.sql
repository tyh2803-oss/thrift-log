-- Run in the EXISTING project's SQL Editor only after approval and migrations 202611100001/202611110001.
-- Replace the email below with the unchanged OWNER_EMAIL from Vercel. No password/key is needed here.
-- This transaction only authorizes that existing verified Auth UUID and proves its workspace is unchanged.
begin;
do $bootstrap$
declare
 expected_owner_email text := 'REPLACE_WITH_OWNER_EMAIL';
 owner_id uuid;
 before_workspace jsonb;
 after_workspace jsonb;
 before_counts jsonb := '{}'::jsonb;
 after_counts jsonb := '{}'::jsonb;
 n bigint;
 t text;
 checks jsonb;
begin
 if position('@' in expected_owner_email)=0 then raise exception 'Set the owner email in the variable declaration before running this script'; end if;
 checks=public.verify_thrift_log();
 if (checks->>'schemaVersion')::int<>6 or not coalesce((checks->>'inviteOnlyBeta')::boolean,false) then
  raise exception 'Apply and verify the two beta prerequisite migrations first';
 end if;
 select id into owner_id from auth.users where lower(email)=lower(trim(expected_owner_email)) and email_confirmed_at is not null;
 if owner_id is null then raise exception 'Existing verified owner not found; no account was created'; end if;
 -- Privileged read of the unchanged pre-beta loader while authorization is not bootstrapped yet.
 before_workspace=thrift_log_private.load_workspace_v5(owner_id);
 foreach t in array array['workspaces','imports','locations','trips','shows','items','listings','orders','expenses','sessions','order_lines','financial_audit','financial_events','payouts','shipments','financial_event_returns','payout_allocations','shipment_orders'] loop
  execute format('select count(*) from public.%I where user_id=$1',t) into n using owner_id;
  before_counts=before_counts||jsonb_build_object(t,n);
 end loop;
 perform public.beta_bootstrap_owner(owner_id);
 after_workspace=public.load_workspace(owner_id);
 foreach t in array array['workspaces','imports','locations','trips','shows','items','listings','orders','expenses','sessions','order_lines','financial_audit','financial_events','payouts','shipments','financial_event_returns','payout_allocations','shipment_orders'] loop
  execute format('select count(*) from public.%I where user_id=$1',t) into n using owner_id;
  after_counts=after_counts||jsonb_build_object(t,n);
 end loop;
 if before_workspace is distinct from after_workspace or before_counts is distinct from after_counts then
  raise exception 'Owner data preservation check failed; bootstrap rolled back';
 end if;
 checks=public.verify_thrift_log();
 if not coalesce((checks->>'betaOwnerConfigured')::boolean,false) then raise exception 'Owner authorization not verified'; end if;
 raise notice 'Existing owner authorized. Workspace, revision, financials and all business row counts are unchanged.';
end;
$bootstrap$;
commit;
select public.verify_thrift_log();
