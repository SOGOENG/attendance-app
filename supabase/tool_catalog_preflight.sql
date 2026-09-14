-- Read-only: no tools values are normalized or written back.
-- AUTO: exact agreement after the two explicit spelling mappings.
-- MANUAL: skip this name; register its defaults later in the administrator screen.
-- Lathe SB-1IN..SB-4IN is one explicit size rule; catalog uses the marker SB.
-- BEGIN SEED QUERY
with normalized as (
  select t.*,
    case inspection_category
      when '3P' then '3p'
      when '二重絶縁' then 'double_insulated'
      else inspection_category end as normalized_category,
    case when management_code ~ '^.+-[0-9]+$'
      then regexp_replace(management_code, '-[0-9]+$', '') end as parsed_prefix
  from public.tools t
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
order by auto_migrate, tool_group, tool_name;

-- Legacy name-only callers cannot choose between groups.
select tool_name, array_agg(distinct tool_group) as groups
from public.tools group by tool_name having count(distinct tool_group) > 1;
