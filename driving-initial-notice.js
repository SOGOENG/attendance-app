(() => {
  'use strict';
  const $=id=>document.getElementById(id);let serial=0;
  window.DrivingInitialNotice={async refresh(vehicle,date){
    const token=++serial;$('initialDataNotice').hidden=true;$('previousFuelHint').textContent='';
    if(!vehicle||!date)return;
    try{
      const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/get_vehicle_initial_data`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_vehicle_id:vehicle,p_report_date:date})});
      if(!response.ok)return; // SQL not yet applied / no entitlement: existing entry remains usable.
      const data=await response.json();if(token!==serial||$('vehicleId').value!==vehicle||$('reportDate').value!==date)return;
      const query=new URLSearchParams({vehicle,date});if(new URLSearchParams(location.search).get('mode')==='monthly')query.set('mode','monthly');
      $('initialDataLink').href='driving-initial-data.html?'+query;
      $('initialDataLink').textContent=data.initial?'初回データの確認・訂正（別画面）':'初回データ登録（別画面）';
      const hasHistory=data.has_meter_history||data.has_history;
      $('initialDataHint').textContent=!hasHistory&&!data.initial?'過去の日報メーターと初期値がありません。初回データを登録してください。':
        hasHistory?'前回メーターは保存済み日報の履歴を優先します。':data.initial.baseline_date>=date?'初期値の基準日以前の日報です。初期値は使用しません。':'初回登録したメーターを基準にできます。';
      const fuel=data.previous_refuel;
      $('previousFuelHint').textContent=fuel?`前回給油（${fuel.source==='initial'?'初期値':'正式日報'}）：${fuel.refueled_date} ／ ${fuel.refuel_odometer??'未入力'} km ／ ${fuel.liters} L`:'前回給油情報は未登録です。';
      $('initialDataNotice').hidden=false;
    }catch{ /* Never block existing draft / submit workflow on an optional reference failure. */ }
  }};
})();
