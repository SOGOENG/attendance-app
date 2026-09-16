-- Run immediately after migration, BEFORE editing data. Compare count/checksum to preflight.
select count(*) as site_count,
md5(string_agg((to_jsonb(s)-'client_id'-'client_site_order')::text, E'\n' order by id)) as legacy_checksum
from public.sites s;
select id,name,code,visible,display_order from public.clients order by display_order,id;
-- Missing legacy names remain unlinked, displayed last; no row is deleted.
select id,display_name,client_name,client_code from public.sites where client_id is null;
select client_id,client_site_order,count(*) from public.sites
group by client_id,client_site_order having count(*)>1;
select input_code,count(*) from public.sites where input_code is not null and input_code<>''
group by input_code having count(*)>1;
select id,client_id,master_client_name,display_name,client_display_order,client_site_order,display_order
from public.site_master_order
order by client_display_order nulls last,client_site_order nulls last,display_order nulls last,id;
select policyname,roles,cmd,qual from pg_policies where schemaname='public' and tablename in ('sites','clients');
select has_function_privilege('anon','public.save_site_master(bigint,bigint,text,text,text,boolean,text)','execute') as anon_must_be_false,
has_function_privilege('authenticated','public.save_site_master(bigint,bigint,text,text,text,boolean,text)','execute') as authenticated_must_be_true;
