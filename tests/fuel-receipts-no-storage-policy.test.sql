-- Isolated fixture DB ONLY. Simulate Supabase's standard service-role grants,
-- but no pre-existing Storage policy. Roll back all changes.
\set ON_ERROR_STOP on
begin;
drop policy test_existing_broad_policy on storage.objects;
grant usage on schema storage to service_role;
grant select,insert,update,delete on storage.objects to service_role;
grant select on storage.buckets to service_role;
insert into storage.objects(bucket_id,name) values('fuel-receipts','private-test');
do $$begin
 if (select public from storage.buckets where id='fuel-receipts') is distinct from false then raise exception 'bucket not private';end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and permissive='PERMISSIVE') then raise exception 'test still has permissive policy';end if;
 raise notice 'PASS private bucket / no pre-existing permissive policies';
end$$;
set local role authenticated;
do $$begin
 if exists(select 1 from storage.objects where bucket_id='fuel-receipts') then raise exception 'employee can read file';end if;
 begin insert into storage.objects(bucket_id,name) values('fuel-receipts','forbidden');raise exception 'employee can upload';exception when insufficient_privilege then null;end;
 delete from storage.objects where bucket_id='fuel-receipts';if found then raise exception 'employee can delete';end if;
 raise notice 'PASS no-policy employee direct Storage access denied';
end$$;
reset role;
set local role anon;
do $$begin
 if exists(select 1 from storage.objects where bucket_id='fuel-receipts') then raise exception 'anon can read';end if;
 raise notice 'PASS no-policy anonymous Storage access denied';
end$$;
reset role;
set local role service_role;
do $$begin
 if not (select rolbypassrls from pg_roles where rolname=current_user) then raise exception 'service lacks BYPASSRLS';end if;
 if not exists(select 1 from storage.objects where name='private-test') then raise exception 'service cannot read';end if;
 insert into storage.objects(bucket_id,name) values('fuel-receipts','service-test');
 delete from storage.objects where name='service-test';if not found then raise exception 'service cannot delete';end if;
 raise notice 'PASS service Storage read/upload/delete without permissive policy';
end$$;
rollback;
