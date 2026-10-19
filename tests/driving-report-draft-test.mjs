// Pure local fixtures; no DB/network. node tests/driving-report-draft-test.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const context=vm.createContext({window:{},Blob,TextEncoder});
vm.runInContext(await read('driving-report-period.js'),context);context.DrivingReportPeriod=context.window.DrivingReportPeriod;
vm.runInContext(await read('driving-report-csv.js'),context);const csv=context.window.DrivingReportCsv;
const dates=['2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-27'];
const uuid='12345678-1234-4123-8123-123456789abc';
export function fixture(){
  const d={source_version:'draft_test_1',visibility_guarantee:'unfiltered_admin_v1',test_scope:'employee39_202609_five_days',export_kind:'TEST_DRAFT',employee_id:'39',
    closing_month:'2026-09-01',period_start:'2026-08-21',period_end:'2026-09-20',exported_at:'2026-10-19T00:00:00.123456Z',month_submission_exists:false,history_verification:'not_checked',
    employees:[{id:'39',name:'テスト太郎',department:'工事部',active:true}],reports:[],inspections:[],alcohol:[],refuels:[]};
  dates.forEach((date,n)=>{
    const id=String(100+n);
    d.reports.push({id,employee_id:'39',report_date:date,status:'draft',driving_status:'driven',vehicle_id:n===3?'2':'1',vehicle_number_snapshot:n===3?'CAR-2':'CAR-1',vehicle_name_snapshot:'保存済車両',
      start_odometer:'1000.0',end_odometer:'1020.0',distance_km:'20.0',outbound_route_type:'office',return_route_type:'office',accident_or_violation:false,
      submitted_at:null,updated_at:date+'T17:00:00+09:00',late_entry:null,late_entry_days:null,alcohol_check_version:'2'});
    csv.inspectionCodes.forEach(code=>d.inspections.push({driving_report_id:id,inspection_item_code:code,result:'ok',note:null,checked_at:date+'T08:00:00+09:00'}));
    ['commute_before','return_before'].forEach((type,k)=>d.alcohol.push({id:String(n*10+k+1),driving_report_id:id,check_type:type,checked_at:date+'T08:00:00+09:00',alcohol_value:'0.000',is_zero:true,
      phone_confirmed:false,confirmation_method:'電話確認×',confirmed_by_name_snapshot:'中尾',confirmed_by_employee_id:null}));
  });return d;
}
const build=d=>csv.buildDraftTest(d,uuid);let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS DRAFT '+name);};
test('保存済み5日だけ・同じ列と形式・月別提出情報なし',()=>{
  const d=fixture(),r=build(d);assert.equal(r.daily.length,5);assert.deepEqual([...r.daily.map(row=>row.report_date)],dates);
  assert.equal(r.files.length,3);assert.equal(r.fuel.length,0);assert.equal(r.submittedEmployeeIds.length,0);
  for(const row of r.daily){assert.equal(row.report_status,'draft');assert.equal(row.export_kind,'TEST_DRAFT');assert.equal(row.month_submission_id,'');assert.equal(row.month_submitted_at,'');assert.equal(row.month_rule_version,'');assert.equal(row.report_required,'');}
  for(const [i,headers] of [csv.dailyHeaders,csv.refuelHeaders,csv.previousHeaders].entries())assert.equal(r.files[i].text.split('\r\n')[0],'\ufeff'+[...headers].map(h=>'"'+h+'"').join(','));
  assert(r.files.every(f=>f.name.includes('TEST_DRAFT')&&!f.name.includes('正式')));
});
test('前回給油を捏造しない・車両別未確認',()=>{
  const r=build(fixture());assert.equal(r.previous.length,2);
  for(const p of r.previous){assert.equal(p.previous_refuel_status,'unverified');assert.equal(p.previous_refuel_id,undefined);assert.equal(p.previous_liters,undefined);assert.equal(p.previous_odometer_km,undefined);}
  assert(r.warnings.some(w=>w.includes('未確認')));
});
test('保存済みの運転なしを休日や架空の車両へ変換しない',()=>{
  const d=fixture();Object.assign(d.reports[2],{driving_status:'no_driving',vehicle_id:null,vehicle_number_snapshot:null,vehicle_name_snapshot:null,
    start_odometer:null,end_odometer:null,distance_km:null,outbound_route_type:null,return_route_type:null});
  d.inspections=d.inspections.filter(i=>i.driving_report_id!=='102');d.alcohol=d.alcohol.filter(a=>a.driving_report_id!=='102');
  const r=build(d);assert.equal(r.daily.length,5);assert.equal(r.daily[2].day_state,'no_driving');assert.equal(r.daily[2].vehicle_id,'');assert.equal(r.daily[2].distance_km,'');
  assert.equal(r.daily[2].calendar_day_type,'');assert.equal(r.daily[2].holiday_work_record_ids,'');assert.equal(r.daily[2].alcohol_commute_before_input_state,'not_applicable');
});
test('未完成の点検・朝帰り検査・メーターを未入力のまま保持',()=>{
  const d=fixture();d.inspections=d.inspections.filter(i=>i.driving_report_id!=='100');d.alcohol=d.alcohol.filter(a=>a.driving_report_id!=='100'||a.check_type==='commute_before');
  Object.assign(d.alcohol[0],{checked_at:null,confirmed_by_name_snapshot:null});
  Object.assign(d.reports[0],{start_odometer:null,end_odometer:null,distance_km:null,return_route_type:null});
  const r=build(d);assert.equal(r.daily[0].start_odometer,'');assert.equal(r.daily[0].distance_km,'');assert.equal(r.daily[0].alcohol_commute_before_input_state,'partial');
  assert.equal(r.daily[0].alcohol_commute_before_value,'0.000');assert.equal(r.daily[0].alcohol_commute_before_phone_confirmed,false);assert.equal(r.daily[0].alcohol_return_before_input_state,'absent');
  assert(r.warnings.length>2);
});
test('給油0件はヘッダーのみ・複数回給油のIDと量を保持',()=>{
  const d=fixture();assert.equal(build(d).files[1].text.split('\r\n').length,2);
  d.refuels=[{id:'9007199254740993',driving_report_id:'100',refueled_at:dates[0]+'T00:00:00+09:00',liters:'12.345',odometer_km:'1005.0'},
    {id:'9007199254740992',driving_report_id:'100',refueled_at:dates[0]+'T00:00:00+09:00',liters:'10.125',odometer_km:'1010.0'}];
  const r=build(d);assert.equal(r.fuel.length,2);assert.equal(r.fuel[0].refuel_id,'9007199254740992');assert.equal(r.daily[0].refuel_total_liters,'22.470');assert.equal(r.fuel[0].export_kind,'TEST_DRAFT');
});
test('正式出力はTEST_DRAFTを拒否・追加引数で緩和できない',()=>{
  const d=fixture();assert.throws(()=>csv.build(d,'2026-09',uuid),/読取RPC/);assert.throws(()=>csv.build(d,'2026-09',uuid,true),/読取RPC/);
  assert.throws(()=>build({...d,export_kind:'official'}),/検証専用/);
});
test('対象外社員・日付・件数・状態・月別提出済みを拒否',()=>{
  const changes=[d=>d.employee_id='40',d=>d.reports[0].employee_id='40',d=>d.employees[0].id='40',d=>d.reports.pop(),d=>d.reports.push({...d.reports[0],id:'999'}),
    d=>d.reports[0].report_date='2026-08-22',d=>d.reports[0].status='submitted',d=>d.month_submission_exists=true,d=>d.closing_month='2026-10-01',d=>d.history_verification='verified'];
  for(const change of changes){const d=fixture();change(d);assert.throws(()=>build(d),/データ不整合/);}
});
test('明細重複・親なし・不正数値は下書きでも停止',()=>{
  const cases=[d=>d.inspections.push(d.inspections[0]),d=>d.alcohol.push(d.alcohol[0]),d=>d.refuels.push({id:'1',driving_report_id:'999'}),d=>d.reports[0].start_odometer='bad'];
  for(const change of cases){const d=fixture();change(d);assert.throws(()=>build(d),/データ不整合/);}
});
test('再出力時に入力オブジェクトを変更しない',()=>{
  const d=fixture(),before=JSON.stringify(d);assert.equal(build(d).files[0].text,build(d).files[0].text);assert.equal(JSON.stringify(d),before);
});
const dev=await read('dev/driving-report-draft-dev.js');
test('公開ホスト・LAN・file・opt-inなしは認証スクリプトも通信も実行しない',()=>{
  for(const location of [{hostname:'example.com',protocol:'https:',search:'?enableDraftCsv=1'},
    {hostname:'192.168.1.2',protocol:'http:',search:'?enableDraftCsv=1'},{hostname:'localhost',protocol:'file:',search:'?enableDraftCsv=1'},
    {hostname:'localhost',protocol:'http:',search:''}]){
    const nodes=new Map(),document={getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{toggle(){}}});return nodes.get(id);},createElement(){throw Error('script load on blocked host');}};
    vm.runInNewContext(dev,{document,location,URLSearchParams});assert(nodes.get('draftMessage').textContent.includes('開発専用'));
  }
});
const sql=await read('supabase/add_driving_report_draft_test_export.sql');
test('独立・引数なし・社員日付固定・Auth管理者認可・書込なし',()=>{
  assert.match(sql,/create function public\.admin_driving_report_draft_test_source\(\)/);assert.match(sql,/auth\.uid\(\) is null or not coalesce\(public\.is_application_admin\(\),false\)/);
  assert.match(sql,/security definer set search_path='' set row_security=off/);assert.match(sql,/employee_id=39/);assert.match(sql,/status='draft'/);
  assert(!/\b(insert into|update public\.|delete from|alter table|create policy|create or replace)\b/i.test(sql));
});
const zipped=new Uint8Array(await csv.zip(build(fixture()).files).arrayBuffer());
assert.equal(new DataView(zipped.buffer).getUint32(0,true),0x04034b50);assert.equal(new DataView(zipped.buffer).getUint16(zipped.length-14,true),3);
console.log(`Draft tests: ${count} groups passed + ZIP (local fixtures only).`);
