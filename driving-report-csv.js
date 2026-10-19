// CSV generation only: no network or data mutations. Shared by the admin UI and tests.
(() => {
  'use strict';
  const codes = ['brake_horn','lights','mirror_visibility','tires','exterior_interior','driving_posture_seatbelt','mobile_phone','oil_leak','sleep_fatigue','physical_condition','alcohol_condition','medication','worries'];
  const types = ['commute_before','return_before','before','after'];
  const fields = text => text.split(' ');
  const dailyHeaders = fields('schema_version export_kind export_id exported_at closing_month period_start period_end month_submission_id month_submitted_at month_rule_version employee_id employee_name department employee_identity_source report_date calendar_day_type report_required requirement_reason day_state attendance_id attendance_status attendance_site_type leave_type leave_application_id source_application_id holiday_work_record_ids report_id report_status driving_status vehicle_id vehicle_number vehicle_name outbound_route_type return_route_type route_note site_id site_name destination_text start_odometer end_odometer distance_km accident_or_violation accident_violation_note report_note report_submitted_at report_updated_at late_entry late_entry_days refuel_count refuel_total_liters alcohol_check_version');
  for (const code of codes) for (const suffix of ['result','note','checked_at']) dailyHeaders.push(`inspection_${code}_${suffix}`);
  for (const type of types) for (const suffix of fields('check_id input_state checked_at value is_zero phone_confirmed confirmation_method confirmed_by_employee_id confirmed_by_name excel_confirmer_code note record_type')) dailyHeaders.push(`alcohol_${type}_${suffix}`);
  const refuelHeaders = fields('schema_version export_kind export_id exported_at closing_month period_start period_end month_submission_id month_submitted_at employee_id employee_name department report_date report_id vehicle_id vehicle_number vehicle_name refuel_id refuel_sequence refueled_date refueled_at liters odometer_km fuel_station payment_method refuel_note');
  const previousHeaders = fields('schema_version export_kind export_id exported_at closing_month period_start vehicle_id previous_refuel_status previous_refuel_id previous_report_id previous_month_submission_id previous_refueled_date previous_refueled_at previous_liters previous_odometer_km same_timestamp_candidate_count has_newer_unconfirmed_history');
  const fail = detail => { throw Error(`データ不整合のため出力できません：${detail}`); };
  const present = value => value !== null && value !== undefined && value !== '';
  function id(value) {
    if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !/^[1-9]\d*$/.test(String(value))) fail('ID形式');
    return String(value);
  }
  const optionalId = value => present(value) ? id(value) : '';
  const compareId = (a,b) => BigInt(id(a)) < BigInt(id(b)) ? -1 : BigInt(id(a)) > BigInt(id(b)) ? 1 : 0;
  // Protect bigint and numeric precision BEFORE JSON.parse, including snapshot IDs.
  // Whole quoted string tokens are left intact; only unquoted JSON number tokens change.
  function parseSource(text) {
    if (text.length > 67108864) throw Error('出力データが大きすぎます。');
    return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      token => token[0] === '"' ? token : JSON.stringify(token)));
  }
  function decimal(value, scale, required=false) {
    if (!present(value)) { if (required) fail('必須数値がありません'); return ''; }
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
    if (!match || (match[2] || '').length > scale) fail(`数値形式 ${value}`);
    return match[1] + (scale ? '.' + (match[2] || '').padEnd(scale,'0') : '');
  }
  const scaled = (value, scale) => BigInt(decimal(value,scale,true).replace('.',''));
  function fromScaled(value, scale) {
    const s=value.toString().padStart(scale+1,'0'); return s.slice(0,-scale)+'.'+s.slice(-scale);
  }
  function jst(value, required=false) {
    if (!present(value)) { if (required) fail('必須日時がありません'); return ''; }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('日時形式');
    // PostgreSQL microseconds must not be silently rounded to milliseconds.
    const precise=/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (precise && precise[1].length>3) {
      return new Date(Date.parse(value)+9*3600000).toISOString().slice(0,19)+'.'+precise[1]+'+09:00';
    }
    return new Date(Date.parse(value)+9*3600000).toISOString().replace('Z','+09:00');
  }
  const dateOf = value => jst(value,true).slice(0,10);
  function instant(value) {
    jst(value,true);
    const fraction=/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1]||'';
    if (fraction.length>6) fail('日時の精度');
    return BigInt(Date.parse(value))*1000n+BigInt(fraction.slice(3).padEnd(3,'0'));
  }
  const compareTime=(a,b)=>instant(a)<instant(b)?-1:instant(a)>instant(b)?1:0;
  function list(source,key) { if (!Array.isArray(source[key])) fail(`${key}がありません`); return source[key]; }
  function index(rows,key='id') {
    const map=new Map(); for (const row of rows) { const k=id(row[key]); if (map.has(k)) fail(`${key}重複 ${k}`); map.set(k,row); } return map;
  }
  function children(rows,reports,uniqueKey) {
    const map=new Map(),seen=new Set();
    for (const row of rows) {
      const parent=id(row.driving_report_id); if (!reports.has(parent)) fail('明細の親がありません');
      const k=uniqueKey(row); if (seen.has(k)) fail('明細重複'); seen.add(k);
      if (!map.has(parent)) map.set(parent,[]); map.get(parent).push(row);
    } return map;
  }
  function bool(value,required=false) { if (value==null && !required) return ''; if (typeof value !== 'boolean') fail('真偽値形式'); return value; }
  function csv(headers,rows) {
    const escape=value=>'"'+String(value ?? '').replaceAll('"','""')+'"';
    return '\ufeff'+[headers,...rows.map(row=>headers.map(key=>row[key] ?? ''))].map(row=>row.map(escape).join(',')).join('\r\n')+'\r\n';
  }
  const draftDates=Object.freeze(['2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-27']);
  function build(source,month,exportId) { return buildRows(source,month,exportId,false); }
  function buildDraftTest(source,exportId) { return buildRows(source,'2026-09',exportId,true); }
  // Shared formatting / row projection; only the narrow draft entry point can
  // select test mode. build() never accepts a flag to loosen official checks.
  function buildRows(source,month,exportId,draftTest) {
    const span=DrivingReportPeriod.range(month);
    if (draftTest) {
      if(source.source_version!=='draft_test_1'||source.visibility_guarantee!=='unfiltered_admin_v1'||source.test_scope!=='employee39_202609_five_days'||source.export_kind!=='TEST_DRAFT'
        ||String(source.employee_id)!=='39'||source.month_submission_exists!==false||source.history_verification!=='not_checked')fail('検証専用の取得条件');
    } else if (String(source.source_version)!=='2'||source.visibility_guarantee!=='unfiltered_admin_v1'||source.roster_basis!=='manual_confirmation_required') fail('読取RPCを最新版へ更新し、完全性を確認してください');
    if (source.closing_month!==month+'-01' || source.period_start!==span.start || source.period_end!==span.end) fail('出力対象期間');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(exportId)) fail('出力ID');
    const common={export_kind:draftTest?'TEST_DRAFT':'official',export_id:exportId,exported_at:jst(source.exported_at,true),closing_month:month,period_start:span.start,period_end:span.end};
    if (!draftTest&&dateOf(source.exported_at)<span.endExclusive) fail('まだ締められていない月');
    const employees=index(list(source,'employees')), reports=index(list(source,'reports'));
    if(draftTest){
      if(employees.size!==1||!employees.has('39')||reports.size!==draftDates.length)fail('社員39の保存済み下書き5日分が必要です');
      const savedDates=new Set();
      for(const r of reports.values()){
        if(id(r.employee_id)!=='39'||r.status!=='draft'||!draftDates.includes(r.report_date)||savedDates.has(r.report_date))fail('検証対象以外の日報');
        savedDates.add(r.report_date);
      }
    }
    const months=draftTest?[]:list(source,'submissions').slice().sort((a,b)=>compareId(a.employee_id,b.employee_id));
    index(months); const byEmployee=new Map();
    for (const m of months) { const k=id(m.employee_id); if (byEmployee.has(k)) fail('月別提出重複'); byEmployee.set(k,m); }
    index(list(source,'alcohol')); // IDs must remain unique across reports too.
    const inspections=children(list(source,'inspections'),reports,r=>id(r.driving_report_id)+':'+r.inspection_item_code);
    const alcohol=children(list(source,'alcohol'),reports,r=>id(r.driving_report_id)+':'+r.check_type);
    const refuels=children(list(source,'refuels'),reports,r=>id(r.id));
    const apps=index(draftTest?[]:list(source,'leave_applications'));
    if (!draftTest&&list(source,'pending_receipts').length) fail('処理中の領収書があります');
    const daily=[],fuel=[],warnings=[],usedReports=new Set(),cars=new Set();
    for (const m of draftTest?[{employee_id:'39'}]:months) {
      const employeeId=id(m.employee_id),employee=employees.get(employeeId),snap=m.snapshot;
      if (!employee || typeof employee.name!=='string' || !employee.name.trim()) fail(`社員マスタ ${employeeId}`);
      if (!draftTest&&(m.closing_month!==month+'-01'||m.period_start!==span.start||m.period_end!==span.end||String(m.rule_version)!=='1'||id(m.submitted_by)!==employeeId)) fail(`社員${employeeId} 月別提出`);
      if (!draftTest&&(!snap || snap.valid!==true || !Array.isArray(snap.errors) || snap.errors.length || !Array.isArray(snap.days) || snap.days.length!==span.days.length
          ||snap.closing_month!==m.closing_month||snap.period_start!==span.start||snap.period_end!==span.end)) fail(`社員${employeeId} snapshot`);
      // Draft dates come exclusively from persisted reports, never generate_series
      // or a synthetic month-submission snapshot. Work/leave facts stay unknown.
      const dayFacts=draftTest?[...reports.values()].map(r=>({date:r.report_date,report_id:r.id,required:'',reason:'TEST_DRAFT_NOT_VALIDATED',holiday_work_record_ids:[]})):snap.days;
      const days=new Map(); for (const d of dayFacts) { if (days.has(d.date)) fail(`社員${employeeId} 日付重複`); days.set(d.date,d); }
      const identity={employee_id:employeeId,employee_name:employee.name,department:employee.department??''};
      const submission=draftTest?{month_submission_id:'',month_submitted_at:'',month_rule_version:''}:{month_submission_id:id(m.id),month_submitted_at:jst(m.submitted_at,true),month_rule_version:'1'};
      for (const date of draftTest?draftDates:span.days) {
        const d=days.get(date); if (!d || d.issue!=null || (!draftTest&&typeof d.required!=='boolean')) fail(`社員${employeeId} ${date} 判定`);
        const reportId=optionalId(d.report_id),r=reportId?reports.get(reportId):null;
        if (reportId && !r) fail(`社員${employeeId} ${date} 日報欠損`);
        if (r && (id(r.employee_id)!==employeeId||r.report_date!==date||r.status!==(draftTest?'draft':'submitted')||(!draftTest&&!d.required))) fail(`社員${employeeId} ${date} 日報不整合`);
        if (!r && (d.required||!['company_holiday','approved_full_leave'].includes(d.reason))) fail(`社員${employeeId} ${date} 必要日報なし`);
        if (r && usedReports.has(reportId)) fail('日報の重複割当'); if (r) usedReports.add(reportId);
        const a=d.attendance;
        let leave=a?.leave_type??'';
        if (!r && d.reason==='approved_full_leave' && !leave) {
          const app=apps.get(optionalId(d.leave_application_id));
          leave=app?.application_type==='paid_leave'?'有給':app?.application_type==='comp_leave'?'代休':'';
          if (!leave) fail(`社員${employeeId} ${date} 休暇種別不明`);
        }
        if (!Array.isArray(d.holiday_work_record_ids)) fail('休日出勤の根拠がありません');
        const row={...common,...submission,...identity,schema_version:'driving_daily_v1',employee_identity_source:'current_employee_master',report_date:date,
          calendar_day_type:d.calendar??'',report_required:d.required,requirement_reason:d.reason??'',
          day_state:r?r.driving_status:d.reason==='company_holiday'?'exempt_company_holiday':'exempt_full_leave',
          attendance_id:optionalId(a?.id),attendance_status:a?.status??'',attendance_site_type:a?.site_type??'',leave_type:leave,
          leave_application_id:optionalId(d.leave_application_id),source_application_id:optionalId(a?.source_application_id),
          holiday_work_record_ids:draftTest?'':JSON.stringify(d.holiday_work_record_ids.map(id)),report_id:reportId};
        const items=inspections.get(reportId)||[],checks=alcohol.get(reportId)||[],fills=(refuels.get(reportId)||[]).slice().sort((a,b)=>compareTime(a.refueled_at,b.refueled_at)||compareId(a.id,b.id));
        if (r) {
          if (!['driven','no_driving'].includes(r.driving_status)) fail('運転状態');
          Object.assign(row,{report_status:r.status,driving_status:r.driving_status,vehicle_id:optionalId(r.vehicle_id),vehicle_number:r.vehicle_number_snapshot??'',vehicle_name:r.vehicle_name_snapshot??'',
            outbound_route_type:r.outbound_route_type??'',return_route_type:r.return_route_type??'',route_note:r.route_note??'',site_id:optionalId(r.site_id),site_name:r.site_name_snapshot??'',destination_text:r.destination_text??'',
            start_odometer:decimal(r.start_odometer,1),end_odometer:decimal(r.end_odometer,1),distance_km:decimal(r.distance_km,1),accident_or_violation:bool(r.accident_or_violation,true),
            accident_violation_note:r.accident_violation_note??'',report_note:r.note??'',report_submitted_at:jst(r.submitted_at,!draftTest),report_updated_at:jst(r.updated_at,true),late_entry:bool(r.late_entry),
            late_entry_days:decimal(r.late_entry_days,0),refuel_count:String(fills.length),refuel_total_liters:fromScaled(fills.reduce((sum,f)=>sum+scaled(f.liters,3),0n),3),alcohol_check_version:String(r.alcohol_check_version)});
          if (!['1','2'].includes(row.alcohol_check_version)) fail('検査方式');
          if (r.driving_status==='no_driving') {
            if (items.length||checks.length||fills.length||[r.vehicle_id,r.outbound_route_type,r.return_route_type,r.route_note,r.site_id,r.site_name_snapshot,r.destination_text,r.start_odometer,r.end_odometer,r.accident_violation_note].some(present)||r.accident_or_violation) fail('運転なしに運転明細');
          } else {
            if(!draftTest||present(r.vehicle_id))cars.add(id(r.vehicle_id));
            if (!draftTest&&(!row.vehicle_number || !['office','direct','direct_return','other'].includes(r.outbound_route_type)||!['office','direct','direct_return','other'].includes(r.return_route_type))) fail(`日報${reportId} 車両・経路`);
            if(!draftTest||(present(r.start_odometer)&&present(r.end_odometer))){
              const start=scaled(r.start_odometer,1),end=scaled(r.end_odometer,1);
              if (end<start||scaled(r.distance_km,1)!==end-start) fail('走行メーター');
            }
            if (present(r.site_id)&&present(r.destination_text)) fail('行先重複');
            if (!draftTest&&r.accident_or_violation&&!r.accident_violation_note?.trim()) fail('事故備考欠損');
            if (items.length!==13){if(!draftTest)fail(`日報${reportId} 点検13項目不足`);warnings.push(`${date}：点検は${items.length}/13項目保存済み（下書き）`);}
            if(draftTest&&[r.vehicle_id,r.start_odometer,r.end_odometer,r.outbound_route_type,r.return_route_type].some(v=>!present(v)))warnings.push(`${date}：車両・メーター・経路に未入力があります`);
          }
        }
        for (const item of items) {
          if (!codes.includes(item.inspection_item_code)||!['ok','defect','not_applicable'].includes(item.result)||(item.result==='defect'&&!item.note?.trim())) fail('点検内容');
          const prefix=`inspection_${item.inspection_item_code}_`;
          row[prefix+'result']=item.result;row[prefix+'note']=item.note??'';row[prefix+'checked_at']=jst(item.checked_at,true);
        }
        for (const check of checks) { id(check.id); if (!types.includes(check.check_type)) fail('検査区分'); }
        for (const type of types) {
          const check=checks.find(c=>c.check_type===type),prefix=`alcohol_${type}_`,newType=type==='commute_before'||type==='return_before';
          const required=r?.driving_status==='driven' && (String(r.alcohol_check_version)==='2')===newType;
          const complete=check && present(check.checked_at)&&present(check.alcohol_value)&&present(check.confirmation_method)&&present(check.confirmed_by_name_snapshot)
            &&(!newType||(typeof check.phone_confirmed==='boolean'&&['中尾','安藤'].includes(check.confirmed_by_name_snapshot)&&check.confirmed_by_employee_id==null));
          row[prefix+'input_state']=!r||r.driving_status==='no_driving'?'not_applicable':check?(complete?'complete':'partial'):required?'absent':'not_applicable';
          if (required&&!complete){if(!draftTest)fail(`日報${reportId} ${type}検査不足`);warnings.push(`${date}：${type}の検査は未完了です`);}
          if (check) {
            const value=decimal(check.alcohol_value,3);if (value && scaled(value,3)>999999n) fail('検査値範囲');
            if (check.is_zero!== (value ? scaled(value,3)===0n : null)) fail('検査ゼロ判定');
            Object.assign(row,{[prefix+'check_id']:id(check.id),[prefix+'checked_at']:jst(check.checked_at),[prefix+'value']:value,[prefix+'is_zero']:bool(check.is_zero),
              [prefix+'phone_confirmed']:bool(check.phone_confirmed),[prefix+'confirmation_method']:check.confirmation_method??'',[prefix+'confirmed_by_employee_id']:optionalId(check.confirmed_by_employee_id),
              [prefix+'confirmed_by_name']:check.confirmed_by_name_snapshot??'',[prefix+'excel_confirmer_code']:newType?(check.confirmed_by_name_snapshot==='中尾'?'1':check.confirmed_by_name_snapshot==='安藤'?'2':''):'',
              [prefix+'note']:check.note??'',[prefix+'record_type']:type});
          }
        }
        fills.forEach((f,i)=>{
          if (dateOf(f.refueled_at)!==date||scaled(f.liters,3)<=0n||scaled(f.liters,3)>999999999n) fail(`給油${f.id} 日付・量`);
          fuel.push({...common,...submission,...identity,schema_version:'driving_refuel_v1',report_date:date,report_id:reportId,vehicle_id:id(r.vehicle_id),vehicle_number:r.vehicle_number_snapshot??'',vehicle_name:r.vehicle_name_snapshot??'',
            refuel_id:id(f.id),refuel_sequence:String(i+1),refueled_date:dateOf(f.refueled_at),refueled_at:jst(f.refueled_at,true),liters:decimal(f.liters,3,true),odometer_km:decimal(f.odometer_km,1),fuel_station:f.fuel_station??'',payment_method:f.payment_method??'',refuel_note:f.note??''});
        });
        daily.push(row);
      }
    }
    if (usedReports.size!==reports.size) fail('snapshotに含まれない日報');
    const history=draftTest?[]:list(source,'history'),historyById=index(history),historySummary=index(draftTest?[]:list(source,'history_summary'),'vehicle_id');
    if (!draftTest&&historySummary.size!==cars.size) fail('前回給油の車両別判定不足');
    for (const h of history) {
      if (!cars.has(id(h.vehicle_id))||dateOf(h.refueled_at)>=span.start) fail('前回給油の範囲');
      id(h.driving_report_id);id(h.month_submission_id);if(h.report_status!=='submitted')fail('前回給油候補が未確定');decimal(h.liters,3,true);decimal(h.odometer_km,1);
    }
    const previous=[];
    for (const car of [...cars].sort(compareId)) {
      if(draftTest){
        previous.push({...common,schema_version:'driving_previous_refuel_v1',vehicle_id:car,previous_refuel_status:'unverified'});
        warnings.push(`車両ID ${car}：前回給油は未確認です。計算基準に使用しないでください`);continue;
      }
      const summary=historySummary.get(car);if(!summary)fail('前回給油の判定がありません');
      const selectedId=optionalId(summary.selected_id),earlierId=optionalId(summary.earlier_id);
      const chosen=selectedId?historyById.get(selectedId):null,earlier=earlierId?historyById.get(earlierId):null;
      const sameText=decimal(summary.same_timestamp_candidate_count,0,true),same=Number(sameText);
      const uncertain=bool(summary.has_newer_unconfirmed_history,true);
      if(!Number.isSafeInteger(same)||(chosen?same<1:same!==0)||(selectedId&&!chosen)||(earlierId&&!earlier)
        ||(chosen&&id(chosen.vehicle_id)!==car)||(earlier&&(!chosen||id(earlier.vehicle_id)!==car||compareTime(earlier.refueled_at,chosen.refueled_at)>=0)))fail('前回給油の判定と明細が不一致');
      if(history.filter(h=>id(h.vehicle_id)===car).some(h=>id(h.id)!==selectedId&&id(h.id)!==earlierId))fail('前回給油の取得上限・範囲');
      const firstCurrent=fuel.filter(f=>f.vehicle_id===car).sort((a,b)=>compareTime(a.refueled_at,b.refueled_at)||compareId(a.refuel_id,b.refuel_id))[0];
      const invalid=chosen&&(!present(chosen.odometer_km)||dateOf(chosen.refueled_at)!==chosen.report_date||scaled(chosen.liters,3)<=0n
        ||(earlier&&present(earlier.odometer_km)&&scaled(chosen.odometer_km,1)<scaled(earlier.odometer_km,1))
        ||(firstCurrent&&present(firstCurrent.odometer_km)&&scaled(firstCurrent.odometer_km,1)<scaled(chosen.odometer_km,1)));
      const status=invalid?'needs_review':uncertain?'unconfirmed_history':same>1?'order_unconfirmed':chosen?'available':'no_history';
      if (status!=='available') warnings.push(`車両ID ${car}：${({needs_review:'前回給油の内容を要確認',unconfirmed_history:'未提出の給油履歴あり',order_unconfirmed:'同時刻の複数給油・順序未確認',no_history:'前回給油履歴なし'})[status]}`);
      previous.push({...common,schema_version:'driving_previous_refuel_v1',vehicle_id:car,previous_refuel_status:status,previous_refuel_id:chosen?id(chosen.id):'',previous_report_id:chosen?id(chosen.driving_report_id):'',
        previous_month_submission_id:chosen?optionalId(chosen.month_submission_id):'',previous_refueled_date:chosen?dateOf(chosen.refueled_at):'',previous_refueled_at:chosen?jst(chosen.refueled_at,true):'',
        previous_liters:chosen?decimal(chosen.liters,3,true):'',previous_odometer_km:chosen?decimal(chosen.odometer_km,1):'',same_timestamp_candidate_count:String(same),has_newer_unconfirmed_history:uncertain});
    }
    const suffix=draftTest?`TEST_DRAFT_社員39_${month}_v1_${exportId}.csv`:`正式_${month}_v1_${exportId}.csv`;
    return {daily,fuel,previous,warnings,submittedEmployeeIds:[...byEmployee.keys()],employees:[...employees.values()],
      files:[{name:'運転日報_'+suffix,text:csv(dailyHeaders,daily)},{name:'給油_'+suffix,text:csv(refuelHeaders,fuel)},{name:'前回給油_'+suffix,text:csv(previousHeaders,previous)}]};
  }
  // ZIP store method (no compression/dependency). UTF-8 filename flag + CRC32.
  function zip(files) {
    const encoder=new TextEncoder(),parts=[],central=[];let offset=0,size=0;
    const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
    for (const file of files) {
      const name=encoder.encode(file.name),data=encoder.encode(file.text),sum=crc(data);
      if (name.length>65535||data.length>0xffffffff) throw Error('ZIPサイズ上限');
      const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);
      l.setUint32(14,sum,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
      const header=new Uint8Array(46+name.length),h=new DataView(header.buffer);
      h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(8,0x800,true);h.setUint16(14,33,true);
      h.setUint32(16,sum,true);h.setUint32(20,data.length,true);h.setUint32(24,data.length,true);h.setUint16(28,name.length,true);h.setUint32(42,offset,true);header.set(name,46);
      parts.push(local,data);central.push(header);offset+=local.length+data.length;size+=header.length;
    }
    if (offset+size>0xffffffff||files.length>65535) throw Error('ZIPサイズ上限');
    const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
    return new Blob([...parts,...central,end],{type:'application/zip'});
  }
  window.DrivingReportCsv=Object.freeze({build,buildDraftTest,parseSource,zip,csv,dailyHeaders:Object.freeze(dailyHeaders),refuelHeaders:Object.freeze(refuelHeaders),previousHeaders:Object.freeze(previousHeaders),inspectionCodes:Object.freeze(codes)});
})();
