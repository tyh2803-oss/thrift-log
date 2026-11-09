-- Disposable SQL-role verification only. Every inserted record is rolled back.
begin;
do $$
declare
 owner_id uuid=gen_random_uuid(); item_a uuid=gen_random_uuid(); item_b uuid=gen_random_uuid(); order_id uuid=gen_random_uuid();
 item_base jsonb; order_record jsonb; payload jsonb; loaded jsonb; revision bigint;
begin
 insert into auth.users(id) values(owner_id);
 item_base='{"sku":"PIPE-A","title":"Pipeline rollback fixture","brand":"","category":"Other","size":"","color":"","condition":"","description":"","cost":1200,"asking":4500,"purchasedAt":"2026-10-01T12:00:00Z","source":"SQL rollback fixture","storage":"","notes":"","status":"Sold","tripId":null,"photos":[],"createdAt":"2026-10-01T12:00:00Z"}'::jsonb;
 order_record=jsonb_build_object('id',order_id,'marketplace','Vinted','externalId','PIPE-ROLLBACK','date','2026-11-01T12:00:00Z','showId',null,'lines',jsonb_build_array(jsonb_build_object('itemId',item_a,'price',4500,'costBasis',1200),jsonb_build_object('itemId',item_b,'price',4500,'costBasis',1200)))||
 '{"discount":0,"shippingCollected":0,"fees":400,"processing":0,"shipping":300,"packaging":0,"other":0,"refund":0,"feeCredit":0,"adjustment":0,"tips":0,"type":"Sale","status":"Completed","fulfillment":"Unfulfilled","payout":"Pending","provenance":"SQL rollback test","importKey":"","amountsConfirmed":true}'::jsonb||jsonb_build_object('itemFulfillments',jsonb_build_array(jsonb_build_object('itemId',item_a,'status','Shipped','date','2026-11-02T12:00:00Z'),jsonb_build_object('itemId',item_b,'status','Unfulfilled','date',null)));
 payload=jsonb_build_object('revision',0,'settings','{"currency":"USD","timezone":"America/New_York","theme":"light","monthlyGoal":150000,"widgets":[],"pipelineVisible":true,"estimatedSellingExpenses":500}'::jsonb,'items',jsonb_build_array(item_base||jsonb_build_object('id',item_a),item_base||jsonb_build_object('id',item_b,'sku','PIPE-B')),'orders',jsonb_build_array(order_record),'imports','[]'::jsonb,'listings','[]'::jsonb,'financialEvents','[]'::jsonb,'payouts','[]'::jsonb,'shipments','[]'::jsonb,'expenses','[]'::jsonb,'trips','[]'::jsonb,'locations','[]'::jsonb,'shows','[]'::jsonb,'sessions','[]'::jsonb);
 revision=public.commit_workspace(owner_id,0,payload);
 loaded=public.load_workspace(owner_id);
 if revision<>1 or (loaded->'orders'->0->>'amountsConfirmed')::boolean is not true or jsonb_array_length(loaded->'orders'->0->'itemFulfillments')<>2 or loaded->'orders'->0->'itemFulfillments'->0->>'status'<>'Shipped' then raise exception 'pipeline_roundtrip_failed';end if;
 begin
  perform public.commit_workspace(owner_id,0,payload);
  raise exception 'stale_revision_was_accepted';
 exception when others then
  if sqlerrm not like '%revision_conflict%' then raise;end if;
 end;
 if has_function_privilege('anon','public.commit_workspace(uuid,bigint,jsonb)','execute') or has_function_privilege('authenticated','public.commit_workspace(uuid,bigint,jsonb)','execute') then raise exception 'client_rpc_exposed';end if;
 if has_table_privilege('authenticated','public.orders','update') then raise exception 'direct_client_write_exposed';end if;
end;
$$;
rollback;
select public.verify_thrift_log() as readiness,(select count(*) from public.workspaces) as workspaces,(select count(*) from public.items) as items,(select count(*) from public.orders) as orders;
