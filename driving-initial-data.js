(() => {
  'use strict';
  const $=id=>document.getElementById(id),period=DrivingReportPeriod;
  const params=new URLSearchParams(location.search);
  let date, revision=null, busy=false, dirty=false, canEdit=false, requestId=0;
  const message=(text,error=false)=>{$('initialMessage').textContent=text;$('initialMessage').classList.toggle('is-error',error);};
  async function request(path,body){
    const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok){
      let error={};try{error=await response.json();}catch{}
      const text=error.message==='initial_revision_conflict'?'別の画面で更新されています。再読み込みして確認してください。':
        response.status===404||error.code==='PGRST202'?'初回登録機能のSQLが未適用です。管理者に確認してください。':
        error.code==='42501'?'この車両の初期値を登録・訂正する権限がありません。':'取得・保存できませんでした。入力内容を確認し、再読み込みしてください。';
      throw Error(text);
    }
    return response.json();
  }
  function lock(){ $('initialEditor').disabled=busy; $('saveInitial').disabled=busy||!canEdit; }
  async function load(){
    const token=++requestId;busy=true;canEdit=false;lock();
    try{
      const data=await request('rpc/get_vehicle_initial_data',{p_vehicle_id:$('initialVehicle').value,p_report_date:date});
      if(token!==requestId)return;
      const row=data.initial;revision=row?.revision??null;canEdit=data.can_edit===true;
      const start=period.range(period.closingMonth(date)).start;
      const baseline=new Date(start+'T00:00:00Z');baseline.setUTCDate(baseline.getUTCDate()-1);
      for(const [id,value] of Object.entries({baselineDate:row?.baseline_date??baseline.toISOString().slice(0,10),
        initialMeter:row?.end_odometer,initialFuelDate:row?.refueled_date,initialFuelMeter:row?.refuel_odometer,
        initialLiters:row?.liters,initialStation:row?.fuel_station,initialPayment:row?.payment_method}))$(id).value=value??'';
      $('initialAudit').textContent=row?`登録者ID ${row.created_by}／${row.created_at}　更新者ID ${row.updated_by}／${row.updated_at}`:'';
      dirty=false;message(!canEdit?'別の社員が登録した初期値です。訂正は全体管理者に依頼してください。':row?'登録内容を確認・訂正できます。':'初回データを入力してください。');
      return true;
    }catch(error){message(error.message,true);}finally{busy=false;lock();}
  }
  $('initialVehicle').onchange=()=>{if(dirty&&!window.confirm('未保存の入力を破棄して車両を変更しますか？')){$('initialVehicle').value=$('initialVehicle').dataset.loaded;return;}$('initialVehicle').dataset.loaded=$('initialVehicle').value;void load();};
  $('initialForm').oninput=event=>{if(event.target.id!=='initialVehicle')dirty=true;};
  $('initialForm').onsubmit=async event=>{
    event.preventDefault();if(busy||!canEdit)return;
    try{
      if(!$('initialForm').reportValidity())return;
      const fuelIds=['initialFuelDate','initialFuelMeter','initialLiters'];
      const any=[...fuelIds,'initialStation','initialPayment'].some(id=>$(id).value.trim()!=='');
      if(any&&fuelIds.some(id=>$(id).value===''))throw Error('前回給油日・給油時メーター・給油量をすべて入力してください。');
      if($('baselineDate').value>period.today())throw Error('基準日は今日以前にしてください。');
      if(any&&($('initialFuelDate').value>$('baselineDate').value||Number($('initialFuelMeter').value)>Number($('initialMeter').value)))throw Error('前回給油日は基準日以前、給油時メーターは前月最終メーター以下にしてください。');
      busy=true;lock();
      await request('rpc/save_vehicle_initial_data',{p_vehicle_id:$('initialVehicle').value,p_baseline_date:$('baselineDate').value,
        p_end_odometer:$('initialMeter').value,p_refueled_date:any?$('initialFuelDate').value:null,
        p_refuel_odometer:any?$('initialFuelMeter').value:null,p_liters:any?$('initialLiters').value:null,
        p_fuel_station:$('initialStation').value.trim()||null,p_payment_method:$('initialPayment').value.trim()||null,p_expected_revision:revision});
      dirty=false;if(await load())message('保存しました。日報へ戻り、再読み込みしてください。');
    }catch(error){if(busy)canEdit=false;message(error.message,true);}finally{busy=false;lock();}
  };
  window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
  (async()=>{
    busy=true;lock();
    try{
      if(!localStorage.getItem('portalLoginUser')){redirectToPortalLogin();return;}
      date=period.initialDate(location.search);
      const back=new URLSearchParams({date});if(params.get('mode')==='monthly')back.set('mode','monthly');
      $('initialBack').href='driving-report.html?'+back;
      $('baselineDate').max=period.today();$('initialFuelDate').max=period.today();
      const rows=[];
      for(let offset=0;;offset+=500){const page=await request(`rpc/my_initial_data_vehicles?limit=500&offset=${offset}`,{});rows.push(...page);if(page.length<500)break;}
      for(const row of rows)$('initialVehicle').add(new Option(`${row.vehicle_number} ／ ${row.vehicle_name||''}`,String(row.id)));
      const vehicle=params.get('vehicle');if(vehicle)$('initialVehicle').value=vehicle;
      if(!$('initialVehicle').value)throw Error('対象車両がありません。');
      $('initialVehicle').dataset.loaded=$('initialVehicle').value;
      await load();
    }catch(error){message(error.message,true);}finally{busy=false;lock();}
  })();
})();
