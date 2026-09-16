-- Read-only: run before site_master.sql. Keep results with a DB backup.
select count(*) as site_count,
md5(string_agg((to_jsonb(s)-'client_id'-'client_site_order')::text, E'\n' order by id)) as legacy_checksum
from public.sites s;
select column_name, data_type, character_maximum_length, column_default, is_nullable
from information_schema.columns where table_schema='public' and table_name='sites'
order by ordinal_position;
select client_name, client_code, count(*) as sites,
       min(input_code) as first_code, max(input_code) as last_code
from public.sites group by client_name, client_code order by client_name, client_code;
select input_code, count(*) from public.sites
where input_code is not null group by input_code having count(*) > 1;
select id, client_name, client_code from public.sites
where nullif(trim(client_name),'') is null or nullif(trim(client_code),'') is null;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.sites'::regclass or confrelid='public.sites'::regclass;
select policyname, roles, cmd, qual, with_check from pg_policies
where schemaname='public' and tablename='sites';
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid='public.sites'::regclass and not tgisinternal;
