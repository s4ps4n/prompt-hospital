# Prompt Hospital Orchestrator (backend)

> [Русский](README.ru.md) · English

Single source of truth for the tasks and models of an AI team. The frontend (office) reads
and writes here through the API; the dispatcher actually runs the models.

## Files

- `journal.json` — the journal (models, task queue, log). Source of truth.
- `journal.py` — operation CLI. Same operations as the frontend OPS.
- `server.py` — HTTP API: `GET /journal`, `GET /health`, `POST /op {name, args}`.
- `dispatch.py` — dispatcher: task on a model → actually run the executor → complete/block.
- `review-backend.py` — review/refactor of this backend via a free OpenRouter model.

## Run

```bash
python3 journal.py list                 # view the journal
python3 journal.py add-task "Task" 3    # create a task (priority 1-3)
python3 journal.py assign T-1 w1        # assign
python3 journal.py complete w1          # close

python3 server.py 8090                  # API (in prod — docker container orchestrator-api)

ORCHESTRATOR_API=https://example.com \
ORCHESTRATOR_AUTH='user:pass' \
python3 dispatch.py --loop 30           # dispatcher on a loop (every 30 s)
```

## Environment variables (dispatch.py)

- `ORCHESTRATOR_API` — base URL of the API (default `http://localhost:8090`).
- `ORCHESTRATOR_AUTH` — `user:pass` (Basic) or `token:<token>` (Bearer). No secrets in code.
- `ORCHESTRATOR_WORKDIR` — executor working directory (default `~/prompt-hospital`).

## Adding an executor

In `dispatch.py` → `tick()`, add a branch for your model and a launch function (like
`run_codex`). The dispatcher records `complete` on success / `block` on failure, re-checking
`assignedTo` before writing (guards against reassignment mid-run).

## Journal invariants

- `worker.task != null` ⇔ `status ∈ {run, blocked}`.
- `task.assignedTo` — an existing model; `worker.task` — an existing task.
- `assign` a task to another model detaches it from the previous one (reassign).
- Writes to the file are under `flock` (guards against races across parallel POSTs).

Consistency check: `validate_journal.py`.
