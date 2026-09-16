// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/site-master-ui.test.mjs
// Local HTML + mocked API only; no production access.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req,res) => {
  const file = new URL(req.url,'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(file)) { res.writeHead(404); res.end(); return; }
  try {
    const body=await readFile(join(root,file));
    res.setHeader('Content-Type', file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
try {
  const page = await browser.newPage({viewport:{width:1100,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const clients=[{id:1,name:'元請A',code:'A',visible:true,display_order:1},{id:2,name:'元請B',code:'B',visible:false,display_order:2}];
  const sites=[{id:10,client_id:1,master_client_name:'元請A',display_name:'現場A',input_code:'A001',construction_no:'K001',official_name:'正式A',site_type:'一般',visible:true},
    {id:20,client_id:1,master_client_name:'元請A',display_name:'現場B',input_code:'A002',construction_no:'K002',official_name:'正式B',site_type:'一般',visible:false},
    {id:30,client_id:2,master_client_name:'元請B',display_name:'現場C',input_code:'B001',construction_no:'K003',official_name:'正式C',site_type:'一般',visible:true}];
  const calls=[];
  await page.route('**/portal-auth.js',route=>route.fulfill({contentType:'text/javascript',body:
    'const PORTAL_SUPABASE_URL="https://mock.invalid"; window.portalFetch=(url,opts)=>fetch(url,opts);'}));
  let denied=false, rpcError=null;
  await page.route('https://mock.invalid/**',async route=>{
    const request=route.request(),url=new URL(request.url()),body=request.postDataJSON();
    if(request.method()==='POST')calls.push({path:url.pathname,body});
    let result=url.pathname.endsWith('is_site_master_admin')?!denied:
      url.pathname.endsWith('clients')?clients:url.pathname.endsWith('site_master_order')?sites:{};
    if(rpcError && !url.pathname.endsWith('is_site_master_admin') && request.method()==='POST') {
      await route.fulfill({status:400,json:{message:rpcError}}); return;
    }
    await route.fulfill({json:result});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/site-admin.html`);
  await page.waitForFunction(()=>!document.getElementById('newSiteButton').disabled);
  assert.equal(await page.locator('.master-group-title').count(),2);
  await page.locator('#newSiteButton').click();
  assert.deepEqual(await page.locator('#siteClientId option').allTextContents(),['選択してください','元請A']);
  await page.locator('#saveSiteButton').click();
  assert.equal(await page.locator('#siteFormMessage').textContent(),'表示名を入力してください');
  assert.equal(await page.locator('#siteDisplayName').getAttribute('aria-invalid'),'true');
  await page.locator('#siteDisplayName').fill('新現場'); await page.locator('#saveSiteButton').click();
  assert.equal(await page.locator('#siteFormMessage').textContent(),'元請を選択してください');
  await page.locator('#siteClientId').selectOption('1'); await page.locator('#saveSiteButton').click();
  assert.equal(await page.locator('#siteFormMessage').textContent(),'工事番号を入力してください');
  await page.locator('#siteConstructionNo').fill('NEW'); await page.locator('#siteOfficialName').fill('新正式');
  await page.locator('#saveSiteButton').click();
  await page.waitForFunction(()=>document.getElementById('siteEditSection').hidden);
  const save=calls.find(x=>x.path.endsWith('save_site_master')).body;
  assert.equal(save.p_id,null); assert.equal(save.p_client_id,'1');
  assert.ok(!('input_code' in save)); assert.ok(!('display_order' in save)); assert.ok(!('client_code' in save));
  await page.locator('[data-edit="30"]').click();
  assert.equal(await page.locator('#siteClientId').inputValue(),'2');
  assert.match(await page.locator('#siteClientId option:checked').textContent(),/非表示/);
  await page.locator('#cancelSiteEditButton').click();
  await page.locator('#siteSearchInput').fill('現場A');
  assert.equal(await page.locator('.master-order-button:not(:disabled)').count(),0);
  await page.locator('#siteSearchInput').fill('');
  rpcError='一覧が更新されています。再読み込みしてから並び替えてください';
  await page.locator('[data-id="10"][data-direction="1"]').click();
  await page.waitForFunction(()=>document.getElementById('siteMessage').textContent.includes('一覧が更新'));
  assert.deepEqual(calls.find(x=>x.path.endsWith('move_master_item')).body.p_expected_ids,[10,20]);
  rpcError=null;
  await page.locator('#newSiteButton').click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(tmpdir(),'site-master-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.goto(`${base}/client-admin.html`);
  await page.waitForFunction(()=>!document.getElementById('newClientButton').disabled);
  await page.locator('#newClientButton').click(); await page.locator('#saveClientButton').click();
  assert.equal(await page.locator('#clientFormMessage').textContent(),'元請名を入力してください');
  await page.locator('#clientName').fill('追加会社'); await page.locator('#clientCode').fill('NEW');
  await page.locator('#saveClientButton').click();
  await page.waitForFunction(()=>document.getElementById('clientEditSection').hidden);
  assert.equal(calls.find(x=>x.path.endsWith('save_client_master')).body.p_name,'追加会社');
  await page.screenshot({path:join(tmpdir(),'client-master-mobile.png'),fullPage:true});
  denied=true; await page.reload();
  await page.waitForFunction(()=>document.getElementById('clientMessage').textContent.includes('権限'));
  assert.equal(await page.locator('#newClientButton').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS master UI: validation, hidden clients, payload, filtered/stale reorder, mobile layout, permissions');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
