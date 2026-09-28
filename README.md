# Prompt Hospital

> English · [Русский](README.ru.md)

![Node 18+](https://img.shields.io/badge/Node-18+-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Traefik](https://img.shields.io/badge/Traefik-3-24A1C1?logo=traefikproxy&logoColor=white)
![Vitest](https://img.shields.io/badge/tests-Vitest-6E9F18?logo=vitest&logoColor=white)

A cartoon office visualization of an AI team, in the spirit of Theme Hospital. A single orchestrator control panel: see who is doing what, drag tasks onto models, add models — and under the hood it writes to a real journal and actually runs the models.

## What it is

An isometric scene where each model of the team sits in its own room. Tasks are envelopes in Hermes's tray (the coordinator). Drag an envelope onto a model → the task lands in the orchestrator journal → the dispatcher actually runs the model with that task.

- **Frontend** — Vite + React + TypeScript + SVG, offline, no external graphics libraries.
- **Journal** — single source of truth (`journal.json`): models, tasks, statuses, history.
- **API** — `server.py`, serves the journal and accepts operations.
- **Dispatcher** — `dispatch.py`, picks up assigned tasks and runs executors.

## Layout

```
prompt-hospital/          # frontend (this repository)
  src/journal/            #   journal: types, ops (pure operations), selectors, store, remote
  src/scene/              #   isometric scene, rooms
  src/characters/         #   chibi characters, statuses
  src/animations/         #   idle animations (walk/coffee/sleep), gait
  src/app/ src/ui/        #   layout, model card, tray, drag-and-drop
  src/theme/              #   palette, CSS animations

orchestrator/             # control-panel backend (in this same repository)
  journal.example.json    #   starter journal — copy to journal.json
  journal.py              #   operation CLI (same ops as the frontend OPS)
  server.py               #   HTTP API: GET /journal, POST /op
  dispatch.py             #   dispatcher: task → actually run the model
  review-backend.py       #   backend review/refactor via a free model
```

## Architecture

```
                     ┌────────────────────────────────────────────┐
                     │  Office (React, example.com)       │
                     │  drag-and-drop, card, catalog, tray        │
                     └───────────────┬────────────────────────────┘
                          GET /journal│          POST /op (operations)
                                     ▼
                     ┌────────────────────────────────────────────┐
                     │  nginx (Basic Auth)                        │
                     │  /journal, /op → orchestrator-api          │
                     └───────────────┬────────────────────────────┘
                                     ▼
                     ┌────────────────────────────────────────────┐
                     │  server.py (API :8090, docker)             │
                     │  GET /journal, POST /op → journal.py       │
                     └───────────────┬────────────────────────────┘
                                     ▼
                     ┌────────────────────────────────────────────┐
                     │  journal.json (source of truth)            │
                     └───────────────┬────────────────────────────┘
                                     │ polls on a loop (--loop)
                                     ▼
                     ┌────────────────────────────────────────────┐
                     │  dispatch.py — actually runs models        │
                     │  codex exec / claude -p                    │
                     └────────────────────────────────────────────┘
```

## Installation

### 1. Frontend

```bash
git clone https://github.com/s4ps4n/prompt-hospital.git
cd prompt-hospital
npm install
npm run dev        # dev server at http://localhost:5173
```

Journal integration is enabled with an env var at build time:

```bash
VITE_JOURNAL_URL=/journal npm run build   # office reads/writes the journal at /journal
npm run preview                          # http://localhost:4173
```

Without `VITE_JOURNAL_URL` the office runs standalone (journal in localStorage, seeded tasks).

### 2. Orchestrator (backend)

```bash
cd orchestrator
cp journal.example.json journal.json
python3 journal.py list          # view the journal
python3 server.py 8090           # run the API (locally)
python3 dispatch.py --once       # one dispatcher pass
```

## Wiring it together

1. **Create the journal** — `cp orchestrator/journal.example.json orchestrator/journal.json`.
2. **Run the API** — `python3 orchestrator/server.py 8090` (serves `/journal`, accepts `/op`).
3. **Build the frontend with `VITE_JOURNAL_URL=/journal`** and serve the static files behind
   nginx, proxying `/journal` and `/op` to the API (see "Deploy").
4. **Run the dispatcher**:

```bash
ORCHESTRATOR_API=https://example.com \
ORCHESTRATOR_AUTH='user:pass' \
python3 orchestrator/dispatch.py --loop 30
```

## Journal operations

`journal.py` (and `POST /op {name, args}`) supports the same operations as the frontend:

| Operation | Arguments | What it does |
|---|---|---|
| `addTask` | title, priority(1-3), kind? | creates a task |
| `assign` | task, worker | assigns to a model (detaches from the previous one) |
| `unassign` | task | returns to the tray |
| `setRole` | worker, role | changes role (idle model only) |
| `setPriority` | task, priority | changes priority |
| `reorder` | task, before | moves before a task |
| `complete` | worker | closes the current task |
| `block` | worker | toggles blocked/run |
| `addWorker` | model, name, provider, role | adds a model |
| `removeWorker` | worker | removes an idle model |

Roles: `coordinator, executor, architect, fullstack, sysadmin, designer, UX/UI, acceptor, reviewer`.

**Bookkeeping rule:** whenever you start a model on a task, immediately `addTask` + `assign` in the journal; when done, `complete`. Otherwise the office shows a lie.

## Adding your own executor model

In `dispatch.py`, inside `tick()`, add a branch for your model:

```python
model = (w.get('model') or '').lower()
if 'codex' in model:
    ok = run_codex(task['id'], task['title'])
elif 'my-model' in model:
    ok = run_my_model(task['title'])
```

Then write `run_my_model` — the call to your executor (CLI/API). The dispatcher records `complete`/`block` by itself.

## Deploy (as it runs in prod)

Frontend and API are docker containers on one network, behind Traefik.

```bash
# 1. Static files in nginx, Basic Auth, proxy to the API
cat > nginx.conf <<'EOF'
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  auth_basic "Prompt Hospital";
  auth_basic_user_file /etc/nginx/.htpasswd;
  location /journal { proxy_pass http://orchestrator-api:8090; }
  location /op      { proxy_pass http://orchestrator-api:8090; }
  location /        { try_files $uri /index.html; }
}
EOF

# 2. API in the docker network
docker run -d --name orchestrator-api --network deploy_default \
  -v /root/orchestrator:/app -w /app --restart unless-stopped \
  python:3.11-alpine python server.py 8090

# 3. Frontend with Traefik labels (HTTPS via certResolver le)
docker run -d --name prompt-hospital --network deploy_default \
  -v /root/prompt-hospital/site:/usr/share/nginx/html:ro \
  -v /root/prompt-hospital/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /root/prompt-hospital/.htpasswd:/etc/nginx/.htpasswd:ro \
  --restart unless-stopped \
  --label traefik.enable=true \
  --label "traefik.http.routers.prompthospital.rule=Host(\`example.com\`)" \
  --label traefik.http.routers.prompthospital.entrypoints=websecure \
  --label traefik.http.routers.prompthospital.tls.certresolver=le \
  --label traefik.http.services.prompthospital.loadbalancer.server.port=80 \
  nginx:alpine
```

DNS: an `A record example.com → <server IP>`. Traefik issues the certificate itself (Let's Encrypt).

## Integration levels (all done)

- **A. Journal** — single source of truth, operation CLI.
- **B. Monitor** — office reads the journal (read-only).
- **C. Write** — drag-and-drop writes to the journal via `POST /op`.
- **D. Execute** — the dispatcher actually runs the model and closes the task.

By default the office runs at level C (writes to the journal); D is enabled by running `dispatch.py`.

## Team

| Model | Role | How it is wired |
|---|---|---|
| Hermes | coordinator | DeepSeek (this assistant) |
| Claude Code | executor | locally, `claude -p` |
| Codex | executor | locally, `codex exec -s workspace-write` |
| Nemotron / Qwen / Laguna | reviewer | OpenRouter `:free` |

## Tests and quality

```bash
npm test            # vitest — journal, operations, interaction, remote mode
npm run lint        # oxlint
npm run build       # tsc + vite build
```

