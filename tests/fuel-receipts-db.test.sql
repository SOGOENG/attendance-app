-- Isolated fixture DB only; connect as service_role (non-owner).
\set ON_ERROR_STOP on
create function pg_temp.ok(label text, value boolean) returns void language plpgsql as $$begin if not coalesce(value,false) then raise exception 'FAIL %',label; end if;raise notice 'PASS %',label;end$$;
create function pg_temp.denied(actor uuid,action text,data jsonb) returns void language plpgsql as $$begin
 begin perform public.fuel_receipt_command(actor,action,data);exception when others then if sqlerrm not in ('accounting_required','receipt_access_denied','own_draft_required') then raise; end if; raise notice 'PASS rejected %: %',action,sqlerrm;return;end;
 raise exception 'Unexpectedly permitted %',action;
end$$;
select pg_temp.ok('ordinary employee cannot manage',not (public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','access')->>'manager')::boolean);
select pg_temp.denied('00000000-0000-0000-0000-000000000001','list','{"month":"2026-10"}');
select pg_temp.denied('00000000-0000-0000-0000-000000000001','get','{"refuel_id":2}');
select pg_temp.ok('admin retains access',(public.fuel_receipt_command('00000000-0000-0000-0000-000000000003','access')->>'admin')::boolean);
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000003','roles','{"employee_id":2,"enabled":true}');
select pg_temp.ok('accounting can manage',(public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','access')->>'manager')::boolean);
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','reserve','{"id":"10000000-0000-0000-0000-000000000001","refuel_id":1,"mime":"image/jpeg","bytes":200,"name":"a.jpg","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','finalize','{"id":"10000000-0000-0000-0000-000000000001"}');
select pg_temp.ok('accountant lists other employees',jsonb_array_length(public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','list','{"month":"2026-10"}'))=2);
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','view','{"id":"10000000-0000-0000-0000-000000000001"}');
select pg_temp.denied('00000000-0000-0000-0000-000000000002','remove_begin','{"id":"10000000-0000-0000-0000-000000000001"}');
select pg_temp.denied('00000000-0000-0000-0000-000000000001','review','{"refuel_id":1,"received":true}');
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','review','{"refuel_id":1,"received":true}');
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','review','{"refuel_id":1,"received":false}');
select public.fuel_receipt_command('00000000-0000-0000-0000-000000000003','exports');
