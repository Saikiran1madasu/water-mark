"""Start the local studio independently of a temporary terminal session."""
from pathlib import Path
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'.runtime';RUNTIME.mkdir(exist_ok=True)
PID=RUNTIME/'local-service.pid'
PORT=os.environ.get('PORT','4173')

def health():
    try:
        with urllib.request.urlopen(f'http://localhost:{PORT}/api/health',timeout=1) as r:return json.load(r)
    except OSError:return None

action=sys.argv[1] if len(sys.argv)>1 else 'start'
current=health()
if action=='status':
    print(json.dumps(current or {'available':False}));sys.exit(0 if current else 1)
if action=='stop':
    if PID.exists() and current and str(current.get('pid'))==PID.read_text().strip():
        os.kill(int(PID.read_text()),signal.SIGTERM);PID.unlink(missing_ok=True)
        print('Local studio stopped.')
    else:print('No background studio owned by this launcher is running.')
    sys.exit(0)
if action!='start':raise SystemExit('Use start, status or stop.')
if current:
    print(f'Local studio already running at http://localhost:{PORT}');sys.exit(0)
with (RUNTIME/'local-service.log').open('ab') as log:
    process=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
PID.write_text(str(process.pid))
for _ in range(100):
    status=health()
    if status:
        print(f'Local studio ready at http://localhost:{PORT}');sys.exit(0)
    if process.poll() is not None:raise SystemExit('The local studio could not start. Check .runtime/local-service.log.')
    time.sleep(.2)
raise SystemExit('Local studio is still starting. Check .runtime/local-service.log.')
