"""Local headless Chrome, mocked RPC only. No SQL or production network.
Run: python tests/driving-report-csv-ui.test.py
"""
import base64
import calendar
import datetime as dt
import html
import io
import json
import pathlib
import re
import subprocess
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = pathlib.Path(__file__).resolve().parents[1]
CHROME = pathlib.Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')

def fixture(month):
    year, m = map(int, month.split('-'))
    prev_year, prev_month = (year - 1, 12) if m == 1 else (year, m - 1)
    start, end = dt.date(prev_year, prev_month, 21), dt.date(year, m, 20)
    days = []
    date = start
    while date <= end:
        days.append(dict(date=str(date), calendar='休日', required=False, reason='company_holiday', report_id=None,
                         issue=None, attendance=None, leave_application_id=None, holiday_work_record_ids=[]))
        date += dt.timedelta(days=1)
    return dict(source_version=2, visibility_guarantee='unfiltered_admin_v1', roster_basis='manual_confirmation_required',closing_month=month+'-01', period_start=str(start), period_end=str(end),
                exported_at='2030-01-01T00:00:00Z', employees=[dict(id=1, name='提出済社員', department='工事部', active=True),
                dict(id=2, name='未提出社員', department='工事部', active=True)], submissions=[dict(id=1, employee_id=1,
                submitted_by=1, closing_month=month+'-01', period_start=str(start), period_end=str(end), rule_version=1,
                submitted_at='2030-01-01T00:00:00Z', snapshot=dict(valid=True, errors=[], days=days,
                closing_month=month+'-01', period_start=str(start), period_end=str(end)))], reports=[], inspections=[],
                alcohol=[], refuels=[], history=[], history_summary=[],leave_applications=[], pending_receipts=[])

MOCK = r"""
window.calls=[];window.downloads=[];window.objects=new Map();window.confirm=()=>{window.confirmed=true;return true;};
const scenario=new URLSearchParams(location.search).get('case');
const PORTAL_SUPABASE_URL=location.origin;
URL.createObjectURL=blob=>{const url='blob:test-'+objects.size;objects.set(url,blob);return url;};
URL.revokeObjectURL=()=>{};
HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:objects.get(this.href)});};
window.portalFetch=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('is_application_admin'))return new Response(JSON.stringify(scenario!=='denied'),{status:200});
  if(scenario==='rpc-denied')return new Response(JSON.stringify({code:'42501'}),{status:403});
  if(scenario==='rls-denied')return new Response(JSON.stringify({code:'42501',message:'query would be affected by row-level security policy for table employees'}),{status:403});
  if(scenario==='rpc-missing')return new Response(JSON.stringify({code:'PGRST202'}),{status:404});
  const month=JSON.parse(options.body).p_closing_month.slice(0,7);
  const response=await fetch('/fixture?month='+month);
  const data=await response.json();
  if(scenario==='invalid')data.submissions[0].snapshot.days.pop();
  if(scenario==='old-source')data.source_version=1;
  if(scenario==='empty')data.submissions=[];
  if(scenario==='race'&&calls.filter(c=>c.url.endsWith('admin_driving_report_csv_source')).length>1){
    const second=structuredClone(data.submissions[0]);second.id=2;second.employee_id=2;second.submitted_by=2;data.submissions.push(second);
  }
  return new Response(JSON.stringify(data),{status:200});
};
"""
DRIVER = r"""
const $=id=>document.getElementById(id),wait=()=>new Promise(r=>setTimeout(r,30));
const check=(value,message)=>{if(!value)throw Error(message);};
async function run(){
  try{
    for(let i=0;i<100&&$('csvMessage').textContent.includes('確認中');i++)await wait();
    const scenario=new URLSearchParams(location.search).get('case');
    if(['denied','rpc-denied','rpc-missing','invalid','rls-denied','old-source'].includes(scenario)){
      check($('downloadCsvZip').disabled,'failed open');check($('csvContent').hidden,'data visible');
      if(scenario==='denied')check(calls.length===1,'source called without admin');
      if(scenario==='rpc-missing')check($('csvMessage').textContent.includes('未適用'),'missing RPC message');
      if(scenario==='rls-denied')check($('csvMessage').textContent.includes('完全性'),'RLS hidden as zero');
      check(downloads.length===0,'download on error');
    }else{
      check(!$('csvContent').hidden,'source not loaded');
      check(!document.querySelector('#csvRoster input'),'employee selection remains');
      check(!$('selectAll')&&!$('clearSelection'),'bulk selection remains');
      check($('csvSummary').textContent.includes(scenario==='empty'?'月別提出済み 0人':'月別提出済み 1人'),'export count');
      $('confirmRoster').checked=true;$('confirmRoster').dispatchEvent(new Event('change'));
      if(scenario==='empty'){check($('downloadCsvZip').disabled,'empty export enabled');}
      else{
        check(!$('downloadCsvZip').disabled,'export disabled');$('downloadCsvZip').click();
        for(let i=0;i<100&&(downloads.length===0)&&!$('csvMessage').textContent.includes('提出者が変わりました');i++)await wait();
        if(scenario==='race'){
          check(downloads.length===0,'stale roster downloaded');check(!$('confirmRoster').checked,'confirmation not reset');
          check($('csvMessage').textContent.includes('提出者が変わりました'),'race message');
        }else{
          check(downloads.length===1,'not one ZIP');check(window.confirmed,'partial output unconfirmed');
          const bytes=new Uint8Array(await downloads[0].blob.arrayBuffer());
          window.zipBase64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
          $('downloadCsvZip').click();for(let i=0;i<100&&downloads.length<2;i++)await wait();
          check(downloads.length===2,'repeat export failed');check(downloads[0].name!==downloads[1].name,'export ID reused');
        }
      }
    }
    check(calls.every(c=>c.options.method==='POST'&&/rpc\/(is_application_admin|admin_driving_report_csv_source)$/.test(c.url)),'unexpected API / mutation');
    $('test-result').textContent=JSON.stringify({ok:true,scenario,zip:window.zipBase64||null});
  }catch(e){$('test-result').textContent=JSON.stringify({ok:false,error:e.message,message:$('csvMessage').textContent});}
}
run();
"""

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/fixture':
            data = json.dumps(fixture(parse_qs(url.query)['month'][0]), ensure_ascii=False)
            content_type = 'application/json; charset=utf-8'
        elif url.path == '/test':
            data = (ROOT/'driving-report-csv-admin.html').read_text(encoding='utf-8')
            # Export-only scenarios; integrated status RPCs are exercised in driving-csv-roster-ui.test.mjs.
            data = re.sub(r'<script src="driving-report-status-admin\.js\?v=\d+"></script>', '', data)
            data = data.replace('<script src="portal-auth.js"></script>', '<script>'+MOCK+'</script>')
            data = data.replace('</body>', '<pre id="test-result">pending</pre><script>'+DRIVER+'</script></body>')
            content_type = 'text/html; charset=utf-8'
        else:
            file = ROOT/url.path.lstrip('/')
            if file.parent != ROOT or not file.is_file():
                self.send_error(404)
                return
            data = file.read_text(encoding='utf-8')
            content_type = 'text/javascript; charset=utf-8' if file.suffix == '.js' else 'text/css; charset=utf-8'
        payload = data.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        for case in ['success', 'denied', 'rpc-denied', 'rpc-missing', 'invalid', 'empty', 'race', 'rls-denied', 'old-source']:
            temp_root = (ROOT/'tmp').resolve()
            temp_root.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='driving-csv-chrome-', dir=temp_root, ignore_cleanup_errors=True) as profile:
                assert pathlib.Path(profile).resolve().is_relative_to(temp_root)
                command = [str(CHROME), '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
                           '--disable-extensions', '--disable-sync', '--no-default-browser-check', '--proxy-server=direct://',
                           '--user-data-dir='+profile, '--virtual-time-budget=8000', '--dump-dom',
                           f'http://127.0.0.1:{server.server_port}/test?case={case}']
                run = subprocess.run(command, capture_output=True, timeout=30)
                output = run.stdout.decode('utf-8', errors='replace')
                found = re.search(r'<pre id="test-result">(.*?)</pre>', output, re.S)
                assert found, f'{case}: no browser test output: {run.stderr.decode(errors="replace")[:400]}'
                result = json.loads(html.unescape(found.group(1)))
                assert result.get('ok'), f'{case}: {result}'
                if result.get('zip'):
                    with zipfile.ZipFile(io.BytesIO(base64.b64decode(result['zip']))) as archive:
                        assert len(archive.namelist()) == 3
                        assert archive.testzip() is None
                        contents = [archive.read(name).decode('utf-8-sig') for name in archive.namelist()]
                        assert all('official' in text for text in contents[:1])
                        assert all(archive.read(name).startswith(b'\xef\xbb\xbf') for name in archive.namelist())
                print('PASS browser '+case)
    finally:
        server.shutdown()
        server.server_close()
    print('UI tests: 9 scenarios passed (local mock only, no SQL).')

if __name__ == '__main__':
    main()
