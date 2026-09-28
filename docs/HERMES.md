# How Hermes (the coordinator) works with the office

The office is a visualization of the journal. Hermes maintains the journal, the office
renders it, and the dispatcher actually runs the models. There is no separate "connection":
the coordinator writes to the journal with the same operations the UI uses.

```
Hermes ── journal.py ──▶ journal.json ── server.py (GET /journal) ──▶ office
                                        │
                        dispatch.py ───▶ actually runs the model
```

## Rule: the journal is the single source of truth

Whatever happens (task created, handed to a model, finished) is recorded in `journal.json`
via `journal.py`. Otherwise the office shows a lie.

Discipline:

- **task created** → `add-task` + `assign` (assign immediately if there is an executor);
- **model finished** → `complete`;
- **model stuck / wrong role** → `block` / `unassign` / `set-role`.

## Commands (`orchestrator/journal.py`)

```bash
cd orchestrator

python3 journal.py list                              # current journal state
python3 journal.py log                               # recent operations

python3 journal.py add-task "Build the landing" 3    # task, priority 3=high, 2, 1=low
python3 journal.py add-task "Review backend" 2 review # task for a role (kind=review)

python3 journal.py assign T-1 w1                     # assign to a model (detaches from previous)
python3 journal.py unassign T-1                      # return to the tray (assignedTo = null)
python3 journal.py complete w1                       # close the model's current task
python3 journal.py block w1                          # block/unblock a model

python3 journal.py set-role w2 sysadmin              # change role (of an idle model)
python3 journal.py set-priority T-1 3                # change priority
python3 journal.py reorder T-2 T-1                   # put task before T-1 in the queue

python3 journal.py add-worker codex Codex OpenAI executor  # add a model
python3 journal.py remove-worker w9                  # remove an idle model
```

- `task` is `T-<n>` (id from the queue), `worker` is `w<n>` (model id).
- `kind` is set to the role the task fits (`review`, `design`, …); `assign` refuses if the
  model's role does not match `kind`.

## Full task cycle (example)

```bash
python3 journal.py add-task "Fix README" 3            # 1. task in Hermes's tray
python3 journal.py assign T-1 w1                       # 2. handed to Claude Code
# office shows: w1 "in progress", envelope left the tray
# dispatch.py runs Claude Code, which does the README
python3 journal.py complete w1                         # 3. closed — task in history, w1 idle
```

## How the office sees it

- The office reads `GET /journal` on a timer (polling) — journal changes appear on the next
  poll cycle.
- **Hermes's tray** = tasks with `assignedTo = null`.
- **Model in progress** = `worker.status ∈ {run, blocked}` + `worker.task`.
- **Idlers** (sleep / coffee / walk) = `wait`/`done` without a current task.

## What runs where

| Process | Command | Purpose |
|---|---|---|
| journal | `journal.py` (CLI) | maintain tasks/models by hand |
| API | `python3 server.py 8090` | serve the journal to the office |
| dispatcher | `python3 dispatch.py --loop 30` | actually run models |

## See also

- `README.md` — architecture and operations.
- `orchestrator/README.md` — backend, journal invariants.
- `INSTALL.md` — how to deploy (3 levels).
