// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/shared-tool-search-display.test.mjs
// Local HTML and mocked data only; no production access.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const read = name => readFile(new URL('../'+name,import.meta.url),'utf8');
const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
try {
  for (const width of [1280,375,320]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());
    await page.setContent((await read('shared-tools.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
    await page.addStyleTag({content:await read('style.css')});
    await page.addScriptTag({content:await read('shared-tool-state.js')});
    await page.addScriptTag({content:'window.TOOL_GROUPS=[];'+(await read('shared-tools.js')).replace(/initialize\(\);\s*$/,'')});
    await page.evaluate(()=>{
      const base={ownership_type:'shared',active:true,checkout_managed:true,tool_group:'電動工具',status:'in_use'};
      sharedToolRecords=[
        {...base,id:296,tool_name:'バンドソー',management_code:'BS-017',current_site_id:9},
        {...base,id:295,tool_name:'旋盤',management_code:'SB-3IN-008',current_site_id:9},
        {...base,id:300,tool_name:'バンドソー',management_code:'BS-018',current_site_id:null,status:'available'},
        {...base,id:301,tool_name:'別現場工具',management_code:'OTHER',current_site_id:11}
      ];
      siteRecords=[{id:9,display_name:'玉野川'},{id:10,display_name:'N3'},{id:11,display_name:'別現場'}];
      siteRecords.forEach(s=>siteNameMap.set(String(s.id),s.display_name));
      buildSiteSelect(); buildGroupSelects();
    });
    const result=page.locator('#sharedToolResultSection');
    const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.selectOption('#toolSiteSelect','9'); await page.click('#toolSearchBySiteButton');
    assert.equal(await page.locator('#sharedToolResultTitle').textContent(),'現場：玉野川');
    assert.deepEqual(await page.locator('#sharedToolSummary strong').allTextContents(),['2件']);
    assert.equal(await page.locator('#sharedToolList article').count(),2);
    assert.deepEqual(await page.locator('#sharedToolList h3').allTextContents(),['使用中']);
    assert.doesNotMatch(await result.innerText(),/貸出可能|倉庫|別現場/);
    assert.match(await result.innerText(),/使用現場：玉野川/);
    await noOverflow();
    await mkdir(new URL('../tmp/search-display/',import.meta.url),{recursive:true});
    await result.screenshot({path:fileURLToPath(new URL(`../tmp/search-display/site-two-${width}.png`,import.meta.url))});
    await page.selectOption('#toolSiteSelect','10'); await page.click('#toolSearchBySiteButton');
    assert.deepEqual(await page.locator('#sharedToolSummary strong').allTextContents(),['0件']);
    assert.equal(await page.locator('#sharedToolList article').count(),0);
    assert.equal(await page.locator('#sharedToolMessage').textContent(),'この現場で使用中の工具はありません。');
    assert.doesNotMatch(await result.innerText(),/貸出可能|倉庫/); await noOverflow();
    await page.selectOption('#stockGroupSelect','電動工具');
    await page.selectOption('#stockToolNameSelect','バンドソー'); await page.click('#toolSearchStockButton');
    assert.equal(await page.locator('#sharedToolAvailableList article').count(),1);
    assert.equal(await page.locator('#sharedToolInUseList article').count(),0);
    assert.match(await result.innerText(),/BS-018/); await noOverflow();
    await page.fill('#sharedToolSearch','バンドソー'); await page.click('#sharedToolSearchButton');
    assert.deepEqual(await page.locator('#sharedToolSummary strong').allTextContents(),['1件','1件']);
    assert.equal(await page.locator('#sharedToolAvailableList article').count(),1);
    assert.equal(await page.locator('#sharedToolInUseList article').count(),1); await noOverflow();
    await page.selectOption('#toolGroupSelect','電動工具'); await page.selectOption('#toolNameSelect','バンドソー');
    await page.click('#toolSearchByCategoryButton');
    assert.deepEqual(await page.locator('#sharedToolSummary strong').allTextContents(),['1件','1件']);
    assert.equal(await page.locator('#sharedToolList article').count(),2);
    assert.deepEqual(errors,[]);
    console.log(`PASS: ${width}px site 2 / site 0 / stock / keyword / category, no horizontal overflow or script errors`);
    await page.close();
  }
} finally { await browser.close(); }
