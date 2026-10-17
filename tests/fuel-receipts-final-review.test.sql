-- Isolated fixture DB ONLY, owner connection. Every data change rolls back.
-- Run after db.test + archive-db.test (receipt1 archived, receipt2 active).
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
update public.driving_reports set outbound_route_type='direct',return_route_type='direct',start_odometer=190,end_odometer=210,alcohol_check_version=2 where id=1;
insert into public.driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at) select 1,inspection_item_code,'ok',now() from public.driving_report_inspection_items();
insert into public.driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,phone_confirmed,confirmed_by_name_snapshot) values(1,'commute_before',now(),0,false,'中尾'),(1,'return_before',now(),0,true,'安藤');
set local role service_role;
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','reserve','{"id":"30000000-0000-0000-0000-000000000003","refuel_id":1,"mime":"image/jpeg","bytes":100,"name":"test.jpg","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
reset role;
set local role authenticated;
do $$begin
 begin perform public.submit_driving_report(1);raise exception 'pending submit allowed';exception when others then if sqlerrm<>'receipt_upload_pending' then raise;end if;end;
 begin delete from public.driving_refuels where id=1;raise exception 'pending refuel delete allowed';exception when others then if sqlerrm<>'remove_receipt_before_refuel' then raise;end if;end;
 raise notice 'PASS pending upload blocks submission and refuel deletion';
end$$;
reset role;
set local role service_role;
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','finalize','{"id":"30000000-0000-0000-0000-000000000003"}');
reset role;
set local role authenticated;
select id,status from public.submit_driving_report(1);
reset role;
set local role service_role;
do $$begin
 begin perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','remove_begin','{"id":"30000000-0000-0000-0000-000000000003"}');raise exception 'submitted delete allowed';exception when insufficient_privilege then if sqlerrm<>'own_draft_required' then raise;end if;end;
 begin perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','reserve','{"refuel_id":1}');raise exception 'submitted replacement allowed';exception when insufficient_privilege then if sqlerrm<>'own_draft_required' then raise;end if;end;
 raise notice 'PASS actual submitted report cannot delete/replace receipt';
end$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
set local role authenticated;
do $$begin
 begin delete from public.driving_refuels where id=2;raise exception 'active refuel delete allowed';exception when others then if sqlerrm<>'remove_receipt_before_refuel' then raise;end if;end;
 raise notice 'PASS active receipt blocks direct refuel delete';
end$$;
reset role;
set local role service_role;
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','remove_begin','{"id":"20000000-0000-0000-0000-000000000002"}');
-- Storage-success ordering is separately tested in the actual Edge handler.
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','remove_done','{"id":"20000000-0000-0000-0000-000000000002"}');
reset role;
set local role authenticated;
delete from public.driving_refuels where id=2;
reset role;
do $$begin
 if exists(select 1 from public.fuel_receipts where id='20000000-0000-0000-0000-000000000002' and (refuel_id is not null or state<>'removed')) then raise exception 'fuel/receipt relation inconsistent';end if;
 if not exists(select 1 from public.fuel_receipt_audit where target='20000000-0000-0000-0000-000000000002') then raise exception 'audit lost';end if;
 raise notice 'PASS draft refuel delete after attachment removal preserves metadata/audit';
end$$;
rollback;
