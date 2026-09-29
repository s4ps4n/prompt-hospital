<div align="center">

# Prompt Hospital

**Your AI models finally have an office.**

An isometric, Theme Hospital–style control panel for an AI team: each model gets a room,
tasks arrive as envelopes, and when you drag one onto a model — the model actually runs.

[**▸ Live demo**](https://prompthospital.site/demo) ·
[**Quick start**](#installation) ·
[**Add your model**](#add-your-model) ·
[Roadmap](ROADMAP.md) ·
[Русский](README.ru.md)

</div>

https://github.com/user-attachments/assets/0c18869a-997c-45b7-9600-4d6642f35a36

<div align="center">

![Node 22+](https://img.shields.io/badge/Node-22+-339933?logo=nodedotjs&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![MIT](https://img.shields.io/badge/license-MIT-green)

</div>


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

## Add your model

A model has two sides: how it looks in the office and what actually runs when it gets a task.

**1. Appearance** — add an entry to `CATALOG` in [`src/journal/catalog.ts`](src/journal/catalog.ts):

```ts
{ model: 'phi', name: 'Phi', provider: 'Microsoft', hair: '#6fb7e8', color: '#3f87b8', skin: '#f2c9a0', style: 'bob', acc: 'glasses' },
```

`style`: `cap | bob | quiff | bun | spiky`; `acc` (optional): `wings | glasses | headset`.
Models not in the catalog still get a stable look — by prefix (`qwen-27b` → Qwen), by provider,
or by a hash of the name — so this step is about a face of its own, not about working at all.

**2. Execution** — in [`orchestrator/dispatch.py`](orchestrator/dispatch.py), inside `tick()`, add a branch:

```python
model = (w.get('model') or '').lower()
if 'codex' in model:
    ok = run_codex(task['id'], task['title'])
elif 'my-model' in model:
    ok = run_my_model(task['title'])
```

Then write `run_my_model` — the call to your executor (CLI/API). The dispatcher records
`complete`/`block` by itself.

A PR titled `Add model: <Name>` with a screenshot of the room is the easiest first contribution.

## Deploy

Docker + nginx (Basic Auth) + Traefik with HTTPS — step by step in [INSTALL.md, Level 2](INSTALL.md#level-2-prod-docker--nginx--domain--https).

## Integration levels (all done)

- **A. Journal** — single source of truth, operation CLI.
- **B. Monitor** — office reads the journal (read-only).
- **C. Write** — drag-and-drop writes to the journal via `POST /op`.
- **D. Execute** — the dispatcher actually runs the model and closes the task.

By default the office runs at level C (writes to the journal); D is enabled by running `dispatch.py`.

## Reference setup

How the author runs it; any orchestrator that speaks HTTP works the same way.


| Model | Role | How it is wired |
|---|---|---|
| Hermes | coordinator | DeepSeek via Hermes Agent |
| Claude Code | executor | locally, `claude -p` |
| Codex | executor | locally, `codex exec -s workspace-write` |
| Nemotron / Qwen / Laguna | reviewer | OpenRouter `:free` |

## Tests and quality

```bash
npm test            # vitest — journal, operations, interaction, remote mode
npm run lint        # oxlint
npm run build       # tsc + vite build
```

## Roadmap

- ✅ Office and rooms — models, tray, journal, idle animations
- ✅ Own orchestrator — journal, API, dispatcher that actually runs models
- 🔜 Stats — who worked how much, per model
- 🔜 The Warden — a hand that slaps idle models back to Hermes for a task

Details in [ROADMAP.md](ROADMAP.md).

## Credits and license

Inspired by *Theme Hospital* (Bullfrog, 1997); no assets, names or code from the original are used.
[MIT](LICENSE) © s4ps4n.

---

Made in Ulan-Ude by [@s4ps4n](https://github.com/s4ps4n) at [ITTEK](https://it-uu.ru) — we build web products, online stores and AI tooling.
