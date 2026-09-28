# Как Гермес (координатор) работает с офисом

Офис — это визуализация журнала. Гермес ведёт журнал, офис его показывает, диспетчер —
реально запускает модели. Никакого отдельного «подключения» нет: координатор просто
пишет в журнал теми же операциями, что и UI.

```
Гермес ── journal.py ──▶ journal.json ── server.py (GET /journal) ──▶ офис
                                              │
                              dispatch.py ───▶ реальный запуск модели
```

## Правило: журнал — единая точка истины

Что бы ни делалось (поставил задачу, передал модели, завершил) — это фиксируется в
`journal.json` через `journal.py`. Иначе офис показывает неправду.

Дисциплина:

- **поставил задачу** → `add-task` + `assign` (сразу назначить, если есть исполнитель);
- **модель закончила** → `complete`;
- **модель застряла / не та роль** → `block` / `unassign` / `set-role`.

## Команды (`orchestrator/journal.py`)

```bash
cd orchestrator

python3 journal.py list                              # текущее состояние журнала
python3 journal.py log                               # последние операции

python3 journal.py add-task "Сверстать лендинг" 3    # задача, приоритет 3=высокий, 2, 1=низкий
python3 journal.py add-task "Ревью бэкенда" 2 review # задача под роль (kind=review)

python3 journal.py assign T-1 w1                     # назначить задачу на модель (снимает с прежней)
python3 journal.py unassign T-1                      # вернуть в лоток (assignedTo = null)
python3 journal.py complete w1                       # закрыть текущую задачу модели
python3 journal.py block w1                          # заблокировать/разблокировать модель

python3 journal.py set-role w2 сисадмин              # сменить роль (у свободной модели)
python3 journal.py set-priority T-1 3                # сменить приоритет
python3 journal.py reorder T-2 T-1                   # поставить задачу перед T-1 в очереди

python3 journal.py add-worker codex Codex OpenAI исполнитель  # добавить модель
python3 journal.py remove-worker w9                  # убрать свободную модель
```

- `task` — это `T-<n>` (id из очереди), `worker` — `w<n>` (id модели).
- `kind` задаётся ролью, которой подходит задача (`review`, `дизайн`, …); `assign`
  откажет, если роль модели не совпадает с `kind`.

## Полный цикл задачи (пример)

```bash
python3 journal.py add-task "Поправить README" 3        # 1. задача в лотке Гермеса
python3 journal.py assign T-1 w1                        # 2. отдал Claude Code
# офис показывает: w1 в статусе «в работе», конверт ушёл из лотка
# dispatch.py запускает Claude Code, тот делает README
python3 journal.py complete w1                          # 3. закрыл — задача в истории, w1 свободен
```

## Как офис это видит

- Офис читает `GET /journal` по таймеру (polling) — изменения в журнале появляются
  в следующем цикле опроса.
- **Лоток Гермеса** = задачи с `assignedTo = null`.
- **Модель в работе** = `worker.status ∈ {run, blocked}` + `worker.task`.
- **Бездельники** (спят / кофе / гуляют) = `wait`/`done` без текущей задачи.

## Что где запускается

| Процесс | Команда | Зачем |
|---|---|---|
| журнал | `journal.py` (CLI) | вести задачи/модели вручную |
| API | `python3 server.py 8090` | отдать журнал офису |
| диспетчер | `python3 dispatch.py --loop 30` | реально запускать модели |

## См. также

- `README.md` — архитектура и операции.
- `orchestrator/README.md` — бэкенд, инварианты журнала.
- `INSTALL.md` — как развернуть (3 уровня).
