# Prompt Hospital

Мультяшный офис-визуализация ИИ-команды в стиле Theme Hospital. Единый пульт оркестратора: смотришь, кто чем занят, перетаскиваешь задачи на модели, добавляешь модели — а под капотом это пишется в реальный журнал и реально запускает модели.

## Что это

Изометрическая сцена, где каждая модель команды сидит в своей комнате. Задачи — конверты в лотке Гермеса (координатор). Перетащил конверт на модель → задача ушла в журнал оркестратора → диспетчер реально запустил модель с этой задачей.

- **Фронтенд** — Vite + React + TypeScript + SVG, офлайн, без внешних графических библиотек.
- **Журнал** — единый источник истины (`journal.json`), хранит модели, задачи, статусы, историю.
- **API** — `server.py`, отдаёт журнал и принимает операции.
- **Диспетчер** — `dispatch.py`, подхватывает назначенные задачи и запускает исполнителей.

## Состав

```
prompt-hospital/          # фронтенд (этот репозиторий)
  src/journal/            #   журнал: types, ops (чистые операции), selectors, store, remote
  src/scene/              #   изометрическая сцена, комнаты
  src/characters/         #   чиби-персонажи, статусы
  src/animations/         #   idle-анимации (гуляет/кофе/сон), походка
  src/app/ src/ui/        #   компоновка, карточка модели, лоток, drag-and-drop
  src/theme/              #   палитра, CSS-анимации

orchestrator/             # бэкенд пульта (отдельный каталог)
  journal.json            #   журнал (источник истины)
  journal.py              #   CLI операций (те же, что OPS фронтенда)
  server.py               #   HTTP API: GET /journal, POST /op
  dispatch.py             #   диспетчер: задача → реальный запуск модели
  review-backend.py       #   ревью/рефакторинг бэкенда бесплатной моделью
```

## Архитектура

```
                     ┌────────────────────────────────────────────┐
                     │  Офис (React, prompthospital.site)         │
                     │  drag-and-drop, карточка, каталог, лоток   │
                     └───────────────┬────────────────────────────┘
                          GET /journal│          POST /op (операции)
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
                     │  journal.json (источник истины)            │
                     └───────────────┬────────────────────────────┘
                                     │ читает в цикле (--loop)
                                     ▼
                     ┌────────────────────────────────────────────┐
                     │  dispatch.py — реально запускает модели    │
                     │  codex exec / claude -p                    │
                     └────────────────────────────────────────────┘
```

## Установка

### 1. Фронтенд

```bash
git clone https://github.com/s4ps4n/prompt-hospital.git
cd prompt-hospital
npm install
npm run dev        # dev-сервер http://localhost:5173
```

Режим интеграции с журналом включается env-переменной при сборке:

```bash
VITE_JOURNAL_URL=/journal npm run build   # офис будет читать/писать журнал по /journal
npm run preview                          # http://localhost:4173
```

Без `VITE_JOURNAL_URL` офис работает автономно (журнал в localStorage, захардкоженные задачи).

### 2. Оркестратор (бэкенд)

```bash
mkdir -p ~/orchestrator
# положить туда journal.json, journal.py, server.py, dispatch.py
cd ~/orchestrator
python3 journal.py list          # посмотреть журнал
python3 server.py 8090           # поднять API (локально)
python3 dispatch.py --once       # разовый проход диспетчера
```

## Подключение (как связать всё вместе)

1. **Заведи журнал** — `journal.json` с моделями команды:

```json
{
  "workers": [
    { "id": "w0", "model": "deepseek", "name": "Гермес", "provider": "DeepSeek",
      "role": "координатор", "status": "run", "task": null, "doneCount": 0, "history": [] }
  ],
  "queue": [], "log": [], "seq": 0
}
```

2. **Подними API** — `python3 server.py 8090` (отдаёт `/journal`, принимает `/op`).

3. **Собери фронт с `VITE_JOURNAL_URL=/journal`** и положи статику в nginx, проксируй
   `/journal` и `/op` на API (см. «Деплой» ниже).

4. **Запусти диспетчер**:

```bash
ORCHESTRATOR_API=https://prompthospital.site \
ORCHESTRATOR_AUTH='user:pass' \
python3 dispatch.py --loop 30
```

## Журнал: операции

`journal.py` (и `POST /op {name, args}`) поддерживает те же операции, что фронтенд:

| Операция | Аргументы | Что делает |
|---|---|---|
| `addTask` | title, priority(1-3), kind? | заводит задачу |
| `assign` | task, worker | назначает на модель (снимает с прежней) |
| `unassign` | task | возвращает в лоток |
| `setRole` | worker, role | меняет роль (у свободной) |
| `setPriority` | task, priority | меняет приоритет |
| `reorder` | task, before | встаёт перед задачей |
| `complete` | worker | закрывает текущую задачу |
| `block` | worker | переключает blocked/run |
| `addWorker` | model, name, provider, role | добавляет модель |
| `removeWorker` | worker | убирает свободную модель |

Роли: `координатор, исполнитель, архитектор, фулстак, сисадмин, дизайнер, UX/UI, приёмщик, рецензент`.

**Правило ведения:** запустил модель на задачу → сразу `addTask` + `assign` в журнал; завершил → `complete`. Иначе офис показывает неправду.

## Как добавить свою модель-исполнителя

В `dispatch.py` в функции `tick()` добавь ветку под свою модель:

```python
model = (w.get('model') or '').lower()
if 'codex' in model:
    ok = run_codex(task['id'], task['title'])
elif 'my-model' in model:
    ok = run_my_model(task['title'])
```

И напиши `run_my_model` — вызов твоего executor'а (CLI/API). Диспетчер сам запишет `complete`/`block` по результату.

## Деплой (как это развёрнуто в проде)

Фронт и API — docker-контейнеры в одной сети, за Traefik (как `doc.studiocms.ru`).

```bash
# 1. Статика в nginx, Basic Auth, прокси на API
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

# 2. API в docker-сети
docker run -d --name orchestrator-api --network deploy_default \
  -v /root/orchestrator:/app -w /app --restart unless-stopped \
  python:3.11-alpine python server.py 8090

# 3. Фронт с Traefik-лейблами (HTTPS через certResolver le)
docker run -d --name prompt-hospital --network deploy_default \
  -v /root/prompt-hospital/site:/usr/share/nginx/html:ro \
  -v /root/prompt-hospital/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /root/prompt-hospital/.htpasswd:/etc/nginx/.htpasswd:ro \
  --restart unless-stopped \
  --label traefik.enable=true \
  --label "traefik.http.routers.prompthospital.rule=Host(\`prompthospital.site\`)" \
  --label traefik.http.routers.prompthospital.entrypoints=websecure \
  --label traefik.http.routers.prompthospital.tls.certresolver=le \
  --label traefik.http.services.prompthospital.loadbalancer.server.port=80 \
  nginx:alpine
```

DNS: `A-запись prompthospital.site → <IP сервера>`. Сертификат выпустит Traefik (Let's Encrypt).

## Уровни интеграции (что уже готово)

- **A. Журнал** — единый источник истины, CLI операций.
- **B. Монитор** — офис читает журнал (read-only).
- **C. Запись** — drag-and-drop пишет в журнал через `POST /op`.
- **D. Исполнение** — диспетчер реально запускает модель по задаче и закрывает её.

Все четыре готовы. По умолчанию офис работает на уровне C (пишет в журнал); D включается запуском `dispatch.py`.

## Команда

| Модель | Роль | Как подключена |
|---|---|---|
| Гермес | координатор | DeepSeek (этот ассистент) |
| Claude Code | исполнитель | локально, `claude -p` |
| Codex | исполнитель | локально, `codex exec -s workspace-write` |
| Nemotron / Qwen / Laguna | рецензент | OpenRouter `:free` |

## Тесты и качество

```bash
npm test            # vitest — журнал, операции, интерактив, remote-режим
npm run lint        # oxlint
npm run build       # tsc + vite build
```

Ревью кода — через бесплатные модели OpenRouter (`orchestrator/review-backend.py`).
