(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const message=(value,error=false)=>{$('draftMessage').textContent=value;$('draftMessage').classList.toggle('is-error',error);};
  // Public / LAN hosts are rejected BEFORE auth scripts or API calls are loaded.
  // This UI guard is not DB authorization: the dedicated RPC checks real Auth.
  if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!['http:','https:'].includes(location.protocol)
    ||new URLSearchParams(location.search).get('enableDraftCsv')!=='1'){
    message('開発専用です。localhostでenableDraftCsv=1を指定した場合のみ利用できます。',true);return;
  }
  const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('検証に必要なスクリプトを読み込めません。'));document.head.append(script);});
  (async()=>{
    try{
      await load('../portal-auth.js');
      $('draftLogin').hidden=false;
      if(!getPortalAuthSession()||!isPortalAccessTokenValid(getPortalAuthSession()))throw Error('同じ開発サーバーで全体管理者としてログインし直してから、このURLを開いてください。');
      await load('../driving-report-period.js');
      await load('../driving-report-csv.js?v=1');
      const api=new URL(PORTAL_SUPABASE_URL);
      const company=api.href==='https://fgmvmbjnoyagnpygcbky.supabase.co/';
      const local=['localhost','127.0.0.1','[::1]'].includes(api.hostname);
      if((!company&&!local)||!['http:','https:'].includes(api.protocol)||api.username||api.password)throw Error('検証対象外の接続先です。');
      async function request(name){
        const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        const text=await response.text();
        if(!response.ok){
          let data={};try{data=JSON.parse(text);}catch{ /* never expose raw server responses */ }
          if(data.code==='PGRST202'||response.status===404)throw Error('下書き検証用RPCは未適用です。本番へのSQL適用は別途の承認が必要です。');
          if(data.message==='expected_five_saved_drafts')throw Error('指定5日すべてが保存済みの下書きではありません。件数や提出状態を確認してください。');
          if(data.message==='test_month_already_submitted')throw Error('この月は月別提出済みです。下書き検証では出力できません。');
          if(response.status===401||response.status===403||data.code==='42501')throw Error('管理者認証・読取権限を確認できないため、出力を停止しました。');
          throw Error('検証データの取得に失敗しました。');
        }
        return name==='is_application_admin'?JSON.parse(text):DrivingReportCsv.parseSource(text);
      }
      if(await request('is_application_admin')!==true)throw Error('全体管理者のみ利用できます。');
      $('draftControls').hidden=false;$('downloadDraft').disabled=false;
      message('TEST DRAFT専用です。管理者として社員39の下書き5件だけを読み取ります。');
      $('downloadDraft').onclick=async()=>{
        $('downloadDraft').disabled=true;$('draftWarnings').replaceChildren();
        try{
          message('下書きを読み取り中…');
          const source=await request('admin_driving_report_draft_test_source'),exportId=crypto.randomUUID();
          const result=DrivingReportCsv.buildDraftTest(source,exportId);
          for(const warning of result.warnings){const item=document.createElement('li');item.textContent=warning;$('draftWarnings').append(item);}
          const blob=DrivingReportCsv.zip(result.files),url=URL.createObjectURL(blob),link=document.createElement('a');
          link.href=url;link.download=`TEST_DRAFT_社員39_2026-09_${exportId}.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
          message(`TEST DRAFT：保存済み日報${result.daily.length}行、給油${result.fuel.length}件。検証用ZIPのダウンロードを開始しました。`);
        }catch(error){message(error.message,true);}finally{$('downloadDraft').disabled=false;}
      };
    }catch(error){$('draftControls').hidden=true;message(error.message,true);}
  })();
})();
