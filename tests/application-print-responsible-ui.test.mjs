import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const read=f=>readFile(new URL(`../${f}`,import.meta.url),'utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 await mkdir(new URL('../tmp/print-responsible/',import.meta.url),{recursive:true});
 for(const type of ['paid_leave','comp_leave'])for(const mode of ['different','same','legacy','missing-name','missing-id','unconfirmed','escaped']){
  const page=await browser.newPage({viewport:{width:1000,height:1400}});
  await page.route('http://local.test/**',r=>r.fulfill({body:'<!doctype html><html lang="ja"><meta charset="utf-8"><button id="printButton">印刷</button><button id="backButton">戻る</button><p id="printMessage"></p><main id="printSheet" hidden></main></html>',contentType:'text/html'}));
  await page.goto('http://local.test/application-print.html?application_id=1');
  for(const f of ['application-print.css','application-print-approval.css'])await page.addStyleTag({content:await read(f)});
  await page.evaluate(({type,mode})=>{
   window.PORTAL_SUPABASE_URL='http://local.test';window.requests=[];window.printCalls=0;window.print=()=>window.printCalls++;
   window.portalFetch=async url=>{
    const p=String(url).split('/rest/v1/')[1];window.requests.push(p);let data=[],ok=true;
    if(p==='rpc/is_application_admin')data=true;
    else if(p==='rpc/assert_application_printable'){ok=mode!=='unconfirmed';data=ok?null:{message:'final_confirmation_required'};}
    else if(p.startsWith('applications?'))data=[{id:1,employee_id:7,application_type:type,status:'approved',submitted_at:'2026-10-01',approved_at:'2026-10-02',approved_by_employee_id:1,final_approval_required:mode!=='legacy',final_confirmed_at:mode==='legacy'||mode==='unconfirmed'?null:'2026-10-03',final_confirmed_by_employee_id:mode==='legacy'||mode==='missing-id'?null:mode==='same'?1:2}];
    else if(p.startsWith('employees?'))data=[{id:7,name:'申請者'},{id:1,name:'鈴木 和弘'},...(mode==='missing-name'?[]:[{id:2,name:mode==='escaped'?'<b>髙橋 & 誠二</b>':'髙橋 誠二'}])];
    else if(p.startsWith('paid_leave_application_details?'))data=[{start_date:'2026-10-10',end_date:'2026-10-10',days:1,reason:'私用'}];
    else if(p.startsWith('paid_leave_balances?'))data=[{granted_days:20,used_days:1,remaining_days:19}];
    else if(p.startsWith('comp_leave_dates?'))data=[{leave_date:'2026-10-10',days:1}];
    else if(p.startsWith('comp_leave_allocations?'))data=[{holiday_work_record_id:8}];
    else if(p.startsWith('holiday_work_records?'))data=[{id:8,work_date:'2026-09-10'}];
    else if(p.startsWith('comp_leave_application_details?'))data=[{note:'私用'}];
    return {ok,text:async()=>JSON.stringify(data)};
   };
  },{type,mode});
  await page.addScriptTag({content:await read('application-print.js')});
  if(['missing-name','missing-id','unconfirmed'].includes(mode)){
   await page.locator('#printMessage').filter({hasText:mode==='unconfirmed'?'final_confirmation_required':'最終確認者の情報を取得できない'}).waitFor();
   assert.equal(await page.locator('#printSheet').isHidden(),true);
   await page.locator('#printButton').click();assert.equal(await page.evaluate(()=>printCalls),0);
  }else{
   await page.locator('#printSheet').waitFor({state:'visible'});
   assert.equal(await page.locator('.print-copy').count(),2);
   const expected=mode==='different'?'髙橋 誠二':mode==='escaped'?'<b>髙橋 & 誠二</b>':'鈴木 和弘';
   assert.deepEqual(await page.locator('.responsible-name').allTextContents(),[expected,expected]);
   for(const cell of await page.locator('.approval-row > div:first-child').all())assert.match(await cell.innerText(),/承認者.*鈴木 和弘/s);
   assert.equal(await page.locator('.responsible-name b').count(),0);
   assert.equal(await page.locator('.seal-space').count(),2);
   if(mode==='different'){
    assert.ok((await page.evaluate(()=>requests.find(p=>p.startsWith('employees?')))).includes('in.(7,1,2)'));
    await page.emulateMedia({media:'print'});
    await page.screenshot({path:fileURLToPath(new URL(`../tmp/print-responsible/${type}.png`,import.meta.url)),fullPage:true});
   }
   await page.locator('#printButton').click();assert.equal(await page.evaluate(()=>printCalls),1);
  }
  await page.close();
 }
 console.log('PASS: paid/comp forms, actual final confirmer, same confirmer, legacy fallback, missing data refusal, unconfirmed refusal, escaping, two copies and seal layout');
}finally{await browser.close();}
