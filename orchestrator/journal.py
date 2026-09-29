#!/usr/bin/env python3
"""Журнал оркестратора — CLI. Источник истины по задачам и моделям.

Схема совместима с Prompt Hospital (src/journal/types.ts):
  worker: id, model, name, provider, role, status(run|done|blocked|wait), task, doneCount, history
  task:   id, title, priority(3|2|1), order, assignedTo, kind
  journal: workers, queue, log, seq

Операции (как OPS в Prompt Hospital):
  add-task <title> [priority=2] [kind=роль]
  assign <task> <worker>
  unassign <task>
  complete <worker>
  block <worker>
  add-worker <model> <name> <provider> <role>
  list            — состояние
  log             — последние операции
"""
import json, sys, time, fcntl
from pathlib import Path

J = Path(__file__).resolve().parent / 'journal.json'
LOCK = J.with_name(J.name + '.lock')
ROLES = ('координатор', 'исполнитель', 'архитектор', 'фулстак', 'сисадмин', 'дизайнер', 'UX/UI', 'приёмщик', 'рецензент')


# Блокировка — в main() на весь цикл load→операция→save (LOCK).
def load():
    with open(J, 'r', encoding='utf-8') as f:
        return json.load(f)


def save(j):
    with open(J, 'w', encoding='utf-8') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')


def now():
    return time.strftime('%H:%M:%S')


def find_worker(j, w):
    return next((x for x in j['workers'] if x['id'] == w), None)


def find_task(j, t):
    return next((x for x in j['queue'] if x['id'] == t), None)


def log(j, op, args):
    j['log'].insert(0, {'op': op, 'args': args, 'at': now()})
    j['log'] = j['log'][:40]


def add_task(j, title, priority=2, kind=None):
    if not title or not str(title).strip():
        return 'заголовок задачи не может быть пустым'
    try:
        priority = int(priority)
    except (TypeError, ValueError):
        return 'приоритет должен быть числом'
    if priority not in (1, 2, 3):
        return 'приоритет должен быть 1, 2 или 3'
    if kind is not None and kind not in ROLES:
        return f'kind должен быть из {ROLES}'
    j['seq'] += 1
    t = {'id': f'T-{j["seq"]}', 'title': str(title).strip(), 'priority': priority, 'order': j['seq'],
         'assignedTo': None, 'kind': kind}
    j['queue'].append(t)
    log(j, 'addTask', {'title': t['title'], 'priority': priority})
    return f'{t["id"]} добавлена'


def assign(j, task_id, worker_id):
    t, w = find_task(j, task_id), find_worker(j, worker_id)
    if not t or not w:
        return 'нет задачи или модели'
    if w['role'] == 'координатор':
        return unassign(j, task_id)
    if t.get('kind') and t['kind'] != w['role']:
        return f'отказ: задача для роли «{t["kind"]}», а у {w["name"]} — «{w["role"]}»'
    # Снять задачу с прежней модели, если она была назначена на другую (reassign).
    prev_id = t.get('assignedTo')
    if prev_id and prev_id != worker_id:
        prev = find_worker(j, prev_id)
        if prev and prev['task'] == task_id:
            prev['task'] = None
            prev['status'] = 'wait'
    t['assignedTo'] = worker_id
    if w['task'] is None:
        w['task'] = task_id
        w['status'] = 'run'
        log(j, 'assign', {'task': task_id, 'worker': worker_id})
        return f'{task_id} → {w["name"]}: в работе'
    log(j, 'assign', {'task': task_id, 'worker': worker_id})
    return f'{task_id} встала в очередь к {w["name"]}'


def unassign(j, task_id):
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    w = find_worker(j, t.get('assignedTo') or '')
    t['assignedTo'] = None
    if w and w['task'] == task_id:
        w['task'] = None
        w['status'] = 'wait'
    log(j, 'unassign', {'task': task_id})
    return f'{task_id} в лоток'


def complete(j, worker_id):
    w = find_worker(j, worker_id)
    if not w or not w['task']:
        return 'нет текущей задачи'
    t = find_task(j, w['task'])
    j['queue'] = [x for x in j['queue'] if x['id'] != w['task']]
    if t:
        w['history'] = [t['title']] + w['history']
    w['doneCount'] += 1
    w['task'] = None
    nxt = next((x for x in j['queue'] if x['assignedTo'] == worker_id), None)
    w['status'] = 'run' if nxt else 'done'
    if nxt:
        w['task'] = nxt['id']
    log(j, 'complete', {'worker': worker_id})
    return f'{w["name"]}: завершил, doneCount={w["doneCount"]}' + (f', берёт {nxt["id"]}' if nxt else '')


def block(j, worker_id):
    w = find_worker(j, worker_id)
    if not w or not w['task']:
        return 'нет задачи в работе'
    w['status'] = 'run' if w['status'] == 'blocked' else 'blocked'
    log(j, 'block', {'worker': worker_id})
    return f'{w["name"]}: {w["status"]}'


def add_worker(j, model, name, provider, role):
    if role not in ROLES:
        return f'роль должна быть из {ROLES}'
    j['seq'] += 1
    wid = f'w{j["seq"]}'
    j['workers'].append({'id': wid, 'model': model, 'name': name, 'provider': provider,
                         'role': role, 'status': 'wait', 'task': None, 'doneCount': 0, 'history': []})
    log(j, 'addWorker', {'model': model, 'role': role})
    return f'{wid} {name} ({role}) добавлена'


def set_role(j, worker_id, role):
    w = find_worker(j, worker_id)
    if not w:
        return 'нет модели'
    if w['role'] == 'координатор':
        return 'роль координатора закреплена'
    if w['task']:
        return f'{w["name"]} в работе — сначала заверши или сними задачу'
    if role not in ROLES:
        return f'роль должна быть из {ROLES}'
    w['role'] = role
    log(j, 'setRole', {'worker': worker_id, 'role': role})
    return f'{w["name"]}: роль «{role}»'


def set_priority(j, task_id, priority):
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    try:
        priority = int(priority)
    except (TypeError, ValueError):
        return 'приоритет должен быть числом'
    if priority not in (1, 2, 3):
        return 'приоритет должен быть 1, 2 или 3'
    t['priority'] = priority
    log(j, 'setPriority', {'task': task_id, 'priority': priority})
    return f'{task_id}: приоритет {priority}'


def reorder(j, task_id, before_id):
    t, b = find_task(j, task_id), find_task(j, before_id)
    if not t or not b:
        return 'нет задачи'
    t['priority'] = b['priority']
    t['order'] = b['order'] - 0.5
    log(j, 'reorder', {'task': task_id, 'before': before_id})
    return f'{task_id} встала перед {before_id}'


def reassign(j, task_id, from_w, to_w):
    t = find_task(j, task_id)
    if not t or t['assignedTo'] != from_w:
        return f'{task_id} не назначена модели {from_w}'
    return assign(j, task_id, to_w)


def remove_worker(j, worker_id):
    w = find_worker(j, worker_id)
    if not w:
        return 'нет модели'
    if w['id'] == 'w0':
        return 'Гермеса убрать нельзя'
    if w['task'] or any(t['assignedTo'] == worker_id for t in j['queue']):
        return f'{w["name"]} занят — нельзя убрать'
    j['workers'] = [x for x in j['workers'] if x['id'] != worker_id]
    log(j, 'removeWorker', {'worker': worker_id})
    return f'{w["name"]} покинул офис'


def render(j):
    out = []
    for w in j['workers']:
        t = find_task(j, w['task']) if w['task'] else None
        task = f' — {t["title"]}' if t else ''
        out.append(f'  {w["id"]:3} {w["name"]:14} {w["role"]:11} [{w["status"]:8}]' + task)
    out.append(f'  очередь: {len(j["queue"])} задач, log: {len(j["log"])} записей')
    return '\n'.join(out)


def main(argv):
    if not argv:
        return 'команды: add-task, assign, unassign, complete, block, add-worker, list, log'
    # Эксклюзивный замок на весь цикл load→операция→save: server.py зовёт нас параллельно.
    with open(LOCK, 'a') as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            return dispatch(load(), argv)
        finally:
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


def dispatch(j, argv):
    cmd = argv[0]
    alias = {
        'add-task': 'addTask', 'add_task': 'addTask',
        'add-worker': 'addWorker', 'add_worker': 'addWorker',
        'set-role': 'setRole', 'set_role': 'setRole',
        'set-priority': 'setPriority', 'set_priority': 'setPriority',
        'remove-worker': 'removeWorker', 'remove_worker': 'removeWorker',
    }
    cmd = alias.get(cmd, cmd)
    if cmd == 'addTask':
        title = argv[1] if len(argv) > 1 else ''
        prio = argv[2] if len(argv) > 2 else 2
        kind = argv[3] if len(argv) > 3 else None
        if kind in ('None', 'null', '', 'none'):
            kind = None
        r = add_task(j, title, prio, kind)
    elif cmd == 'assign':
        r = assign(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: assign <task> <worker>'
    elif cmd == 'reassign':
        r = reassign(j, argv[1], argv[2], argv[3]) if len(argv) > 3 else 'usage: reassign <task> <from> <to>'
    elif cmd == 'unassign':
        r = unassign(j, argv[1])
    elif cmd == 'setRole':
        r = set_role(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: setRole <worker> <role>'
    elif cmd == 'setPriority':
        r = set_priority(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: setPriority <task> <priority>'
    elif cmd == 'reorder':
        r = reorder(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: reorder <task> <before>'
    elif cmd == 'complete':
        r = complete(j, argv[1])
    elif cmd == 'block':
        r = block(j, argv[1])
    elif cmd == 'addWorker':
        r = add_worker(j, argv[1], argv[2], argv[3], argv[4]) if len(argv) > 4 else 'usage: addWorker <model> <name> <provider> <role>'
    elif cmd == 'removeWorker':
        r = remove_worker(j, argv[1])
    elif cmd == 'list':
        return render(j)
    elif cmd == 'log':
        return '\n'.join(f'  {x["at"]} {x["op"]} {x["args"]}' for x in j['log'][:10]) or '  пусто'
    else:
        return 'неизвестная команда'
    save(j)
    return r + '\n' + render(j)


if __name__ == '__main__':
    print(main(sys.argv[1:]))
