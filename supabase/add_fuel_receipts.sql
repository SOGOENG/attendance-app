-- PREPARATION ONLY. Apply as DB owner AFTER driving-report, destination,
-- submission, pre-drive-alcohol migrations. No production execution by Codex.
begin;
create table public.fuel_receipt_roles (
 employee_id bigint primary key references public.employees(id),
 granted_by bigint not null references public.employees(id), granted_at timestamptz not null default now()
);
create function public.can_manage_fuel_receipts() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employees e where e.auth_user_id=auth.uid() and e.active
 and (e.admin_scope='all' or exists(select 1 from public.fuel_receipt_roles a where a.employee_id=e.id)))
$$;
create table public.fuel_receipts (
 id uuid primary key, refuel_id bigint references public.driving_refuels(id) on delete set null,
 report_id bigint not null references public.driving_reports(id), employee_id bigint not null references public.employees(id),
 object_path text not null unique, original_name text not null, mime text not null check(mime in ('image/jpeg','image/png','application/pdf')),
 bytes bigint not null check(bytes between 1 and 8388608), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('pending','active','removed','deleting','archived')),
 saved_at timestamptz not null default now(), deleted_at timestamptz,
 unique(id,sha256)
);
create unique index fuel_receipts_one_active on public.fuel_receipts(refuel_id) where state='active';
create unique index fuel_receipts_one_pending on public.fuel_receipts(refuel_id) where state='pending';
create index fuel_receipts_report_idx on public.fuel_receipts(report_id);
create table public.fuel_receipt_reviews (
 refuel_id bigint primary key references public.driving_refuels(id) on delete cascade,
 received boolean not null default false, received_at timestamptz, received_by bigint references public.employees(id)
);
create table public.fuel_receipt_exports (
 id uuid primary key default gen_random_uuid(), month date not null check(extract(day from month)=1),
 actor_id bigint not null references public.employees(id), created_at timestamptz not null default now(),
 state text not null default 'started' check(state in ('started','generated','downloaded','failed')),
 manifest jsonb not null, downloaded_at timestamptz,
 backup_location text, backup_checked_at timestamptz, backup_checked_by bigint references public.employees(id),
 legal_checked boolean not null default false, approved_at timestamptz, approved_by bigint references public.employees(id), error text
);
alter table public.fuel_receipts
 add column deletion_kind text check(deletion_kind in ('draft','archive')),
 add column deletion_export_id uuid references public.fuel_receipt_exports(id);
create table public.fuel_receipt_audit (
 id bigint generated always as identity primary key, actor_id bigint references public.employees(id),
 event text not null, target text, details jsonb not null default '{}', happened_at timestamptz not null default now()
);
-- No browser write grants. All mutations use the service-only command after Auth verification.
alter table public.fuel_receipt_roles enable row level security;
alter table public.fuel_receipts enable row level security;
alter table public.fuel_receipt_reviews enable row level security;
alter table public.fuel_receipt_exports enable row level security;
alter table public.fuel_receipt_audit enable row level security;
create policy receipt_read on public.fuel_receipts for select to authenticated
 using(employee_id=public.current_employee_id() or public.can_manage_fuel_receipts());
create policy receipt_roles_read on public.fuel_receipt_roles for select to authenticated
 using(public.is_application_admin());
create policy receipt_reviews_read on public.fuel_receipt_reviews for select to authenticated
 using(public.can_manage_fuel_receipts() or exists(select 1 from public.driving_refuels f join public.driving_reports r on r.id=f.driving_report_id where f.id=refuel_id and r.employee_id=public.current_employee_id()));
create policy receipt_exports_read on public.fuel_receipt_exports for select to authenticated using(public.can_manage_fuel_receipts());
create policy receipt_audit_read on public.fuel_receipt_audit for select to authenticated using(public.can_manage_fuel_receipts());
revoke all on public.fuel_receipt_roles,public.fuel_receipts,public.fuel_receipt_reviews,public.fuel_receipt_exports,public.fuel_receipt_audit from public,anon,authenticated,service_role;
revoke all on sequence public.fuel_receipt_audit_id_seq from public,anon,authenticated,service_role;
grant select on public.fuel_receipt_roles,public.fuel_receipts,public.fuel_receipt_reviews,public.fuel_receipt_exports,public.fuel_receipt_audit to authenticated;
revoke all on function public.can_manage_fuel_receipts() from public,anon;
grant execute on function public.can_manage_fuel_receipts() to authenticated;

-- Freeze uploaded versions against submission races without changing submit_driving_report.
create function public.fuel_receipt_report_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='submitted' and old.status='draft' and exists(select 1 from public.fuel_receipts where report_id=old.id and state in ('pending','deleting')) then
  raise exception 'receipt_upload_pending';
 end if;
 return new;
end $$;
create trigger fuel_receipt_report_guard before update on public.driving_reports for each row execute function public.fuel_receipt_report_guard();
create function public.fuel_receipt_refuel_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.fuel_receipts where refuel_id=old.id and state in ('active','pending','deleting')) then
  raise exception 'remove_receipt_before_refuel';
 end if;
 return old;
end $$;
create trigger fuel_receipt_refuel_guard before delete on public.driving_refuels for each row execute function public.fuel_receipt_refuel_guard();

-- Called ONLY by Edge Function service_role, actor UUID comes from auth.getUser(token).
create function public.fuel_receipt_command(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 a public.employees%rowtype; mgr boolean; admin boolean; r public.driving_reports%rowtype;
 f public.driving_refuels%rowtype; c public.fuel_receipts%rowtype; j public.fuel_receipt_exports%rowtype;
 result jsonb; m date; manifest jsonb; n bigint; old_id uuid;
begin
 if (select count(*) from public.employees where auth_user_id=p_actor and active)<>1 then raise exception 'active_employee_required' using errcode='42501'; end if;
 select * into a from public.employees where auth_user_id=p_actor and active;
 if not found then raise exception 'active_employee_required' using errcode='42501'; end if;
 admin:=a.admin_scope='all';
 mgr:=coalesce(admin,false) or exists(select 1 from public.fuel_receipt_roles where employee_id=a.id);
 if p_action='access' then return jsonb_build_object('manager',mgr,'admin',coalesce(admin,false)); end if;
 if p_action='roles' then
  if not coalesce(admin,false) then raise exception 'admin_required' using errcode='42501'; end if;
  if p_data ? 'employee_id' then
   if (p_data->>'enabled')::boolean then
    insert into public.fuel_receipt_roles(employee_id,granted_by) select id,a.id from public.employees where id=(p_data->>'employee_id')::bigint and active on conflict do nothing;
   else delete from public.fuel_receipt_roles where employee_id=(p_data->>'employee_id')::bigint; end if;
   insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,'role_change',p_data->>'employee_id',p_data);
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'accounting',g.employee_id is not null,'admin',e.admin_scope='all') order by e.id),'[]') from public.employees e left join public.fuel_receipt_roles g on g.employee_id=e.id where e.active);
 end if;
 if p_action='list' then
  if not mgr then raise exception 'accounting_required' using errcode='42501'; end if;
  m:=((p_data->>'month')||'-01')::date;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.fuel_date,t.refuel_id),'[]') from (
   select f.id refuel_id,(f.refueled_at at time zone 'Asia/Tokyo')::date fuel_date,r.id report_id,r.status,
    r.employee_id,r.employee_name_snapshot employee_name,r.vehicle_id,r.vehicle_number_snapshot vehicle,
    f.liters,f.odometer_km,c.id receipt_id,c.original_name,c.mime,c.bytes,c.sha256,c.state,c.saved_at,
    coalesce(v.received,false) received,v.received_at,e.name received_by
   from public.driving_refuels f join public.driving_reports r on r.id=f.driving_report_id
   left join lateral (select x.* from public.fuel_receipts x where x.refuel_id=f.id and x.state in ('active','deleting','archived') order by case x.state when 'active' then 0 when 'deleting' then 1 else 2 end,x.saved_at desc limit 1) c on true
   left join public.fuel_receipt_reviews v on v.refuel_id=f.id left join public.employees e on e.id=v.received_by
   where f.refueled_at>=m::timestamp at time zone 'Asia/Tokyo' and f.refueled_at<(m+interval '1 month')::timestamp at time zone 'Asia/Tokyo'
   and (not p_data ? 'employee_id' or r.employee_id=(p_data->>'employee_id')::bigint)
   and (not p_data ? 'vehicle_id' or r.vehicle_id=(p_data->>'vehicle_id')::bigint)
   and (not p_data ? 'received' or coalesce(v.received,false)=(p_data->>'received')::boolean)
   and (not coalesce((p_data->>'missing')::boolean,false) or c.id is null)
  ) t);
 end if;
 if p_action in ('get','reserve','review') then
  select * into f from public.driving_refuels where id=(p_data->>'refuel_id')::bigint for key share;
  select * into r from public.driving_reports where id=f.driving_report_id for update;
  if r.id is null or (r.employee_id<>a.id and not mgr) then raise exception 'receipt_access_denied' using errcode='42501'; end if;
  if p_action='get' then
   return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.fuel_receipts x where refuel_id=f.id and state in ('active','pending','deleting','archived'));
  elsif p_action='review' then
   if not mgr then raise exception 'accounting_required' using errcode='42501'; end if;
   select to_jsonb(v) into result from public.fuel_receipt_reviews v where v.refuel_id=f.id;
   insert into public.fuel_receipt_reviews values(f.id,(p_data->>'received')::boolean,
    case when (p_data->>'received')::boolean then now() end,case when (p_data->>'received')::boolean then a.id end)
   on conflict(refuel_id) do update set received=excluded.received,received_at=excluded.received_at,received_by=excluded.received_by;
   insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,'original_receipt_correction',f.id::text,jsonb_build_object('before',result,'after',p_data));
   return '{}';
  end if;
  if r.employee_id<>a.id or r.status<>'draft' or r.driving_status<>'driven' then raise exception 'own_draft_required' using errcode='42501'; end if;
  if r.vehicle_id is null then raise exception 'vehicle_required'; end if;
  select * into c from public.fuel_receipts where id=(p_data->>'id')::uuid;
  if found then
   if c.refuel_id<>f.id or c.employee_id<>a.id or c.sha256<>p_data->>'sha256' or c.bytes<>(p_data->>'bytes')::bigint then raise exception 'idempotency_conflict'; end if;
   return to_jsonb(c);
  end if;
  perform pg_advisory_xact_lock(78241,1);
  select coalesce(sum(bytes),0) into n from public.fuel_receipts where state not in ('removed','archived');
  if n+(p_data->>'bytes')::bigint>838860800 then raise exception 'receipt_storage_quota_exceeded'; end if;
  insert into public.fuel_receipts(id,refuel_id,report_id,employee_id,object_path,original_name,mime,bytes,sha256,state)
   values((p_data->>'id')::uuid,f.id,r.id,a.id,(p_data->>'id')||'/'||(p_data->>'sha256'),
    left(p_data->>'name',180),p_data->>'mime',(p_data->>'bytes')::bigint,p_data->>'sha256','pending') returning * into c;
  insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,'upload_reserved',c.id::text,to_jsonb(c));
  return to_jsonb(c);
 end if;
 if p_action in ('view','finalize','remove_begin','remove_done','archive_begin','archive_done','file_failure') then
  select * into c from public.fuel_receipts where id=(p_data->>'id')::uuid;
  if not found or (c.employee_id<>a.id and not mgr) then raise exception 'receipt_access_denied' using errcode='42501'; end if;
  select * into r from public.driving_reports where id=c.report_id for update;
  select * into c from public.fuel_receipts where id=(p_data->>'id')::uuid for update;
  if p_action='view' then
   if c.state<>'active' then raise exception 'receipt_not_available'; end if;
   insert into public.fuel_receipt_audit(actor_id,event,target) values(a.id,'view',c.id::text);
   return to_jsonb(c);
  end if;
  if p_action in ('finalize','remove_begin','remove_done') then
   if c.employee_id<>a.id or r.status<>'draft' then raise exception 'own_draft_required' using errcode='42501'; end if;
   if p_action='finalize' then
    if c.state='active' then return to_jsonb(c); end if;
    if c.state<>'pending' then raise exception 'upload_not_pending'; end if;
    -- Old version remains recoverable until explicitly removed via Storage API.
    select id into old_id from public.fuel_receipts where refuel_id=c.refuel_id and state='active';
    if old_id is not null then raise exception 'remove_old_receipt_first'; end if;
    update public.fuel_receipts set state='active',saved_at=now() where id=c.id returning * into c;
   elsif p_action='remove_begin' then
    if c.state not in ('active','pending','deleting','removed') or (c.state='deleting' and c.deletion_kind is distinct from 'draft') then raise exception 'receipt_locked'; end if;
    -- Block concurrent submission until the Storage delete is confirmed.
    if c.state<>'removed' then update public.fuel_receipts set state='deleting',deletion_kind='draft',deletion_export_id=null where id=c.id returning * into c; end if;
   else
    if c.state not in ('deleting','removed') or c.deletion_kind is distinct from 'draft' then raise exception 'delete_not_started'; end if;
    update public.fuel_receipts set state='removed',deleted_at=coalesce(deleted_at,now()) where id=c.id returning * into c;
   end if;
  elsif p_action='file_failure' then
   if not mgr and (c.employee_id<>a.id or r.status<>'draft') then raise exception 'receipt_access_denied'; end if;
   insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,'file_failure',c.id::text,p_data);
   return '{}';
  else
   if not coalesce(admin,false) then raise exception 'admin_required' using errcode='42501'; end if;
   select * into j from public.fuel_receipt_exports where id=(p_data->>'export_id')::uuid for update;
   if j.approved_at is null or j.backup_checked_at is null or not j.legal_checked or j.state<>'downloaded'
    or c.saved_at>now()-interval '1 year' or not exists(select 1 from jsonb_array_elements(j.manifest->'files') x where x->>'id'=c.id::text and x->>'sha256'=c.sha256) then
    raise exception 'archive_preconditions_not_met';
   end if;
   if c.state in ('deleting','archived') and (c.deletion_kind is distinct from 'archive' or c.deletion_export_id is distinct from j.id) then raise exception 'delete_context_mismatch'; end if;
   if p_action='archive_begin' then
    if c.state not in ('active','deleting','archived') then raise exception 'receipt_locked'; end if;
    if c.state<>'archived' then update public.fuel_receipts set state='deleting',deletion_kind='archive',deletion_export_id=j.id where id=c.id returning * into c; end if;
   else
    if c.state not in ('deleting','archived') then raise exception 'archive_not_started'; end if;
    update public.fuel_receipts set state='archived',deleted_at=coalesce(deleted_at,now()) where id=c.id returning * into c;
   end if;
  end if;
  insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,p_action,c.id::text,p_data);
  return to_jsonb(c);
 end if;
 if not mgr then raise exception 'accounting_required' using errcode='42501'; end if;
 if p_action='archive_batch' then
  if not coalesce(admin,false) then raise exception 'admin_required' using errcode='42501'; end if;
  insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,'archive_batch',p_data->>'export_id',p_data);
  return '{}';
 elsif p_action='exports' then
  return jsonb_build_object('jobs',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('candidates',
    (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'bytes',q.bytes,'state',q.state)),'[]') from public.fuel_receipts q
     where q.state in ('active','deleting') and q.saved_at<=now()-interval '1 year'
     and exists(select 1 from jsonb_array_elements(x.manifest->'files') y where y->>'id'=q.id::text and y->>'sha256'=q.sha256))) order by created_at desc),'[]') from (select * from public.fuel_receipt_exports order by created_at desc limit 100) x),
   'bytes',(select coalesce(sum(bytes),0) from public.fuel_receipts where state not in ('removed','archived')),
   'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by happened_at desc),'[]') from (select * from public.fuel_receipt_audit order by id desc limit 100) x));
 elsif p_action='export_start' then
  m:=((p_data->>'month')||'-01')::date;
  -- Take a frozen snapshot of ALL monthly fuel rows (including missing receipts).
  result:=public.fuel_receipt_command(p_actor,'list',jsonb_build_object('month',p_data->>'month'));
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'path',c.object_path,'sha256',c.sha256,'bytes',c.bytes,'mime',c.mime,'refuel_id',c.refuel_id)),'[]') into manifest
  from public.fuel_receipts c where c.state='active' and c.id in (select (x->>'receipt_id')::uuid from jsonb_array_elements(result) x where x->>'receipt_id' is not null);
  insert into public.fuel_receipt_exports(month,actor_id,manifest) values(m,a.id,jsonb_build_object('rows',result,'files',manifest)) returning * into j;
 elsif p_action in ('export_generated','export_downloaded','export_failed','backup','approve') then
  select * into j from public.fuel_receipt_exports where id=(p_data->>'export_id')::uuid for update;
  if not found then raise exception 'export_not_found'; end if;
  if p_action in ('backup','approve','export_failed') and exists(select 1 from public.fuel_receipts where state='deleting' and deletion_export_id=j.id) then raise exception 'archive_in_progress'; end if;
  if p_action in ('export_generated','export_downloaded','export_failed') and j.actor_id<>a.id then raise exception 'export_actor_required'; end if;
  if p_action='export_generated' then
   if j.state<>'started' then raise exception 'export_state_conflict'; end if;
   update public.fuel_receipt_exports set state='generated' where id=j.id;
  elsif p_action='export_downloaded' then
   if j.state<>'generated' then raise exception 'export_not_generated'; end if;
   update public.fuel_receipt_exports set state='downloaded',downloaded_at=now() where id=j.id;
  elsif p_action='export_failed' then
   update public.fuel_receipt_exports set state='failed',error=left(p_data->>'error',500) where id=j.id;
  elsif p_action='backup' then
   if j.state<>'downloaded' or length(trim(coalesce(p_data->>'location','')))<3 or not coalesce((p_data->>'legal_checked')::boolean,false) then raise exception 'backup_attestations_required'; end if;
   if jsonb_array_length(j.manifest->'files')=0 or p_data->'verified_files' is null then raise exception 'verified_manifest_required'; end if;
   if exists((select x->>'id',x->>'sha256' from jsonb_array_elements(j.manifest->'files') x except select x->>'id',x->>'sha256' from jsonb_array_elements(p_data->'verified_files') x)
    union all (select x->>'id',x->>'sha256' from jsonb_array_elements(p_data->'verified_files') x except select x->>'id',x->>'sha256' from jsonb_array_elements(j.manifest->'files') x))
    or jsonb_array_length(p_data->'verified_files')<>jsonb_array_length(j.manifest->'files') then raise exception 'backup_manifest_mismatch'; end if;
   update public.fuel_receipt_exports set backup_location=p_data->>'location',backup_checked_at=now(),backup_checked_by=a.id,legal_checked=true,approved_at=null,approved_by=null where id=j.id;
  else
   if not coalesce(admin,false) or j.backup_checked_at is null or not j.legal_checked then raise exception 'archive_approval_denied'; end if;
   update public.fuel_receipt_exports set approved_at=now(),approved_by=a.id where id=j.id;
  end if;
  select * into j from public.fuel_receipt_exports where id=j.id;
 else raise exception 'unknown_receipt_action'; end if;
 insert into public.fuel_receipt_audit(actor_id,event,target,details) values(a.id,p_action,j.id::text,p_data-'verified_files');
 return to_jsonb(j);
end $$;
revoke all on function public.fuel_receipt_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fuel_receipt_command(uuid,text,jsonb) to service_role;
revoke all on function public.fuel_receipt_report_guard(),public.fuel_receipt_refuel_guard() from public,anon,authenticated;

-- Private bucket; browser Storage APIs are explicitly blocked even if another
-- existing permissive policy would otherwise allow every authenticated bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fuel-receipts','fuel-receipts',false,8388608,array['image/jpeg','image/png','application/pdf']);
create policy fuel_receipts_service_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'fuel-receipts') with check(bucket_id<>'fuel-receipts');
notify pgrst,'reload schema';
commit;
