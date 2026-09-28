# Оркестратор Prompt Hospital (бэкенд)

Единый источник истины по задачам и моделям ИИ-команды. Фронтенд (офис) читает и пишет
сюда через API, диспетчер реально запускает модели.

## Файлы

- `journal.json` — журнал (модели, очередь задач, лог). Источник истины.
- `journal.py` — CLI операций. Те же операции, что OPS фронтенда.
- `server.py` — HTTP API: `GET /journal`, `GET /health`, `POST /op {name, args}`.
- `dispatch.py` — диспетчер: задача на модели → реальный запуск исполнителя → complete/block.
- `review-backend.py` — ревью/рефакторинг этого бэкенда бесплатной моделью OpenRouter.

## Запуск

```bash
python3 journal.py list          # состояние журнала
python3 journal.py add-task "Задача" 3   # завести задачу (приоритет 1-3)
python3 journal.py assign T-1 w1         # назначить
python3 journal.py complete w1           # закрыть

python3 server.py 8090           # API (в проде — docker-контейнер orchestrator-api)

ORCHESTRATOR_API=https://prompthospital.site \
ORCHESTRATOR_AUTH='user:pass' \
python3 dispatch.py --loop 30    # диспетчер в цикле (каждые 30 с)
```

## Переменные окружения (dispatch.py)

- `ORCHESTRATOR_API` — базовый URL API (по умолчанию `http://localhost:8090`).
- `ORCHESTRATOR_AUTH` — `user:pass` (Basic) или `token:<токен>` (Bearer). Без секретов в коде.
- `ORCHESTRATOR_WORKDIR` — рабочая папка исполнителя (по умолчанию `~/prompt-hospital`).

## Как добавить исполнителя

В `dispatch.py` → `tick()` добавь ветку под `model` своей модели и функцию запуска
(аналог `run_codex`). Диспетчер сам запишет `complete` при успехе / `block` при ошибке,
с повторной проверкой `assignedTo` перед записью (защита от переназначения).

## Инварианты журнала

- `worker.task != null` ⇔ `status ∈ {run, blocked}`.
- `task.assignedTo` — существующая модель; `worker.task` — существующая задача.
- `assign` задачи на другую модель снимает её с прежней (reassign).
- Запись в файл — под `flock` (защита от гонок параллельных POST).

Проверка согласованности: `validate_journal.py` (генерируется по задаче, лежит рядом с фронтом).
