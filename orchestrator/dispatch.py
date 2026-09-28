#!/usr/bin/env python3
"""Dispatcher (level D): task in the journal → actually run a model → complete/block.

Reads the journal via the API, finds tasks assigned to models with an available executor,
runs the executor, and writes complete/block back to the journal by result.

Configuration is via environment variables (see below), no secrets in code.

Executors (locally, in sandboxes):
  codex       → codex exec -s workspace-write <task>

Run: python3 dispatch.py [--once | --loop <sec>]
"""
import base64
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = os.getenv('ORCHESTRATOR_API', 'http://localhost:8090')
AUTH = os.getenv('ORCHESTRATOR_AUTH', '')  # user:pass or token:<token>
WORKDIR = os.getenv('ORCHESTRATOR_WORKDIR', '/home/hermes/prompt-hospital')


def api(path, method='GET', payload=None):
    req = urllib.request.Request(API + path, method=method)
    if AUTH:
        if AUTH.startswith('token:'):
            req.add_header('Authorization', 'Bearer ' + AUTH[6:])
        else:
            req.add_header('Authorization', 'Basic ' + base64.b64encode(AUTH.encode()).decode())
    data = None
    if payload is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=120) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, Exception) as e:
        print(f'  ⚠ API {method} {path}: {e}', file=sys.stderr)
        return None


def op(name, args):
    return api('/op', 'POST', {'name': name, 'args': args})


def run_codex(task_id, title):
    print(f'  ▶ Codex берёт {task_id}: {title}')
    r = subprocess.run(
        ['codex', 'exec', '-s', 'workspace-write', title],
        cwd=WORKDIR, capture_output=True, text=True, timeout=1800,
    )
    if r.returncode == 0:
        out = (r.stdout or '').strip()
        print('  ✓ Codex завершил:', out.splitlines()[-1] if out else '(пусто)')
        return True
    print('  ✗ Codex вернул ошибку:', r.stderr.strip()[:200] or r.stdout.strip()[:200])
    return False


def tick():
    j = api('/journal')
    if not j:
        return
    for w in j.get('workers', []):
        if not w['task']:
            continue
        task = next((t for t in j.get('queue', []) if t['id'] == w['task']), None)
        if not task:
            continue
        # Is the task still assigned to this model?
        if task.get('assignedTo') != w['id']:
            continue
        model = (w.get('model') or '').lower()
        if 'codex' in model:
            print(f"[{time.strftime('%H:%M:%S')}] задача {task['id']} → Codex")
            ok = run_codex(task['id'], task['title'])
            # Re-check: the task may have been reassigned while it was running.
            j2 = api('/journal')
            if j2:
                t2 = next((t for t in j2.get('queue', []) if t['id'] == task['id']), None)
                if t2 and t2.get('assignedTo') == w['id']:
                    print('  →', op('complete' if ok else 'block', [w['id']]))
                else:
                    print('  → задача переназначена, результат не записываем')


_running = True


def _stop(signum, frame):
    global _running
    _running = False
    print('\nОстановка диспетчера…')


def main(argv):
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    once = '--once' in argv
    loop = 30
    if '--loop' in argv:
        loop = int(argv[argv.index('--loop') + 1])
    if once:
        tick()
        return
    while _running:
        tick()
        for _ in range(loop):
            if not _running:
                break
            time.sleep(1)


if __name__ == '__main__':
    main(sys.argv[1:])
