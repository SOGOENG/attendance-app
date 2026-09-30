// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/admin-comp-usage-edit-ui.test.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const read = file => readFile(new URL(`../${file}`,import.meta.url),'utf8');
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage({viewport:{width:320,height:800}});
  await page.setContent((await read('applications-admin.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
  for(const file of ['style.css','applications.css','work-history.css'])await page.addStyleTag({content:await read(file)});
  await page.addScriptTag({content:await read('admin-comp-usage.js')});
  await page.evaluate(async()=>{
    window.writes=[];window.refreshes=0;window.allow=true;window.fail=false;
    window.historyRows=[{id:4,employee_id:7,usage_date:'2026-09-17',days:1,note:'元の備考',created_by_employee_id:1,created_at:'2026-09-30T07:13:47Z',status:'approved'},
      {id:5,employee_id:7,usage_date:'2026-09-16',days:.5,note:'取消済み',created_by_employee_id:1,created_at:'2026-09-30T07:13:47Z',status:'cancelled'}];
    document.getElementById('workPanel').hidden=false;
    document.querySelectorAll('#workPanel details').forEach(d=>d.open=true);
    document.getElementById('workSummary').innerHTML='<div class="work-history-summary">使用可能2日</div>';
    document.getElementById('compUsageList').innerHTML='<article>通常申請の使用履歴</article>';
    window.controller=window.createAdminCompUsage({allowed:()=>window.allow,
      employeeName:id=>`社員${id}`,escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      rpc:async(name,payload)=>{
        if(name==='admin_comp_leave_usage_history')return window.historyRows;
        if(name==='get_comp_leave_availability')return [{available_days:2}];
        window.writes.push({name,payload});
        if(window.fail)throw Error('残数不足');
        if(name==='delete_admin_comp_leave_usage')window.historyRows[0].status='cancelled';
        else Object.assign(window.historyRows[0],{usage_date:payload.p_usage_date,days:payload.p_days,note:payload.p_note});
      },refreshWork:async()=>{window.refreshes++;await window.controller.refresh(7);}});
    await window.controller.refresh(7);
  });
  const edit=page.getByRole('button',{name:'修正',exact:true});
  assert.equal(await edit.count(),1);
  assert.equal(await page.locator('#compUsageList button').count(),0);
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=320),true);
  await noOverflow();await edit.click();await noOverflow();
  assert.equal(await page.locator('[data-comp-editor] input').count(),2);
  await page.locator('[data-comp-date]').fill('2026-09-18');
  await page.locator('[data-comp-days]').fill('0.5');
  await page.locator('[data-comp-note]').fill('修正備考');
  await page.evaluate(()=>window.fail=true);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByText('処理できませんでした：残数不足',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-comp-days]').inputValue(),'0.5');
  await page.evaluate(()=>window.fail=false);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await edit.waitFor();
  assert.deepEqual(await page.evaluate(()=>window.writes.at(-1)),{name:'update_admin_comp_leave_usage',payload:{p_application_id:4,p_employee_id:7,p_usage_date:'2026-09-18',p_days:.5,p_note:'修正備考'}});
  assert.equal(await page.evaluate(()=>window.refreshes),1);
  await edit.click();await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.equal(await page.locator('[data-comp-editor]').isVisible(),false);
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'削除',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.writes.length),2);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'削除',exact:true}).click();
  await page.waitForFunction(()=>window.refreshes===2);
  assert.equal(await edit.count(),0);await noOverflow();
  await page.evaluate(async()=>{window.historyRows[0].status='approved';window.allow=false;await window.controller.refresh(7);});
  assert.equal(await page.locator('[data-comp-action]').count(),0);
  console.log('PASS: 320px layout, direct-only buttons, edit/cancel/save/error, immutable fields, delete confirmation, refresh, permissions');
} finally { await browser.close(); }
