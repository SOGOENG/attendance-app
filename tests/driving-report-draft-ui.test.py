"""Chrome against localhost mocks only. No production connection/SQL.
Run: python tests/driving-report-draft-ui.test.py
"""
import base64
import csv
import html
import importlib.util
import io
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import zipfile
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('csv_ui_base', ROOT/'tests/driving-report-csv-ui.test.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def fixture():
    dates = ['2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27']
    return dict(source_version='draft_test_1', visibility_guarantee='unfiltered_admin_v1',
                test_scope='employee39_202609_five_days', export_kind='TEST_DRAFT', employee_id=39,
                closing_month='2026-09-01', period_start='2026-08-21', period_end='2026-09-20',
                exported_at='2026-10-19T00:00:00Z', month_submission_exists=False, history_verification='not_checked',
                employees=[dict(id=39, name='テスト太郎', department='工事部')],
                reports=[dict(id=100+i, employee_id=39, report_date=date, status='draft', driving_status='driven',
                              vehicle_id=1, vehicle_number_snapshot='CAR-1', start_odometer=None, end_odometer=None,
                              distance_km=None, accident_or_violation=False, alcohol_check_version=2,
                              submitted_at=None, updated_at=date+'T17:00:00+09:00') for i, date in enumerate(dates)],
                inspections=[], alcohol=[], refuels=[])

MOCK = r"""
window.authLoaded=true;window.calls=[];window.downloads=[];window.objects=new Map();
const PORTAL_SUPABASE_URL=location.origin;
function getPortalAuthSession(){return new URLSearchParams(location.search).get('case')==='no-session'?null:{mock:true};}
function isPortalAccessTokenValid(){return true;}
URL.createObjectURL=blob=>{const url='blob:test-'+objects.size;objects.set(url,blob);return url;};URL.revokeObjectURL=()=>{};
HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:objects.get(this.href)});};
window.portalFetch=async(url,options)=>{
  calls.push({url,options});const scenario=new URLSearchParams(location.search).get('case');
  if(url.endsWith('is_application_admin'))return new Response(JSON.stringify(scenario!=='denied'),{status:200});
  if(scenario==='rpc-denied')return new Response(JSON.stringify({code:'42501',message:'admin_required'}),{status:403});
  if(scenario==='rpc-missing')return new Response(JSON.stringify({code:'PGRST202'}),{status:404});
  if(scenario==='submitted')return new Response(JSON.stringify({message:'test_month_already_submitted'}),{status:409});
  const data=await (await fetch('/draft-fixture')).json();
  if(scenario==='missing-day')data.reports.pop();
  return new Response(JSON.stringify(data),{status:200});
};
"""
DRIVER = r"""
const $=id=>document.getElementById(id),wait=()=>new Promise(r=>setTimeout(r,30));
const check=(v,m)=>{if(!v)throw Error(m);};
async function run(){try{
 const scenario=new URLSearchParams(location.search).get('case');
 for(let i=0;i<150&&$('draftControls').hidden&&!$('draftMessage').classList.contains('is-error');i++)await wait();
 if(['blocked','denied','no-session'].includes(scenario)){
   check($('draftControls').hidden,'blocked controls visible');check($('downloadDraft').disabled,'blocked button active');
   if(scenario==='blocked')check(!window.authLoaded,'auth loaded without opt-in');
   if(scenario==='no-session')check(calls.length===0,'network with no session');
   if(scenario==='denied')check(calls.length===1,'non-admin requested drafts');
 }else{
   check(!$('draftControls').hidden&&!$('downloadDraft').disabled,'admin control unavailable');$('downloadDraft').click();
   for(let i=0;i<150&&!downloads.length&&!$('draftMessage').classList.contains('is-error');i++)await wait();
   if(scenario==='success'){
     check(downloads.length===1,'ZIP count');check(downloads[0].name.includes('TEST_DRAFT_社員39_2026-09'),'ZIP identification');
     const bytes=new Uint8Array(await downloads[0].blob.arrayBuffer());window.zipBase64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
     check($('draftMessage').textContent.includes('5行、給油0件'),'saved row count');
   }else{check(downloads.length===0,'download on invalid/RPC error');check($('draftMessage').classList.contains('is-error'),'error not shown');}
 }
 check((window.calls||[]).every(c=>/rpc\/(is_application_admin|admin_driving_report_draft_test_source)$/.test(c.url)&&c.options.method==='POST'&&c.options.body==='{}'),'unexpected business RPC');
 $('test-result').textContent=JSON.stringify({ok:true,zip:window.zipBase64||null});
}catch(e){$('test-result').textContent=JSON.stringify({ok:false,error:e.message,message:$('draftMessage').textContent});}}
run();
"""

class Handler(base.Handler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/draft-fixture':
            data, kind = json.dumps(fixture(), ensure_ascii=False), 'application/json; charset=utf-8'
        elif url.path == '/portal-auth.js':
            data, kind = MOCK, 'text/javascript; charset=utf-8'
        elif url.path == '/dev/test':
            data = (ROOT/'dev/driving-report-draft-test.html').read_text(encoding='utf-8')
            data = data.replace('</body>', '<pre id="test-result">pending</pre><script>'+DRIVER+'</script></body>')
            kind = 'text/html; charset=utf-8'
        elif url.path == '/dev/driving-report-draft-dev.js':
            data, kind = (ROOT/'dev/driving-report-draft-dev.js').read_text(encoding='utf-8'), 'text/javascript; charset=utf-8'
        else:
            return super().do_GET()
        payload = data.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cases = ['success', 'blocked', 'denied', 'no-session', 'rpc-denied', 'rpc-missing', 'submitted', 'missing-day']
    try:
        for case in cases:
            temp_root = (ROOT/'tmp').resolve()
            temp_root.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='driving-draft-chrome-', dir=temp_root, ignore_cleanup_errors=True) as profile:
                assert pathlib.Path(profile).resolve().is_relative_to(temp_root)
                opt_in = '' if case == 'blocked' else '&enableDraftCsv=1'
                run = subprocess.run([str(base.CHROME), '--headless=new', '--disable-gpu', '--no-first-run',
                    '--disable-background-networking', '--disable-extensions', '--disable-sync', '--no-default-browser-check',
                    '--proxy-server=direct://', '--user-data-dir='+profile, '--virtual-time-budget=10000', '--dump-dom',
                    f'http://127.0.0.1:{server.server_port}/dev/test?case={case}{opt_in}'], capture_output=True, timeout=30)
                found = re.search(r'<pre id="test-result">(.*?)</pre>', run.stdout.decode('utf-8', errors='replace'), re.S)
                assert found, f'{case}: no browser output'
                result = json.loads(html.unescape(found.group(1)))
                assert result.get('ok'), f'{case}: {result}'
                if result.get('zip'):
                    with zipfile.ZipFile(io.BytesIO(base64.b64decode(result['zip']))) as archive:
                        assert len(archive.namelist()) == 3 and archive.testzip() is None
                        assert all('TEST_DRAFT' in name for name in archive.namelist())
                        tables = [list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig')))) for name in archive.namelist()]
                        assert len(tables[0]) == 5 and len(tables[1]) == 0 and len(tables[2]) == 1
                        assert all(row['export_kind'] == 'TEST_DRAFT' and row['report_status'] == 'draft' and not row['month_submission_id'] for row in tables[0])
                        assert tables[2][0]['previous_refuel_status'] == 'unverified'
                        assert not tables[2][0]['previous_liters'] and not tables[2][0]['previous_odometer_km']
                print('PASS draft browser '+case)
    finally:
        server.shutdown()
        server.server_close()
    print(f'Draft UI: {len(cases)} scenarios passed (localhost mocks only).')

if __name__ == '__main__':
    main()
