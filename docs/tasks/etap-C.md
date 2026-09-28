# Этап C: офис пишет операции в реальный журнал (drag-and-drop → POST /op)

Ты работаешь в репозитории Prompt Hospital (`/home/hermes/prompt-hospital`).

## Контекст

Уровень B сделал офис read-only монитором: он читает `/journal` через `fetch`, операции
отключены. Теперь уровень C — операции снова работают, но пишут в **реальный журнал** через API.

API (уже работает, same-origin через nginx):
- `GET /journal` → `{ workers, queue, log, seq }`.
- `POST /op` body `{name, args[]}` → `{ok:true, out, journal}` (после операции возвращает
  обновлённый `journal`), либо `{ok:false, err}`.

Имена операций и аргументы совпадают с `OPS` фронтенда (см. `src/journal/ops.ts`):
`assign(task,worker)`, `reassign(task,from,to)`, `unassign(task)`, `setRole(worker,role)`,
`setPriority(task,priority)`, `reorder(task,before)`, `complete(worker)`, `block(worker)`,
`addWorker(model,name,provider,role)`, `removeWorker(worker)`, `addTask(title,priority,kind)`.

Бэкенд (`/home/hermes/orchestrator/journal.py`) поддерживает те же имена и аргументы.

## Что сделать

1. **Включить запись в remote-режиме.** Вместо read-only: операция из UI проходит так:
   - локально `check()` через `OPS` (сухой прогон) — если возвращает `err`, показать его
     в MessageBar и НЕ отправлять на сервер;
   - если `ok` — `POST /op {name, args}`;
   - ответ `{ok, journal}` — применить `journal` к состоянию;
   - ответ `{ok:false, err}` — показать `err` в MessageBar.

2. **Полёт конверта сохранить**: операция применяется по приземлении, но теперь через `POST /op`,
   не локально.

3. **Fallback**: если API недоступен (сеть/502) — режим остаётся монитором (read-only), как в B.

4. Убрать сообщение «только для чтения» в write-режиме; сообщение показывать только при fallback.

## Тестирование

- Тест: при подменённом `fetch` drag-and-drop/complete шлёт `POST /op` с правильными
  `{name, args}` и применяет `journal` из ответа.
- Тест: `check()` с ошибкой не шлёт `POST` (err показывается, сетевого вызова нет).
- Тест: ошибка сервера (`{ok:false,err}`) показывается в MessageBar.
- Fallback (сеть недоступна) → read-only, как раньше.
- `npm run build`, `npx vitest run`, `npm run lint` — зелёные.

## Формат доклада
Что добавил (файлы), как операция проходит через check→POST→journal, результат прогона.
