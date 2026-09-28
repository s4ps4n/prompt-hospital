#!/usr/bin/env python3
"""Orchestrator API (level B): serves journal.json and accepts operations.

GET  /journal  → journal state (workers, queue, log, seq)
GET  /health   → {"ok": true}
POST /op       → {"name": "...", "args": [...]} — applies an operation via journal.py

CORS is enabled (for development; in prod the office goes same-origin through an nginx proxy).
Run: python3 server.py [port]  (default 8090)
"""
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

J = Path(__file__).resolve().parent / 'journal.json'
JOURNAL_PY = Path(__file__).resolve().parent / 'journal.py'


def read_journal():
    return json.loads(J.read_text(encoding='utf-8'))


def apply_op(payload):
    name = payload.get('name', '')
    args = payload.get('args', [])
    if not isinstance(args, list):
        return 400, {'err': 'args должен быть списком'}
    cmd = [sys.executable, str(JOURNAL_PY), name] + [str(a) for a in args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        return 500, {'err': r.stderr.strip() or r.stdout.strip()}
    try:
        journal = read_journal()
    except Exception as e:
        journal = None
    return 200, {'ok': True, 'out': r.stdout.strip(), 'journal': journal}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ('/journal', '/journal/'):
            try:
                self._json(200, read_journal())
            except Exception as e:
                self._json(500, {'err': str(e)})
        elif self.path in ('/health', '/health/'):
            self._json(200, {'ok': True})
        else:
            self._json(404, {'err': 'not found'})

    def do_POST(self):
        if self.path in ('/op', '/op/'):
            try:
                n = int(self.headers.get('Content-Length', 0))
                if n > 1024 * 1024:
                    self._json(413, {'err': 'payload too large'})
                    return
                payload = json.loads(self.rfile.read(n) or b'{}')
                code, obj = apply_op(payload)
                self._json(code, obj)
            except Exception as e:
                self._json(400, {'err': str(e)})
        else:
            self._json(404, {'err': 'not found'})

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
