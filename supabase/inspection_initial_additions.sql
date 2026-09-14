-- Apply manually after tool_catalog_registration.sql. Never rewrites existing tools/inspections.
-- New table proves that a tool was created by this operation, not an arbitrary historical tool.
begin;
create table if not exists public.tool_inspection_additions (
  tool_id bigint primary key references public.tools(id),
  inspection_cycle_id bigint not null references public.tool_inspection_cycles(id),
  request_id uuid not null unique,
  requested_record jsonb not null,
  lathe_size text,
  initial_purchase boolean not null,
  registered_by uuid not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
alter table public.tool_inspection_additions enable row level security;
revoke all on public.tool_inspection_additions from public, anon, authenticated;
grant select on public.tool_inspection_additions to authenticated;
drop policy if exists inspection_additions_admin_read on public.tool_inspection_additions;
create policy inspection_additions_admin_read on public.tool_inspection_additions
for select to authenticated using (public.is_tool_registration_admin());

-- Latest means actual inspection dates, never created_at or updated_at.
-- NULL dates sort last; start_date then id break ties deterministically.
create or replace function public.latest_completed_tool_inspection_cycle_id()
returns bigint language sql volatile security definer set search_path = '' as $$
  select id from public.tool_inspection_cycles where status='completed'
  order by end_date desc nulls last, start_date desc nulls last, id desc limit 1;
$$;
revoke all on function public.latest_completed_tool_inspection_cycle_id() from public,anon;
grant execute on function public.latest_completed_tool_inspection_cycle_id() to authenticated;

-- A narrow additional INSERT policy for initial inspections. Existing policies, grants,
-- and the current RLS-enabled setting on tool_inspections are retained.
-- Existing restrictive policies still apply; review their conditions with the preflight SQL.
drop policy if exists inspection_initial_addition_insert on public.tool_inspections;
create policy inspection_initial_addition_insert on public.tool_inspections
for insert to authenticated with check (
  public.is_tool_registration_admin() and exists (
    select 1 from public.tool_inspection_additions a
    join public.tool_inspection_cycles c on c.id=a.inspection_cycle_id
    where a.tool_id=tool_inspections.tool_id and c.cycle_code=tool_inspections.inspection_cycle
      and c.status='completed' and c.id=public.latest_completed_tool_inspection_cycle_id() and a.initial_purchase and a.consumed_at is null
  )
);

create or replace function public.register_inspection_tool(
  p_cycle_id bigint, p_record jsonb, p_lathe_size text,
  p_request_id uuid, p_initial_purchase boolean default false)
returns public.tools language plpgsql security definer set search_path = '' as $$
declare c public.tool_inspection_cycles%rowtype; t public.tools%rowtype;
  previous public.tool_inspection_additions%rowtype;
begin
  if not public.is_tool_registration_admin() then raise exception '工具管理者権限が必要です'; end if;
  if p_request_id is null then raise exception '登録要求IDがありません'; end if;
  -- Serializes retries, including a lost response after a successful commit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 7319));
  select * into previous from public.tool_inspection_additions where request_id=p_request_id;
  if found then
    if previous.registered_by is distinct from auth.uid()
       or previous.inspection_cycle_id is distinct from p_cycle_id
       or previous.requested_record is distinct from p_record
       or previous.lathe_size is distinct from p_lathe_size
       or previous.initial_purchase is distinct from p_initial_purchase then
      raise exception '登録要求の内容が一致しません。前回の登録を確認してください';
    end if;
    select * into strict t from public.tools where id=previous.tool_id;
    return t;
  end if;
  select * into strict c from public.tool_inspection_cycles where id=p_cycle_id for update;
  if c.status is distinct from 'active' and c.status is distinct from 'completed' then
    raise exception 'このサイクルには追加できません'; end if;
  if c.status='completed' and (p_initial_purchase is distinct from true
      or c.id is distinct from public.latest_completed_tool_inspection_cycle_id()) then
    raise exception '直近の完了済みサイクルへだけ、新規購入工具の初回点検を追加できます';
  end if;
  if p_record->>'ownership_type' not in ('shared','personal','contractor')
     or p_record->>'ownership_type' is null then raise exception '所有区分を選択してください'; end if;
  if p_record->>'ownership_type'='personal' and not exists(
    select 1 from public.employees where id=(p_record->>'assigned_employee_id')::bigint and active=true
  ) then raise exception '有効な所有者を選択してください'; end if;
  if p_record->>'ownership_type'='contractor' and coalesce(btrim(p_record->>'owner_company_name'),'')='' then
    raise exception '協力業者名を入力してください'; end if;
  if (p_record->>'inspection_required')::boolean is distinct from true then
    raise exception '今回点検する工具は点検対象に設定してください';
  end if;
  if p_record->>'inspection_category' is null or p_record->>'inspection_category' not in
    ('3p','double_insulated','battery','cord_reel','ac_welder','dc_welder') then
    raise exception '点検区分を選択してください'; end if;
  -- Existing admin registration and existing allocator, including lathe size rules.
  t := public.register_admin_tool(p_record,p_lathe_size);
  if t.inspection_required is distinct from true then raise exception '点検対象として登録できませんでした'; end if;
  insert into public.tool_inspection_additions(tool_id,inspection_cycle_id,request_id,
    requested_record,lathe_size,initial_purchase,registered_by)
  values(t.id,c.id,p_request_id,p_record,p_lathe_size,p_initial_purchase,auth.uid());
  return t;
end;
$$;
revoke all on function public.register_inspection_tool(bigint,jsonb,text,uuid,boolean) from public,anon;
grant execute on function public.register_inspection_tool(bigint,jsonb,text,uuid,boolean) to authenticated;

-- Existing REST INSERT is retained. The cycle lock makes validation, insert and next-number
-- advancement one transaction. No new save RPC or client-side sticker allocation.
create or replace function public.guard_tool_inspection_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.tool_inspection_cycles%rowtype; t public.tools%rowtype;
begin
  if not public.is_tool_registration_admin() then raise exception '工具管理者権限が必要です'; end if;
  select * into strict c from public.tool_inspection_cycles where cycle_code=new.inspection_cycle for update;
  select * into strict t from public.tools where id=new.tool_id for update;
  if t.inspection_required is distinct from true or t.status='disposed' then
    raise exception 'この工具は点検対象ではありません'; end if;
  if exists(select 1 from public.tool_inspections where tool_id=new.tool_id and inspection_cycle=new.inspection_cycle) then
    raise exception 'この工具は点検済みです。最新の結果を確認してください';
  end if;
  if c.status='completed' then
    if c.id is distinct from public.latest_completed_tool_inspection_cycle_id()
       or not exists(select 1 from public.tool_inspection_additions
        where tool_id=t.id and inspection_cycle_id=c.id and initial_purchase and consumed_at is null)
       or exists(select 1 from public.tool_inspections where tool_id=t.id) then
      raise exception '完了済みサイクルには今回新規登録した工具の初回点検だけ保存できます';
    end if;
  elsif c.status is distinct from 'active' then raise exception '点検中ではないサイクルです';
  end if;
  if new.sticker_number is null or new.sticker_number::text !~ '^[0-9]+$'
    or new.sticker_number::numeric < 1 then raise exception 'シール番号を確認してください'; end if;
  if exists(select 1 from public.tool_inspections where inspection_cycle=new.inspection_cycle
      and case when sticker_number::text ~ '^[0-9]+$'
        then sticker_number::numeric=new.sticker_number::numeric else false end) then
    raise exception 'このシール番号は使用済みです。実際に貼るシール番号を確認してください'; end if;
  select id into strict new.inspector_employee_id from public.employees
    where auth_user_id=auth.uid() and active=true;
  return new;
end;
$$;
create or replace function public.finish_tool_inspection_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.tool_inspection_cycles set
    next_sticker_number=greatest(next_sticker_number,new.sticker_number::bigint+1),updated_at=now()
    where cycle_code=new.inspection_cycle;
  update public.tool_inspection_additions set consumed_at=now() where tool_id=new.tool_id;
  return new;
end;
$$;
-- Completed results remain immutable; only existing CSV export bookkeeping is allowed.
create or replace function public.guard_completed_tool_inspection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.tool_inspection_cycles%rowtype;
begin
  select * into strict c from public.tool_inspection_cycles where cycle_code=old.inspection_cycle for update;
  if c.status='completed' then
    if tg_op='DELETE' then raise exception '完了済みの点検結果は削除できません'; end if;
    if (to_jsonb(new)-array['csv_exported','csv_exported_at','updated_at'])
      is distinct from (to_jsonb(old)-array['csv_exported','csv_exported_at','updated_at']) then
      raise exception '完了済みの点検結果は変更できません'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.inspection_cycle is distinct from old.inspection_cycle or new.tool_id is distinct from old.tool_id then
    raise exception '点検結果の工具・サイクルは変更できません'; end if;
  return new;
end;
$$;
revoke all on function public.guard_tool_inspection_insert() from public,anon,authenticated;
revoke all on function public.finish_tool_inspection_insert() from public,anon,authenticated;
revoke all on function public.guard_completed_tool_inspection() from public,anon,authenticated;
drop trigger if exists inspection_insert_guard on public.tool_inspections;
create trigger inspection_insert_guard before insert on public.tool_inspections
for each row execute function public.guard_tool_inspection_insert();
drop trigger if exists inspection_insert_finish on public.tool_inspections;
create trigger inspection_insert_finish after insert on public.tool_inspections
for each row execute function public.finish_tool_inspection_insert();
drop trigger if exists inspection_completed_guard on public.tool_inspections;
create trigger inspection_completed_guard before update or delete on public.tool_inspections
for each row execute function public.guard_completed_tool_inspection();
notify pgrst,'reload schema';
commit;
