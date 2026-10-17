-- Isolated review fixture ONLY: receipt2 active on refuel2/report4.
-- Real employee UPDATE permissions and real receipt DELETE guard; rollback all data.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update public.driving_refuels set liters=21.5,odometer_km=301 where id=2 and driving_report_id=4;
update public.driving_refuels set liters=22,odometer_km=302 where id=2 and driving_report_id=4;
do $$begin
 if not exists(select 1 from public.driving_refuels where id=2 and liters=22 and odometer_km=302) then raise exception 'refuel update failed';end if;
 if not exists(select 1 from public.fuel_receipts where id='20000000-0000-0000-0000-000000000002' and refuel_id=2 and report_id=4 and state='active') then raise exception 'receipt link lost';end if;
 begin delete from public.driving_refuels where id=2;raise exception 'attached refuel deleted';exception when others then if sqlerrm<>'remove_receipt_before_refuel' then raise;end if;end;
 raise notice 'PASS repeated employee UPDATE preserves active receipt link; DELETE still blocked';
end$$;
rollback;
