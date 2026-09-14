-- Standalone SQL Editor regression test. Only temporary tables are written.
-- This executes the same classification query as the production migration.
begin;
create temporary table test_tools(tool_group text,tool_name text,management_code text,
  inspection_required boolean,inspection_category text) on commit drop;
insert into test_tools values
 ('その他','3P表記','T-001',true,'3p'),('その他','3P表記','T-002',true,'3P'),
 ('その他','絶縁表記','D-001',true,'double_insulated'),('その他','絶縁表記','D-002',true,'二重絶縁'),
 ('その他','混在対象','M-001',true,'3p'),('その他','混在対象','M-002',false,'3p'),
 ('その他','混在区分','C-001',true,'3p'),('その他','混在区分','C-002',true,'二重絶縁'),
 ('その他','要確認区分','U-001',true,'要確認'),
 ('その他','複数接頭辞','A-001',false,null),('その他','複数接頭辞','B-001',false,null),
 ('配管加工機','旋盤','SB-1IN-001',true,'3P'),('配管加工機','旋盤','SB-4IN-001',true,'3p'),
 ('その他','点検区分なし','N-001',false,null),
 ('その他','対象NULL','X-001',null,null),('その他','番号NULL',null,true,'3p'),
 ('その他','不明区分','Y-001',true,'不明'),
 ('その他','NULL混在','Z-001',true,null),('その他','NULL混在','Z-002',true,'3p'),
 ('別分類','旋盤','OTHER-001',true,'3p'),
 ('その他','未設定初期区分','Q-001',true,null);
create temporary table original_tools on commit drop as select * from test_tools;
create temporary table classified on commit drop as
-- BEGIN SEED QUERY
with normalized as (
  select t.*,
    case inspection_category
      when '3P' then '3p'
      when '二重絶縁' then 'double_insulated'
      else inspection_category end as normalized_category,
    case when management_code ~ '^.+-[0-9]+$'
      then regexp_replace(management_code, '-[0-9]+$', '') end as parsed_prefix
  from test_tools t
), grouped as (
  select tool_group, tool_name, count(*) as tool_count,
    array_agg(distinct management_code order by management_code) as management_codes,
    array_agg(distinct parsed_prefix) as prefixes,
    array_agg(distinct inspection_required) as required_values,
    array_agg(distinct inspection_category) as original_categories,
    array_agg(distinct normalized_category) as category_values,
    bool_and(coalesce(management_code ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*-[0-9]+$', false)) as valid_codes,
    bool_and(coalesce(management_code ~ '^SB-(1IN|2IN|3IN|4IN)-[0-9]+$', false)) as lathe_size_codes
  from normalized group by tool_group, tool_name
), reviewed as (
  select g.*,
    case when tool_name = '旋盤' and lathe_size_codes then 'SB' else prefixes[1] end as proposed_prefix,
    array_remove(array[
      case when tool_group is null or btrim(tool_group) = '' or tool_group <> btrim(tool_group)
        or tool_name is null or btrim(tool_name) = '' or tool_name <> btrim(tool_name)
        then '大分類・工具名が空または前後空白あり' end,
      case when not valid_codes then '管理番号が未設定または未対応形式' end,
      case when tool_name = '旋盤' and not lathe_size_codes then '旋盤の想定外接頭辞（SB-1IN〜SB-4IN以外）' end,
      case when tool_name is distinct from '旋盤' and cardinality(prefixes) <> 1 then '管理番号接頭辞が複数' end,
      case when cardinality(required_values) <> 1 or required_values[1] is null then '点検対象が混在またはNULL' end,
      case when cardinality(category_values) <> 1 then '正規化後の点検区分が混在' end,
      case when '要確認' = any(category_values) then '点検区分が要確認' end,
      case when exists (select 1 from unnest(category_values) category
        where category is not null and category not in ('3p','double_insulated','battery','cord_reel','ac_welder','dc_welder','要確認'))
        then '未対応の点検区分' end
    ]::text[], null) as review_reasons
  from grouped g
)
select *, cardinality(review_reasons) = 0 as auto_migrate from reviewed
-- END SEED QUERY
;
create temporary table test_catalog(tool_group text,tool_name text,code_prefix text,
  inspection_required boolean,inspection_category text,unique(tool_group,tool_name)) on commit drop;
insert into test_catalog
select tool_group,tool_name,proposed_prefix,required_values[1],category_values[1]
from classified where auto_migrate on conflict(tool_group,tool_name) do nothing;
-- Simulate an administrator changing a master before rerunning the migration.
update test_catalog set inspection_required=false where tool_name='3P表記';
insert into test_catalog
select tool_group,tool_name,proposed_prefix,required_values[1],category_values[1]
from classified where auto_migrate on conflict(tool_group,tool_name) do nothing;
do $$
begin
  assert (select count(*) from test_catalog)=5, 'only five safe names should migrate';
  assert (select inspection_category from test_catalog where tool_name='3P表記')='3p';
  assert (select inspection_required from test_catalog where tool_name='3P表記')=false, 'rerun must preserve edits';
  assert (select inspection_category from test_catalog where tool_name='絶縁表記')='double_insulated';
  assert (select code_prefix from test_catalog where tool_name='旋盤')='SB', 'lathe size rule is not a conflict';
  assert not exists(select 1 from test_catalog where tool_name in ('混在対象','混在区分','要確認区分','複数接頭辞','対象NULL','番号NULL','不明区分','NULL混在'));
  assert not exists((select * from test_tools except all select * from original_tools)
    union all (select * from original_tools except all select * from test_tools)), 'source tools changed';
end;
$$;
select tool_group,tool_name,auto_migrate,review_reasons from classified order by tool_group,tool_name;
rollback;
