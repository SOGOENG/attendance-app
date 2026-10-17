-- Isolated local fixture only. All role changes roll back.
\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$declare a uuid:='00000000-0000-0000-0000-000000000003'; e uuid:='00000000-0000-0000-0000-000000000002'; u uuid:='00000000-0000-0000-0000-000000000001'; actor uuid; enabled boolean;
begin
 perform public.fuel_receipt_command(a,'roles','{"employee_id":2,"enabled":true}');
 foreach actor in array array[e,u] loop
  foreach enabled in array array[true,false] loop
   begin
    perform public.fuel_receipt_command(actor,'roles',jsonb_build_object('employee_id',1,'enabled',enabled));
    raise exception 'unauthorized roles mutation allowed';
   exception when insufficient_privilege then
    if sqlerrm<>'admin_required' then raise;end if;
   end;
  end loop;
 end loop;
 perform public.fuel_receipt_command(a,'roles','{"employee_id":1,"enabled":true}');
 perform public.fuel_receipt_command(a,'roles','{"employee_id":1,"enabled":false}');
 perform public.fuel_receipt_command(a,'roles','{"employee_id":3,"enabled":false}');
 if public.fuel_receipt_command(a,'access')->>'admin'<>'true' or public.fuel_receipt_command(a,'access')->>'manager'<>'true' then raise exception 'admin lost access';end if;
 if public.fuel_receipt_command(e,'access')->>'manager'<>'true' or public.fuel_receipt_command(e,'access')->>'admin'<>'false' then raise exception 'accountant access wrong';end if;
 raise notice 'PASS admin grant/revoke, accountant/employee direct role changes denied, admin without membership retains full access';
end$$;
rollback;
