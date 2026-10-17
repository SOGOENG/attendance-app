-- Connect directly as authenticated. Fixture receipts already exist (one per employee).
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 if current_user<>'authenticated' then raise exception 'must connect as authenticated';end if;
 if (select count(*) from public.fuel_receipts)<>1 then raise exception 'RLS receipt leak';end if;
 begin perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000003','access','{}');raise exception 'forged service call allowed';exception when insufficient_privilege then null;end;
 begin update public.fuel_receipts set state='archived';raise exception 'direct update allowed';exception when insufficient_privilege then null;end;
 begin insert into public.fuel_receipt_roles(employee_id,granted_by) values(1,1);raise exception 'role escalation allowed';exception when insufficient_privilege then null;end;
 delete from storage.objects where bucket_id='fuel-receipts';
 if found then raise exception 'Storage delete allowed';end if;
 if exists(select 1 from storage.objects where bucket_id='fuel-receipts') then raise exception 'Storage read leaked';end if;
 begin insert into storage.objects(bucket_id,name) values('fuel-receipts','spoof');raise exception 'Storage insert allowed';exception when insufficient_privilege then null;end;
 raise notice 'PASS receipt RLS, no direct writes/role escalation, service RPC inaccessible, restrictive Storage policy';
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 if (select count(*) from public.fuel_receipts)<>2 then raise exception 'accountant receipt access';end if;
 begin delete from public.fuel_receipt_audit;raise exception 'audit deletable';exception when insufficient_privilege then null;end;
 raise notice 'PASS accounting reads all receipts but cannot delete audit';
end$$;
