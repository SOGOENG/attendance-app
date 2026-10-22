with recursive
roots as (
  select c.oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where (n.nspname = 'public' and c.relname = 'employees')
     or (n.nspname = 'auth' and c.relname = 'users')
),
related(oid) as (
  select oid from roots
  union
  select k.conrelid
  from related r
  join pg_catalog.pg_constraint k
    on k.confrelid = r.oid
   and k.contype = 'f'
),
foreign_keys as (
  select k.*
  from pg_catalog.pg_constraint k
  where k.contype = 'f'
    and (
      k.conrelid in (select oid from related)
      or k.confrelid in (select oid from related)
    )
)
select jsonb_build_object(
  'scope',
  'Catalog only; no data changes or business function calls.',
  'related_tables',
  coalesce((
    select jsonb_agg(oid::regclass::text order by oid::regclass::text)
    from related
  ), '[]'::jsonb),
  'foreign_keys',
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', k.conname,
      'referencing_table', k.conrelid::regclass::text,
      'referenced_table', k.confrelid::regclass::text,
      'definition', pg_catalog.pg_get_constraintdef(k.oid),
      'on_delete', case k.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
      end,
      'validated', k.convalidated,
      'deferrable', k.condeferrable,
      'initially_deferred', k.condeferred
    ) order by k.conrelid::regclass::text, k.conname)
    from foreign_keys k
  ), '[]'::jsonb),
  'custom_triggers',
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', t.tgrelid::regclass::text,
      'trigger', t.tgname,
      'enabled', t.tgenabled,
      'definition', pg_catalog.pg_get_triggerdef(t.oid),
      'function', p.oid::regprocedure::text,
      'owner', pg_catalog.pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'config', p.proconfig,
      'function_definition', pg_catalog.pg_get_functiondef(p.oid)
    ) order by t.tgrelid::regclass::text, t.tgname)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where t.tgrelid in (select oid from related)
      and not t.tgisinternal
  ), '[]'::jsonb)
) as employee_deletion_dependency_audit;
