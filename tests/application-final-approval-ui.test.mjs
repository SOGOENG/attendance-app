import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const read=f=>readFile(new URL(`../${f}`,import.meta.url),'utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const width of [320,1280])for(const allowed of [false,true]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const finalMarkup=(await read('applications-final.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
  await page.route('https://local.test/**',route=>route.fulfill({body:finalMarkup,contentType:'text/html'}));
  await page.goto('https://local.test/applications-final.html?panel=waiting');
  for(const f of ['style.css','applications.css','applications-final.css'])await page.addStyleTag({content:await read(f)});
  await page.evaluate(allowed=>{
   window.PORTAL_SUPABASE_URL='https://local.test';window.calls=[];window.allowed=allowed;window.done=false;
   window.portalFetch=async(url,options={})=>{
    const path=String(url).split('/rest/v1/')[1];let result=[];
    if(path==='rpc/is_application_admin')result=true;
    else if(path==='rpc/is_application_final_approver')result=window.allowed;
    else if(path==='rpc/confirm_application_final'){window.calls.push(JSON.parse(options.body));window.done=true;result=null;}
    else if(path.startsWith('applications?'))result=[{id:1,employee_id:1,application_type:'paid_leave',submitted_at:'2026-10-01T00:00:00Z',approved_at:'2026-10-02T00:00:00Z',approved_by_employee_id:1,final_approval_required:true,final_confirmed_at:window.done?'2026-10-03T00:00:00Z':null,final_confirmed_by_employee_id:window.done?1:null,applicant_note:'<script>bad</script>'}];
    else if(path.startsWith('employees?'))result=[{id:1,name:'確認対象の社員名'}];
    else if(path.startsWith('application_types?'))result=[{code:'paid_leave',display_name:'有給休暇'}];
    else if(path.startsWith('paid_leave_application_details?'))result=[{start_date:'2026-10-10',end_date:'2026-10-10',days:1,reason:'長い申請内容'.repeat(30)}];
    return {ok:true,text:async()=>result===null?"":JSON.stringify(result)};
   };
  },allowed);
  await page.addScriptTag({content:await read('applications-final.js')});
  assert.equal(await page.locator('select').count(),0);
  assert.equal(await page.locator('h1').innerText(),'最終確認');
  assert.equal(await page.locator('[data-final-filter=waiting]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-final-filter=done]').click();
  assert.equal(new URL(page.url()).searchParams.get('panel'),'done');
  assert.equal(await page.locator('[data-final-filter=done]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-final-filter=waiting]').click();
  assert.equal(new URL(page.url()).searchParams.get('panel'),'waiting');
  await page.getByText('管理者承認済み',{exact:true}).waitFor();
  assert.equal(await page.locator('#finalWaitingTab').evaluate(e=>e.classList.contains('final-waiting')),true);
  const waitingPalette=await page.locator('#finalWaitingTab').evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color}});
  assert.deepEqual(waitingPalette,await page.locator('#finalList .final-waiting').evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color}}));
  await page.locator('[data-final-filter=done]').click();
  assert.equal(await page.locator('#finalWaitingTab').evaluate(e=>e.classList.contains('final-waiting')),true);
  await page.locator('[data-final-filter=waiting]').click();
  assert.equal(await page.locator('[data-confirm-id]').count(),allowed?1:0);
  assert.equal(await page.locator('#finalList script').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(allowed){page.once('dialog',d=>d.accept());await page.locator('[data-confirm-id]').click();await page.getByText('対象の申請はありません。',{exact:true}).waitFor();await page.locator('[data-final-filter=done]').click();await page.locator('#finalList').getByText('最終確認済み',{exact:true}).waitFor();assert.equal(await page.locator('[data-confirm-id]').count(),0);assert.equal(await page.evaluate(()=>calls.length),1);
   assert.equal(await page.locator('#finalWaitingTab').evaluate(e=>e.classList.contains('final-waiting')),false);
   assert.equal(await page.locator('#finalList .status.approved').count(),2);
   await page.locator('[data-final-filter=waiting]').click();
   assert.equal(await page.locator('#finalWaitingTab').getAttribute('aria-pressed'),'true');
   assert.notDeepEqual(await page.locator('#finalWaitingTab').evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color}}),waitingPalette);
   assert.equal(await page.locator('#finalWaitingTab').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
   await mkdir(new URL('../tmp/final-approval/',import.meta.url),{recursive:true});
   await page.screenshot({path:fileURLToPath(new URL(`../tmp/final-approval/zero-waiting-${width}.png`,import.meta.url)),fullPage:true});
   await page.locator('[data-final-filter=done]').click();
  }
  await mkdir(new URL('../tmp/final-approval/',import.meta.url),{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL(`../tmp/final-approval/${width}-${allowed}.png`,import.meta.url)),fullPage:true});
  await page.close();
 }
 // Existing history keeps printing controls and printed metadata, with final approval gates.
 for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.setContent((await read('applications-admin.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
  for(const f of ['style.css','applications.css','work-history.css','applications-final.css'])await page.addStyleTag({content:await read(f)});
  await page.evaluate(()=>{
   window.$=id=>document.getElementById(id);window.isAdmin=()=>true;window.emp=()=> '社員';window.esc=s=>String(s??'');window.dt=s=>s?String(s).slice(0,10):'-';window.types=[{code:'paid_leave',display_name:'有給休暇'}];
   window.req=async path=>{
    if(path.startsWith('applications?'))return [1,2,3].map(id=>({id,employee_id:1,application_type:'paid_leave',submitted_at:'2026-10-01',approved_at:'2026-10-02',approved_by_employee_id:1,final_approval_required:id!==3,final_confirmed_at:id===2?'2026-10-03':null,printed_at:id===3?'2026-10-03':null,printed_by_employee_id:id===3?1:null}));
    if(path.startsWith('paid_leave_application_details?'))return [1,2,3].map(application_id=>({application_id,start_date:'2026-10-10',end_date:'2026-10-10',days:1}));
    if(path.startsWith('employees?'))return [{id:1,name:'社員'}];return [];
   };
   $('approvedPanel').hidden=false;$('approvedFiscalYear').innerHTML='<option value="2026">2026</option>';$('approvedMonth').innerHTML='<option value="10">10</option>';$('approvedIncludePrinted').checked=true;
   document.querySelectorAll('[data-application-admin-only]').forEach(e=>e.hidden=false);
   window.initializeApprovedFilters=()=>{};
  });
  const script=await read('applications-admin.js');
  const lines=script.split('\n').filter(s=>/^(async function loadApproved\(|async function loadApprovedHistory\(|function fiscalYearFor\()/.test(s));
  await page.addScriptTag({content:lines.join('\n')});await page.evaluate(()=>loadApprovedHistory());
  const metrics=await page.evaluate(()=>{
   const elements=[document.querySelector('.final-navigation'),document.querySelector('[data-admin-panel=pending]'),document.querySelector('[data-admin-panel=approved]')];
   return elements.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,radius:s.borderRadius,font:s.fontSize,margin:s.marginTop,padding:s.padding}});
  });
  assert.deepEqual(metrics[0],metrics[1]);assert.deepEqual(metrics[1],metrics[2]);
  for(const id of [1]){const card=page.locator(`[data-approved-application-id="${id}"]`);assert.equal(await card.locator('button').isDisabled(),true);assert.equal(await card.locator('input').isDisabled(),true);}
  const approved=page.locator('[data-approved-application-id="2"]');assert.equal(await approved.locator('button').isEnabled(),true);assert.equal(await approved.locator('input').isEnabled(),true);
  assert.equal(await approved.locator('.status.approved').count(),2);
  const historyPalette=await page.locator('[data-approved-application-id="1"] .final-waiting').evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color}});
  assert.equal(historyPalette.background,'rgb(255, 241, 242)');
  assert.equal(await approved.locator('.final-status .approved').last().evaluate(e=>getComputedStyle(e).backgroundColor),await approved.locator('.final-status .approved').first().evaluate(e=>getComputedStyle(e).backgroundColor));
  assert.equal(await page.locator('[data-approved-application-id="3"] input').isChecked(),true);
  const legacy=page.locator('[data-approved-application-id="3"]');assert.equal(await legacy.locator("button").isEnabled(),true);assert.equal(await legacy.locator("input").isEnabled(),true);assert.doesNotMatch(await legacy.innerText(),/最終確認待ち|最終確認済み/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:fileURLToPath(new URL(`../tmp/final-approval/history-${width}.png`,import.meta.url)),fullPage:true});
  await page.close();
 }
 // Missing migration surfaces the server error without hiding the navigation.
 for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.setContent((await read('applications-final.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
  for(const f of ['style.css','applications.css','applications-final.css'])await page.addStyleTag({content:await read(f)});
  await page.evaluate(()=>{window.PORTAL_SUPABASE_URL='https://local.test';window.portalFetch=async url=>String(url).endsWith('/is_application_admin')?{ok:true,text:async()=>'true'}:{ok:false,text:async()=>JSON.stringify({message:'Could not find the function public.is_application_final_approver in the schema cache'})};});
  await page.addScriptTag({content:await read('applications-final.js')});
  await page.getByText(/Could not find the function/).waitFor();
  assert.equal(await page.locator('[data-final-filter]').count(),2);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:fileURLToPath(new URL(`../tmp/final-approval/missing-sql-${width}.png`,import.meta.url)),fullPage:true});
  await page.close();
 }
 // The print renderer must fail before exposing any document when the DB rejects it.
 for(const printable of [false,true]){
  const page=await browser.newPage();await page.route('https://local.test/**',r=>r.fulfill({body:'<!doctype html><button id="printButton">Print</button><button id="backButton">Back</button><p id="printMessage"></p><main id="printSheet" hidden></main>',contentType:'text/html'}));
  await page.goto('https://local.test/application-print.html?application_id=1');
  await page.evaluate(printable=>{window.PORTAL_SUPABASE_URL='https://local.test';window.printCalls=0;window.print=()=>window.printCalls++;window.allow=printable;window.portalFetch=async(url)=>{let data=[],ok=true;const p=String(url).split('/rest/v1/')[1];if(p==='rpc/is_application_admin')data=true;else if(p==='rpc/assert_application_printable'){ok=window.allow;data=ok?null:{message:'final_confirmation_required'};}else if(p.startsWith('applications?'))data=[{id:1,employee_id:1,application_type:'paid_leave',status:'approved'}];else if(p.startsWith('employees?'))data=[{id:1,name:'社員'}];else if(p.startsWith('paid_leave_application_details?'))data=[{start_date:'2026-10-01',end_date:'2026-10-01',days:1}];return {ok,text:async()=>JSON.stringify(data)}};},printable);
  await page.addScriptTag({content:await read('application-print.js')});
  if(printable){await page.locator('#printSheet').waitFor({state:'visible'});await page.locator('#printButton').click();await page.waitForFunction(()=>printCalls===1);await page.evaluate(()=>window.allow=false);await page.locator('#printButton').click();await page.locator('#printSheet').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>printCalls),1);}
  else{await page.getByText('final_confirmation_required',{exact:true}).waitFor();assert.equal(await page.locator('#printSheet').isHidden(),true);await page.locator('#printButton').click();assert.equal(await page.evaluate(()=>printCalls),0);}
  await page.close();
 }
 console.log('Final approval UI: admin permissions, confirmation, readonly state, escaping, 320/1280px and print handler DB gates passed');
}finally{await browser.close();}
