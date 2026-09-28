# How to deploy Prompt Hospital — step by step

Three levels, from simplest to full. Start with the first — the office works in a minute, then continue as needed.

---

## Level 0. Just see the office (no server at all)

You only need **Node.js 18+**.

```bash
git clone https://github.com/s4ps4n/prompt-hospital.git
cd prompt-hospital
npm install
npm run dev
```

Open **http://localhost:5173** — you'll see the office with seeded tasks.

What happens: without configuration the office runs **standalone** — tasks and models live in the browser's `localStorage`. No server, journal, or dispatcher needed. This is the "see the interface" level.

---

## Level 1. Full stack locally (office + live journal + actually running models)

Now the office reads and writes to a **real journal**, not the browser. No docker — just two processes.

### Step 1. Orchestrator (journal + API)

The orchestrator is already in the repository — the `orchestrator/` directory next to the frontend. You only need a starter journal:

```bash
cd orchestrator
cp journal.example.json journal.json
```

Run the API:

```bash
python3 server.py 8090
```

Check: open **http://localhost:8090/journal** — you'll see your journal as JSON.

### Step 2. Build the office to point at this journal

Go back to the frontend directory and build with the journal address:

```bash
cd ~/prompt-hospital
VITE_JOURNAL_URL=http://localhost:8090/journal npm run build
npx serve dist          # or any static server
```

Open the address `serve` prints (usually **http://localhost:3000**).

Now the office shows your journal: drag a task onto a model — it is written to `journal.json` and survives a reload.

### Step 3. Dispatcher (models actually work)

```bash
cd orchestrator
ORCHESTRATOR_API=http://localhost:8090 \
python3 dispatch.py --loop 30
```

The dispatcher polls the journal every 30 seconds: if a model with `model: "codex"` has a task, it actually runs `codex exec` and closes the task by result. (For other models, add your own launch in `dispatch.py`.)

---

## Level 2. Prod: docker + nginx + domain + HTTPS

How it runs at `https://example.com`. Requires docker and a configured Traefik (as for any domain).

### 1. API in the docker network

```bash
docker run -d --name orchestrator-api --network deploy_default \
  -v ./orchestrator:/app -w /app --restart unless-stopped \
  python:3.11-alpine python server.py 8090
```

### 2. Frontend — nginx with static files and Basic Auth

`nginx.conf`:

```nginx
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
```

Build the static files with `VITE_JOURNAL_URL=/journal`, create `.htpasswd` (`openssl passwd -apr1`), and run:

```bash
docker run -d --name prompt-hospital --network deploy_default \
  -v ./site:/usr/share/nginx/html:ro \
  -v ./nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  -v ./.htpasswd:/etc/nginx/.htpasswd:ro \
  --restart unless-stopped \
  --label traefik.enable=true \
  --label "traefik.http.routers.prompthospital.rule=Host(\`example.com\`)" \
  --label traefik.http.routers.prompthospital.entrypoints=websecure \
  --label traefik.http.routers.prompthospital.tls.certresolver=le \
  --label traefik.http.services.prompthospital.loadbalancer.server.port=80 \
  nginx:alpine
```

### 3. DNS

At your registrar: `A record example.com → server IP`. Traefik issues the certificate itself (Let's Encrypt).

---

## How to verify everything is wired

1. `GET /journal` returns your journal (models + tasks).
2. Dragged a task onto a model in the office → it appeared in `journal.json`.
3. Reloaded the office → the assignment stayed (written to the journal, not the browser).
4. The dispatcher picked up a task with `model: "codex"` → actually ran Codex → closed the task.

## Where things live

| What | Where |
|---|---|
| Frontend (office) | `prompt-hospital/` |
| Journal (source of truth) | `orchestrator/journal.json` |
| Operation CLI | `orchestrator/journal.py` |
| HTTP API | `orchestrator/server.py` |
| Dispatcher | `orchestrator/dispatch.py` |
