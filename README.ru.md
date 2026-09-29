<div align="center">

# Prompt Hospital

**У ваших ИИ-моделей наконец есть офис.**

Изометрический пульт ИИ-команды в духе Theme Hospital: у каждой модели свой кабинет, задачи
приходят конвертами, а перетащил конверт на модель — она реально запускается.

[**▸ Демо**](https://prompthospital.site/demo) ·
[**Быстрый старт**](#установка) ·
[**Добавить модель**](#добавить-свою-модель) ·
[Дорожная карта](ROADMAP.md) ·
[English](README.md)

</div>

https://github.com/user-attachments/assets/0c18869a-997c-45b7-9600-4d6642f35a36

<div align="center">

![Node 22+](https://img.shields.io/badge/Node-22+-339933?logo=nodedotjs&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![MIT](https://img.shields.io/badge/license-MIT-green)

</div>

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

orchestrator/             # бэкенд пульта (в этом же репозитории)
  journal.example.json    #   стартовый журнал — скопируй в journal.json
  journal.py              #   CLI операций (те же, что OPS фронтенда)
  server.py               #   HTTP API: GET /journal, POST /op
  dispatch.py             #   диспетчер: задача → реальный запуск модели
```

## Архитектура

```
                     ┌────────────────────────────────────────────┐
                     │  Офис (React, example.com)         │
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
cd orchestrator
cp journal.example.json journal.json
python3 journal.py list          # посмотреть журнал
python3 server.py 8090           # поднять API (локально)
python3 dispatch.py --once       # разовый проход диспетчера
```

## Подключение (как связать всё вместе)

1. **Заведи журнал** — `cp orchestrator/journal.example.json orchestrator/journal.json`.

2. **Подними API** — `python3 orchestrator/server.py 8090` (отдаёт `/journal`, принимает `/op`).

3. **Собери фронт с `VITE_JOURNAL_URL=/journal`** и положи статику в nginx, проксируй
   `/journal` и `/op` на API (см. «Деплой» ниже).

4. **Запусти диспетчер**:

```bash
ORCHESTRATOR_API=https://example.com \
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

## Добавить свою модель

У модели две стороны: как она выглядит в офисе и что реально запускается, когда ей дают задачу.

**1. Внешность** — запись в `CATALOG` в [`src/journal/catalog.ts`](src/journal/catalog.ts):

```ts
{ model: 'phi', name: 'Phi', provider: 'Microsoft', hair: '#6fb7e8', color: '#3f87b8', skin: '#f2c9a0', style: 'bob', acc: 'glasses' },
```

`style`: `cap | bob | quiff | bun | spiky`; `acc` (необязательно): `wings | glasses | headset`.
Модель не из каталога всё равно получает стабильную внешность — по префиксу (`qwen-27b` → Qwen),
по провайдеру или по хэшу имени; этот шаг — про собственное лицо, а не про то, чтобы заработало.

**2. Запуск** — в [`orchestrator/dispatch.py`](orchestrator/dispatch.py), внутри `tick()`, ветка:

```python
model = (w.get('model') or '').lower()
if 'codex' in model:
    ok = run_codex(task['id'], task['title'])
elif 'my-model' in model:
    ok = run_my_model(task['title'])
```

Дальше — функция `run_my_model` с вызовом вашего исполнителя (CLI/API). `complete`/`block`
диспетчер проставит сам.

PR «Add model: <Имя>» со скриншотом кабинета — самый простой первый вклад.

## Деплой

Docker + nginx (Basic Auth) + Traefik с HTTPS — пошагово в [INSTALL.ru.md, уровень 2](INSTALL.ru.md).

## Уровни интеграции (что уже готово)

- **A. Журнал** — единый источник истины, CLI операций.
- **B. Монитор** — офис читает журнал (read-only).
- **C. Запись** — drag-and-drop пишет в журнал через `POST /op`.
- **D. Исполнение** — диспетчер реально запускает модель по задаче и закрывает её.

Все четыре готовы. По умолчанию офис работает на уровне C (пишет в журнал); D включается запуском `dispatch.py`.

## Эталонная сборка

Как это запущено у автора; любой оркестратор, который умеет HTTP, подключается так же.


| Модель | Роль | Как подключена |
|---|---|---|
| Гермес | координатор | DeepSeek через Hermes Agent |
| Claude Code | исполнитель | локально, `claude -p` |
| Codex | исполнитель | локально, `codex exec -s workspace-write` |
| Nemotron / Qwen / Laguna | рецензент | OpenRouter `:free` |

## Тесты и качество

```bash
npm test            # vitest — журнал, операции, интерактив, remote-режим
npm run lint        # oxlint
npm run build       # tsc + vite build
```

## Дорожная карта

- ✅ Офис и кабинеты — модели, лоток, журнал, бездельники
- ✅ Свой оркестратор — журнал, API, диспетчер, который реально запускает модели
- 🔜 Статистика — кто сколько работал, по моделям
- 🔜 Надзиратель — рука, которая шлёпает бездельников, чтобы бежали к Гермесу за задачей

Подробнее — [ROADMAP.md](ROADMAP.md).

## Благодарности и лицензия

Вдохновлено *Theme Hospital* (Bullfrog, 1997); ресурсы, названия и код оригинала не используются.
[MIT](LICENSE) © s4ps4n.

---

Сделано в Улан-Удэ — [@s4ps4n](https://github.com/s4ps4n), студия [АЙТИТЕК](https://it-uu.ru): сайты, интернет-магазины, ИИ-инструменты. Наш же — [Каркас CMS](https://karkas-cms.ru), в реестре российского ПО.
