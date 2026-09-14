-- After add_tool_catalog.sql and tool_catalog_registration.sql.
-- Run in Supabase SQL Editor as postgres.
-- Verification rows are rolled back.

begin;


/* =========================================
   既存 tools の内容をハッシュで保存
========================================= */

select set_config(
  'app.tool_catalog_verify_tools_hash',
  (
    select md5(
      coalesce(
        jsonb_agg(
          to_jsonb(t)
          order by t.id
        )::text,
        '[]'
      )
    )
    from public.tools t
  ),
  true
);


/* =========================================
   採番テスト
========================================= */

do $$
declare
  v_code text;
  v_expected text;
  r record;
  v_size text;
begin

  insert into public.tool_catalog (
    tool_group,
    tool_name,
    code_prefix,
    inspection_required
  )
  values (
    'その他',
    '__catalog_verify__',
    'CATALOGVERIFY',
    false
  );


  v_code :=
    public.allocate_catalog_tool_management_code(
      'その他',
      '__catalog_verify__',
      null
    );


  select
    'CATALOGVERIFY-' ||
    lpad(
      n::text,
      greatest(3, length(n::text)),
      '0'
    )
  into v_expected
  from (
    select
      coalesce(
        max(
          substring(
            management_code
            from '([0-9]+)$'
          )::numeric
        ),
        0
      ) + 1 as n
    from public.tools
    where management_code ~
      '^CATALOGVERIFY-[0-9]+$'
  ) numbers;


  assert
    v_code = v_expected,
    'new catalog name allocation failed';


  /* 無効マスタを採番できないこと */

  update public.tool_catalog
  set active = false
  where tool_name =
    '__catalog_verify__';


  begin

    perform
      public.allocate_catalog_tool_management_code(
        'その他',
        '__catalog_verify__',
        null
      );

    raise exception
      'inactive name was accepted';

  exception
    when raise_exception then

      if sqlerrm =
        'inactive name was accepted'
      then
        raise;
      end if;

  end;


  /* 旋盤サイズ別採番 */

  foreach v_size
  in array array[
    '1IN',
    '2IN',
    '3IN',
    '4IN'
  ]
  loop

    select
      'SB-' ||
      v_size ||
      '-' ||
      lpad(
        n::text,
        greatest(
          3,
          length(n::text)
        ),
        '0'
      )
    into v_expected

    from (
      select
        coalesce(
          max(
            substring(
              management_code
              from '([0-9]+)$'
            )::numeric
          ),
          0
        ) + 1 as n

      from public.tools

      where
        regexp_replace(
          management_code,
          '-[0-9]+$',
          ''
        ) =
        'SB-' || v_size

        and management_code ~
          '^.+-[0-9]+$'

    ) numbers;


    assert
      public.allocate_tool_management_code(
        '旋盤',
        v_size
      ) = v_expected,
      'lathe sizing changed';

  end loop;


  /* 通常工具の既存最大番号＋1 */

  for r in

    select c.*

    from public.tool_catalog c

    where
      c.active
      and c.tool_name <> '旋盤'

  loop

    select
      r.code_prefix ||
      '-' ||
      lpad(
        n::text,
        greatest(
          3,
          length(n::text)
        ),
        '0'
      )
    into v_expected

    from (
      select
        coalesce(
          max(
            substring(
              t.management_code
              from '([0-9]+)$'
            )::numeric
          ),
          0
        ) + 1 as n

      from public.tools t

      where
        t.management_code ~
          '^.+-[0-9]+$'

        and regexp_replace(
          t.management_code,
          '-[0-9]+$',
          ''
        ) =
        r.code_prefix

    ) numbers;


    assert
      public.allocate_catalog_tool_management_code(
        r.tool_group,
        r.tool_name,
        null
      ) = v_expected,
      'existing maximum continuation failed';

  end loop;

end;
$$;


/* =========================================
   RLS確認
========================================= */

select
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where
  schemaname = 'public'
  and tablename = 'tool_catalog'
order by policyname;


select
  grantee,
  privilege_type
from information_schema.role_table_grants
where
  table_schema = 'public'
  and table_name = 'tool_catalog'
order by grantee, privilege_type;


/* =========================================
   一般社員相当での権限確認
========================================= */

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000000',
  true
);


set local role authenticated;


select count(*)
from public.tool_catalog;


do $$
declare
  affected integer;
begin

  /* INSERT不可 */

  begin

    insert into public.tool_catalog (
      tool_group,
      tool_name,
      code_prefix
    )
    values (
      'その他',
      '__forbidden__',
      'FORBIDDEN'
    );

    raise exception
      'non-admin insert was accepted';

  exception
    when insufficient_privilege then
      null;
  end;


  /* UPDATE不可 */

  update public.tool_catalog
  set active = true
  where tool_name =
    '__catalog_verify__';


  get diagnostics
    affected = row_count;


  assert
    affected = 0,
    'non-admin update was accepted';


  /* DELETE不可 */

  begin

    delete
    from public.tool_catalog
    where tool_name =
      '__catalog_verify__';

    raise exception
      'delete was accepted';

  exception
    when insufficient_privilege then
      null;
  end;

end;
$$;


reset role;


/* =========================================
   既存 tools が変わっていないことを確認
========================================= */

do $$
declare
  v_before text;
  v_after text;
begin

  v_before :=
    current_setting(
      'app.tool_catalog_verify_tools_hash'
    );


  select md5(
    coalesce(
      jsonb_agg(
        to_jsonb(t)
        order by t.id
      )::text,
      '[]'
    )
  )
  into v_after
  from public.tools t;


  assert
    v_before = v_after,
    'existing tools changed during verification';

end;
$$;


/* =========================================
   検証用データは残さない
========================================= */

rollback;