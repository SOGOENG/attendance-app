-- READ ONLY: one SELECT; no DDL, DML, locks, SET, or business RPC execution.
-- Run in the intended production project's SQL Editor as the intended installer
-- (normally postgres). Returns one JSON cell. Missing objects are reported.
-- Contains function definitions / security configuration: keep results local.
with
required_columns(table_name,column_name,expected_base_type) as (values
 ('vehicles','id','bigint'),('vehicles','active','boolean'),
 ('vehicles','vehicle_number','text'),('vehicles','vehicle_name','text'),
 ('employees','id','bigint'),('employees','auth_user_id','uuid'),
 ('employees','active','boolean'),('employees','admin_scope','text'),
 ('employees','default_vehicle_id','bigint'),
 ('driving_reports','id','bigint'),('driving_reports','employee_id','bigint'),
 ('driving_reports','vehicle_id','bigint'),('driving_reports','report_date','date'),
 ('driving_reports','status','text'),('driving_reports','driving_status','text'),
 ('driving_reports','end_odometer','numeric'),
 ('driving_refuels','id','bigint'),('driving_refuels','driving_report_id','bigint'),
 ('driving_refuels','refueled_at','timestamp with time zone'),
 ('driving_refuels','odometer_km','numeric'),('driving_refuels','liters','numeric'),
 ('driving_refuels','fuel_station','text'),('driving_refuels','payment_method','text')
), required_functions(signature,requirement) as (values
 ('auth.uid()','required'),('public.current_employee_id()','required'),
 ('public.is_application_admin()','required'),
 ('public.previous_vehicle_end_odometer(bigint,date)','required; replaced by migration'),
 ('public.set_my_default_vehicle(bigint)','required; inspect assignment lock'),
 ('public.my_initial_data_vehicles()','new; absence is normal'),
 ('public.can_use_vehicle_initial_data(bigint)','new; absence is normal'),
 ('public.get_vehicle_initial_data(bigint,date)','new; absence is normal'),
 ('public.save_vehicle_initial_data(bigint,date,numeric,date,numeric,numeric,text,text,bigint)','new; absence is normal')
), relations as (
 select c.*,n.nspname from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in
 ('vehicles','employees','driving_reports','driving_refuels','vehicle_initial_data')
), functions as (
 select p.*,n.nspname from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='auth' and p.proname='uid') or (n.nspname='public' and p.proname in
 ('current_employee_id','is_application_admin','previous_vehicle_end_odometer',
 'set_my_default_vehicle','admin_save_vehicle_master','admin_set_employee_managed_vehicle',
 'submit_driving_report','submit_driving_report_month','check_driving_report_month',
 'my_initial_data_vehicles','can_use_vehicle_initial_data','get_vehicle_initial_data','save_vehicle_initial_data'))
), roles as (
 select * from pg_catalog.pg_roles where rolname in ('postgres','authenticated','anon','service_role',current_user)
)
select jsonb_build_object(
 'notice','Catalog evidence only. Not an automatic production-apply approval. Employee records and business data are not read.',
 'runtime',jsonb_build_object('database',current_database(),'installer',current_user,
   'server_version',current_setting('server_version'),'search_path',current_setting('search_path'),
   'public_create',pg_catalog.has_schema_privilege(current_user,'public','CREATE'),
   'auth_usage',pg_catalog.has_schema_privilege(current_user,'auth','USAGE')),
 'required_columns',coalesce((select jsonb_agg(jsonb_build_object(
   'table',r.table_name,'column',r.column_name,'expected_base_type',r.expected_base_type,
   'actual_type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'status',case when a.attname is null then 'MISSING'
     when pg_catalog.format_type(a.atttypid,null)<>r.expected_base_type then 'TYPE_REVIEW' else 'OK' end)
   order by r.table_name,r.column_name)
   from required_columns r left join relations c on c.relname=r.table_name
   left join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname=r.column_name and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
 'required_functions',coalesce((select jsonb_agg(jsonb_build_object('signature',signature,'requirement',requirement,
   'exists',pg_catalog.to_regprocedure(signature) is not null) order by signature) from required_functions),'[]'::jsonb),
 'tables',coalesce((select jsonb_agg(jsonb_build_object('name',relname,'kind',relkind,
   'owner',pg_catalog.pg_get_userbyid(relowner),'installer_is_owner',relowner=(select oid from roles where rolname=current_user),
   'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl) order by relname) from relations),'[]'::jsonb),
 'columns_including_existing_initial_table',coalesce((select jsonb_agg(jsonb_build_object(
   'table',c.relname,'position',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum)
   from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,
   'type',k.contype,'valid',k.convalidated,'deferrable',k.condeferrable,
   'definition',pg_catalog.pg_get_constraintdef(k.oid)) order by c.relname,k.conname)
   from relations c join pg_catalog.pg_constraint k on k.conrelid=c.oid),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'valid',i.indisvalid,
   'definition',pg_catalog.pg_get_indexdef(i.indexrelid)) order by c.relname,i.indexrelid)
   from relations c join pg_catalog.pg_index i on i.indrelid=c.oid),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname)
   from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename in (select relname from relations)),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,
   'enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid)) order by c.relname,t.tgname)
   from relations c join pg_catalog.pg_trigger t on t.tgrelid=c.oid where not t.tgisinternal),'[]'::jsonb),
 'functions_all_overloads',coalesce((select jsonb_agg(jsonb_build_object('schema',p.nspname,'name',p.proname,
   'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'result',pg_catalog.pg_get_function_result(p.oid),
   'owner',pg_catalog.pg_get_userbyid(p.proowner),'installer_is_owner',p.proowner=(select oid from roles where rolname=current_user),
   'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,
   'definition',pg_catalog.pg_get_functiondef(p.oid)) order by p.nspname,p.proname,p.oid)
   from functions p where p.prokind='f'),'[]'::jsonb),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,
   'bypass_rls',rolbypassrls,'inherit',rolinherit) order by rolname) from roles),'[]'::jsonb),
 'table_privileges',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'role',r.rolname,
   'select',pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT'),
   'any_column_select',pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT'),
   'insert',pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT'),
   'update',pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE'),
   'delete',pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE'),
   'references',pg_catalog.has_table_privilege(r.oid,c.oid,'REFERENCES')) order by c.relname,r.rolname)
   from relations c cross join roles r),'[]'::jsonb),
 'column_acl',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl)
   order by c.relname,a.attnum) from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid
   where a.attnum>0 and not a.attisdropped and a.attacl is not null),'[]'::jsonb),
 'function_execute',coalesce((select jsonb_agg(jsonb_build_object('schema',p.nspname,'name',p.proname,
   'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'role',r.rolname,
   'execute',pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')) order by p.nspname,p.proname,p.oid,r.rolname)
   from functions p cross join roles r),'[]'::jsonb),
 'default_privileges',coalesce((select jsonb_agg(jsonb_build_object('owner',pg_catalog.pg_get_userbyid(d.defaclrole),
   'schema',n.nspname,'object_type',d.defaclobjtype,'acl',d.defaclacl) order by d.oid)
   from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
   where d.defaclnamespace=0 or n.nspname='public'),'[]'::jsonb),
 'ddl_event_triggers',coalesce((select jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,
   'enabled',e.evtenabled,'tags',e.evttags,'function',e.evtfoid::regprocedure::text) order by e.evtname)
   from pg_catalog.pg_event_trigger e),'[]'::jsonb)
) as vehicle_initial_data_preflight;
