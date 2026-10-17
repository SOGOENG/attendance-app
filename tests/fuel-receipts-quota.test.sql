-- Isolated DB owner only. Synthetic quota records rolled back; no real objects.
\set ON_ERROR_STOP on
begin;
insert into public.fuel_receipts(id,report_id,employee_id,object_path,original_name,mime,bytes,sha256,state)
 select md5('quota'||n)::uuid,1,1,'quota/'||n,'quota.jpg','image/jpeg',8388608,repeat('a',64),'pending' from generate_series(1,100) n;
set local role service_role;
do $$begin
 begin
  perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','reserve','{"id":"40000000-0000-0000-0000-000000000004","refuel_id":1,"mime":"image/jpeg","bytes":100,"name":"quota.jpg","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}');
  raise exception 'quota bypassed';
 exception when others then if sqlerrm<>'receipt_storage_quota_exceeded' then raise;end if;end;
 raise notice 'PASS server-side 800MB quota rejected reservation';
end$$;
rollback;
