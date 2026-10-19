// No SQL execution or network access. Run: node tests/driving-report-csv.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Blob } from 'node:buffer';
import { TextEncoder } from 'node:util';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const context=vm.createContext({window:{},Blob,TextEncoder});
vm.runInContext(await read('driving-report-period.js'),context);
context.DrivingReportPeriod=context.window.DrivingReportPeriod;
vm.runInContext(await read('driving-report-csv.js'),context);
const csv=context.window.DrivingReportCsv,period=context.DrivingReportPeriod;
const month='2026-10',span=period.range(month),uuid='12345678-1234-4123-8123-123456789abc';
const timestamp='2026-10-21T01:00:00.123456Z';
export function fixture(count=30){
  const data={source_version:'2',visibility_guarantee:'unfiltered_admin_v1',roster_basis:'manual_confirmation_required',closing_month:month+'-01',period_start:span.start,period_end:span.end,exported_at:timestamp,
    employees:[],submissions:[],reports:[],inspections:[],alcohol:[],refuels:[],history:[],history_summary:[],leave_applications:[],pending_receipts:[]};
  for(let n=1;n<=count;n++){
    const employee=String(n),reportId=String(1000+n),car=String(n);
    data.employees.push({id:employee,name:n===1?'鈴木,"和弘"\n日本語':`社員${n}`,department:'工事部',active:true});
    data.submissions.push({id:employee,employee_id:employee,submitted_by:employee,closing_month:month+'-01',period_start:span.start,period_end:span.end,rule_version:'1',submitted_at:timestamp,
      snapshot:{valid:true,errors:[],closing_month:month+'-01',period_start:span.start,period_end:span.end,
        days:span.days.map((date,i)=>({date,calendar:'休日',required:i===0,reason:i===0?'calendar_workday':'company_holiday',report_id:i===0?reportId:null,issue:null,attendance:null,leave_application_id:null,holiday_work_record_ids:[]}))}});
    data.reports.push({id:reportId,employee_id:employee,report_date:span.start,status:'submitted',driving_status:'driven',vehicle_id:car,vehicle_number_snapshot:`車両${n}`,vehicle_name_snapshot:'当時の車両',
      outbound_route_type:'office',return_route_type:'direct_return',start_odometer:'1000.0',end_odometer:'1020.5',distance_km:'20.5',accident_or_violation:false,submitted_at:timestamp,updated_at:timestamp,late_entry:false,late_entry_days:'0',alcohol_check_version:'2'});
    for(const code of csv.inspectionCodes)data.inspections.push({driving_report_id:reportId,inspection_item_code:code,result:'ok',note:null,checked_at:timestamp});
    for(const [i,type] of ['commute_before','return_before'].entries())data.alcohol.push({id:String(n*10+i),driving_report_id:reportId,check_type:type,checked_at:timestamp,alcohol_value:'0.000',is_zero:true,phone_confirmed:false,confirmation_method:'電話確認×',confirmed_by_employee_id:null,confirmed_by_name_snapshot:'中尾',note:null});
  }
  return data;
}
function fill(id,report,liters='10.125',meter='1001.0'){return {id,driving_report_id:report,refueled_at:span.start+'T00:00:00+09:00',liters,odometer_km:meter};}
function history(id,car='1',at='2026-09-20T00:00:00+09:00',formal=true,meter='900.0'){
  return {id,driving_report_id:'800',vehicle_id:car,report_date:at.slice(0,10),report_status:formal?'submitted':'draft',month_submission_id:formal?'700':null,refueled_at:at,liters:'20.500',odometer_km:meter};
}
// Test-only adapter for fixtures expressed as historical rows; actual SQL emits
// the bounded history + summary contract (tested against a local DB separately).
export function bounded(d){
  d=structuredClone(d);const keep=new Set(),cars=new Set(d.reports.filter(r=>r.vehicle_id).map(r=>String(r.vehicle_id)));
  const ticks=value=>BigInt(Date.parse(value))*1000n+BigInt((/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1]||'').slice(3).padEnd(3,'0'));
  d.history_summary=[...cars].map(vehicle_id=>{
    const all=d.history.filter(h=>h.vehicle_id===vehicle_id),formal=all.filter(h=>h.month_submission_id&&h.report_status==='submitted').sort((a,b)=>ticks(a.refueled_at)>ticks(b.refueled_at)?-1:ticks(a.refueled_at)<ticks(b.refueled_at)?1:BigInt(a.id)>BigInt(b.id)?-1:1);
    const selected=formal[0],earlier=formal.find(h=>selected&&ticks(h.refueled_at)<ticks(selected.refueled_at));
    if(selected)keep.add(selected.id);if(earlier)keep.add(earlier.id);
    return {vehicle_id,selected_id:selected?.id??null,earlier_id:earlier?.id??null,
      same_timestamp_candidate_count:selected?String(formal.filter(h=>ticks(h.refueled_at)===ticks(selected.refueled_at)).length):'0',
      has_newer_unconfirmed_history:all.some(h=>!formal.includes(h)&&(!selected||ticks(h.refueled_at)>=ticks(selected.refueled_at)))};
  });
  d.history=d.history.filter(h=>keep.has(h.id)||!cars.has(h.vehicle_id));return d;
}
const build=d=>csv.build(bounded(d),month,uuid);
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('30人・全日行・13点検・朝帰り検査・社員マスタ',()=>{
  const result=build(fixture());assert.equal(result.daily.length,900);assert.equal(result.previous.length,30);assert.equal(result.files.length,3);
  assert.equal(result.daily[0].inspection_brake_horn_result,'ok');assert.equal(result.daily[0].alcohol_commute_before_phone_confirmed,false);
  assert.equal(result.daily[0].alcohol_return_before_value,'0.000');assert.equal(result.daily[0].employee_name,'鈴木,"和弘"\n日本語');
  assert.equal(result.daily[0].exported_at,'2026-10-21T10:00:00.123456+09:00');assert.equal(result.previous[0].previous_refuel_status,'no_history');
});
test('CSV列順を設計書と照合・UTF8 BOM・引用符改行',()=>{
  const r=build(fixture(1));assert.equal(csv.dailyHeaders.length,138);assert.equal(csv.refuelHeaders.length,26);assert.equal(csv.previousHeaders.length,17);
  assert.equal(r.files[0].text.charCodeAt(0),0xfeff);assert(r.files[0].text.includes('"鈴木,""和弘""\n日本語"'));assert(r.files[0].text.includes('\r\n'));
  assert.equal(r.files[1].text.split('\r\n').length,2);assert.equal(new TextEncoder().encode(r.files[0].text)[0],239);
});
const design=await read('supabase/driving_report_csv_design.md');
test('設計書の基本列と実装順序が一致',()=>{
  const section=(start,end)=>design.slice(design.indexOf(start),design.indexOf(end));
  const columns=text=>[...text.matchAll(/^\| ([a-z][a-z_]+) \|/gm)].map(m=>m[1]);
  assert.deepEqual([...csv.dailyHeaders].slice(0,51),columns(section('## 5. 運転日報CSV','### 5.1')));
  assert.deepEqual([...csv.refuelHeaders],columns(section('## 6. 給油CSV','### 6.1')));
  assert.deepEqual([...csv.previousHeaders],columns(section('### 6.2','### 6.3')));
});
test('複数給油・精度を失わない合計・再出力',()=>{
  const d=fixture(1);d.refuels=[fill('9007199254740993','1001'),fill('9007199254740992','1001','20.001')];
  const r=build(d);assert.equal(r.fuel.length,2);assert.equal(r.fuel[0].refuel_id,'9007199254740992');assert.equal(r.daily[0].refuel_total_liters,'30.126');assert.equal(r.daily[0].refuel_count,'2');
  assert.equal(build(d).files[0].text,r.files[0].text);assert.equal(build(d).fuel.length,2);
});
test('月途中の車両変更は同社員の別車両として保持',()=>{
  const d=fixture(1),r={...d.reports[0],id:'1002',report_date:span.days[1],vehicle_id:'2',vehicle_number_snapshot:'新車'};
  d.reports.push(r);Object.assign(d.submissions[0].snapshot.days[1],{required:true,report_id:r.id});
  d.inspections.push(...d.inspections.map(i=>({...i,driving_report_id:r.id})));d.alcohol.push(...d.alcohol.map((a,i)=>({...a,id:String(50+i),driving_report_id:r.id})));
  d.refuels=[fill('1','1001'),{...fill('2','1002'),refueled_at:span.days[1]+'T00:00:00+09:00'}];
  const out=build(d);assert.equal(out.daily.length,30);assert.equal(out.previous.length,2);assert.equal(out.fuel[1].vehicle_id,'2');assert.equal(out.daily[1].vehicle_number,'新車');
});
test('有給・代休・会社休日・運転なしを区別',()=>{
  const d=fixture(1);Object.assign(d.reports[0],{driving_status:'no_driving',vehicle_id:null,vehicle_number_snapshot:null,vehicle_name_snapshot:null,outbound_route_type:null,return_route_type:null,start_odometer:null,end_odometer:null,distance_km:null});d.inspections=[];d.alcohol=[];
  Object.assign(d.submissions[0].snapshot.days[1],{reason:'approved_full_leave',leave_application_id:'88'});
  Object.assign(d.submissions[0].snapshot.days[2],{reason:'approved_full_leave',leave_application_id:'89'});
  d.leave_applications=[{id:'88',application_type:'paid_leave'},{id:'89',application_type:'comp_leave'}];
  const r=build(d);assert.equal(r.daily[0].day_state,'no_driving');assert.equal(r.daily[0].distance_km,'');assert.equal(r.daily[1].leave_type,'有給');assert.equal(r.daily[2].leave_type,'代休');assert.equal(r.daily[3].day_state,'exempt_company_holiday');assert.equal(r.previous.length,0);
});
test('前回給油は別社員を含む車両別・境界前・正式履歴',()=>{
  const d=fixture(1);d.history=[history('1'),history('2','1','2026-08-20T00:00:00+09:00',true,'800.0')];
  const r=build(d).previous[0];assert.equal(r.previous_refuel_status,'available');assert.equal(r.previous_refuel_id,'1');assert.equal(r.previous_liters,'20.500');assert.equal(r.previous_odometer_km,'900.0');
});
test('同時刻複数給油は最大IDを示して順序未確認',()=>{
  const d=fixture(1);d.history=[history('1'),history('2')];const r=build(d).previous[0];assert.equal(r.previous_refuel_status,'order_unconfirmed');assert.equal(r.previous_refuel_id,'2');assert.equal(r.same_timestamp_candidate_count,'2');
});
test('同日の異なる時刻・マイクロ秒精度を失わず最新を選択',()=>{
  const d=fixture(1);d.history=[history('99','1','2026-09-20T00:00:00.123400+09:00'),history('1','1','2026-09-20T00:00:00.123500+09:00')];
  const r=build(d).previous[0];assert.equal(r.previous_refuel_id,'1');assert.equal(r.previous_refuel_status,'available');assert.equal(r.previous_refueled_at,'2026-09-20T00:00:00.123500+09:00');
});
test('方式1は旧before/afterを保持し新方式へ変換しない',()=>{
  const d=fixture(1);d.reports[0].alcohol_check_version='1';
  d.alcohol.forEach((a,i)=>{a.check_type=i?'after':'before';a.phone_confirmed=null;a.confirmation_method='対面';a.confirmed_by_name_snapshot='旧確認者';a.confirmed_by_employee_id='4';});
  const r=build(d).daily[0];assert.equal(r.alcohol_before_confirmed_by_name,'旧確認者');assert.equal(r.alcohol_after_confirmation_method,'対面');assert.equal(r.alcohol_after_excel_confirmer_code,'');assert.equal(r.alcohol_commute_before_input_state,'not_applicable');
});
test('前回メーター逆転を検出し計算基準を確定しない',()=>{
  const d=fixture(1);d.history=[history('2','1','2026-09-20T00:00:00+09:00',true,'800.0'),history('1','1','2026-09-19T00:00:00+09:00',true,'900.0')];
  assert.equal(build(d).previous[0].previous_refuel_status,'needs_review');assert.equal(build(d).previous[0].previous_refuel_id,'2');
});
test('月別提出0人も名簿候補を確認可能・空CSVを正式出力操作では拒否',()=>{
  const d=fixture(1);d.submissions=[];d.reports=[];d.inspections=[];d.alcohol=[];const r=build(d);
  assert.equal(r.employees.length,1);assert.equal(r.submittedEmployeeIds.length,0);assert.equal(r.daily.length,0);
});
test('旧RPC・車両別集計の欠損を正式出力しない',()=>{
  const d=bounded(fixture(1));
  assert.throws(()=>csv.build({...d,source_version:'1'},month,uuid),/読取RPC/);
  assert.throws(()=>csv.build({...d,history_summary:[]},month,uuid),/前回給油/);
  assert.throws(()=>csv.build({...d,history_summary:[{...d.history_summary[0],selected_id:'999'}]},month,uuid),/前回給油/);
});
test('新しい未提出履歴・正式履歴なし・メーター欠損',()=>{
  const d=fixture(1);d.history=[history('1','1','2026-09-19T00:00:00+09:00'),history('2','1','2026-09-20T00:00:00+09:00',false)];
  assert.equal(build(d).previous[0].previous_refuel_status,'unconfirmed_history');d.history.shift();assert.equal(build(d).previous[0].previous_refuel_id,'');assert.equal(build(d).previous[0].previous_refuel_status,'unconfirmed_history');
  d.history=[history('3','1',undefined,true,null)];assert.equal(build(d).previous[0].previous_refuel_status,'needs_review');
});
test('bigint JSON数値を文字列化して読み取り・文字列を破壊しない',()=>{
  const r=csv.parseSource('{"id":9007199254740993,"note":"123 \\"456\\"","value":0.000,"flag":false}');
  assert.equal(r.id,'9007199254740993');assert.equal(r.note,'123 "456"');assert.equal(r.value,'0.000');assert.equal(r.flag,false);
});
test('未提出・日別提出だけの社員を正式出力しない',()=>{
  const d=fixture(1);d.employees.push({id:'2',name:'日別提出のみ',active:true});const r=build(d);assert.equal(r.submittedEmployeeIds.length,1);assert(!r.daily.some(row=>row.employee_id==='2'));
});
test('欠損・重複・不整合時は全体停止',()=>{
  const cases=[d=>d.reports.pop(),d=>d.inspections.pop(),d=>d.alcohol.pop(),d=>d.employees.pop(),d=>d.submissions[0].snapshot.days.pop(),
    d=>d.submissions[0].snapshot.days[1]=d.submissions[0].snapshot.days[0],d=>d.inspections.push(d.inspections[0]),d=>d.reports.push(d.reports[0]),
    d=>d.pending_receipts.push('1001'),d=>d.reports[0].status='draft',d=>d.reports[0].distance_km='999.0',d=>d.submissions[0].snapshot.days[0].issue='report_missing',
    d=>d.refuels.push(fill('1','999')),d=>d.history.push(history('1','1',span.start+'T00:00:00+09:00'))];
  for(const mutate of cases){const d=fixture(1);mutate(d);assert.throws(()=>build(d),/データ不整合/);}
});
test('新しい出力IDでも業務内容は同一・元データ不変',()=>{
  const d=fixture(1),before=JSON.stringify(d),a=build(d),b=csv.build(bounded(d),month,'22345678-1234-4123-8123-123456789abc');
  assert.notEqual(a.daily[0].export_id,b.daily[0].export_id);assert.equal(a.daily[0].report_id,b.daily[0].report_id);assert.equal(JSON.stringify(d),before);
});
const sql=await read('supabase/add_driving_report_csv_export.sql');
test('SQLは独立した管理者認可付き読取RPC・既存RLS/書込変更なし',()=>{
assert.match(sql,/auth\.uid\(\) is null or not coalesce\(public\.is_application_admin\(\),false\)/);
assert.match(sql,/stable security definer.*set row_security = off/);assert.match(sql,/revoke all on function[\s\S]*from public,anon,authenticated,service_role/);
assert(!/\b(insert into|update public\.|delete from|alter table|create policy)\b/i.test(sql));
assert(!/public\.driving_(month_lock|closing_month)\(/.test(sql));
});

// Check ZIP by its local/central directories and CRC32 independently.
const zip=new Uint8Array(await csv.zip(build(fixture(1)).files).arrayBuffer());
const view=new DataView(zip.buffer);let offset=0;const zipNames=[];
while(view.getUint32(offset,true)===0x04034b50){
  assert.equal(view.getUint16(offset+6,true),0x800);assert.equal(view.getUint16(offset+8,true),0);
  const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),start=offset+30+length;
  zipNames.push(new TextDecoder().decode(zip.slice(offset+30,start)));
  const bytes=zip.slice(start,start+size);assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
  let checksum=0; // Independent table-based CRC implementation.
  const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  checksum=0xffffffff;for(const b of bytes)checksum=table[(checksum^b)&255]^(checksum>>>8);
  assert.equal((checksum^0xffffffff)>>>0,view.getUint32(offset+14,true));offset=start+size;
}
assert.equal(zipNames.length,3);assert(zipNames[2].startsWith('前回給油_'));assert.equal(view.getUint32(offset,true),0x02014b50);
assert.equal(view.getUint32(zip.length-22,true),0x06054b50);assert.equal(view.getUint16(zip.length-14,true),3);
checks++;console.log('PASS ZIP展開構造・日本語ファイル名・BOM・CRC32');
console.log(`CSV tests: ${checks} groups passed (no DB / network access).`);
