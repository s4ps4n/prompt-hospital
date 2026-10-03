#!/usr/bin/env python3
"""Журнал оркестратора — CLI. Источник истины по задачам и моделям.

Схема совместима с Prompt Hospital (src/journal/types.ts):
  worker: id, model, name, provider, role, status(run|done|blocked|wait), task, doneCount, history
  task:   id, title, priority(3|2|1), order, assignedTo, kind
  journal: workers, queue, log, seq (задачи), workerSeq (воркеры)

Операции (как OPS в Prompt Hospital):
  add-task <title> [priority=2] [kind=роль]
  assign <task> <worker>
  unassign <task>
  removeTask <task> [reason]    — убрать задачу в archive, освободить воркера
  unblockTask <task> [reason]   — снять blocked, сбросить attempts
  setTaskRole <task> <role>     — роль задачи (kind), из ROLES
  complete <worker>
  block <worker>
  add-worker <model> <name> <provider> <role>
  list            — состояние
  log             — последние операции
"""
import json, os, sys, time, fcntl
from pathlib import Path

J = Path(__file__).resolve().parent / 'journal.json'
LOCK = J.with_name(J.name + '.lock')
ROLES = ('координатор', 'исполнитель', 'архитектор', 'фулстак', 'сисадмин', 'дизайнер', 'копирайтер', 'UX/UI', 'приёмщик', 'рецензент')


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


def set_decomposed(j, task_id, value=True):
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    t['decomposed'] = value
    log(j, 'setDecomposed', {'task': task_id, 'value': value})
    return f'{task_id}: decomposed={value}'


def add_task(j, title, priority=2, kind=None, depends_on=None, zone=None, decompose=False):
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
    # depends_on — список id задач-предшественников: пока они не done, задачу не берут.
    # zone — область работы (путь/подсистема): два воркера с одной зоной не запускаются
    # параллельно, чтобы не затирать друг друга.
    # decompose — крупная формулировка: Jev разобьёт её на подзадачи со связями.
    deps = []
    if depends_on:
        deps = [d.strip() for d in str(depends_on).split(',') if d.strip()]
        for d in deps:
            if not any(x['id'] == d for x in j['queue']):
                return f'нет задачи-предшественника {d}'
    big = str(decompose).lower() in ('1', 'true', 'yes', 'да')
    t = {'id': f'T-{j["seq"]}', 'title': str(title).strip(), 'priority': priority, 'order': j['seq'],
         'assignedTo': None, 'kind': kind, 'attempts': 0,
         'dependsOn': deps, 'comments': [], 'zone': (str(zone).strip() if zone else None),
         'decompose': big, 'decomposed': False}
    j['queue'].append(t)
    log(j, 'addTask', {'title': t['title'], 'priority': priority,
                       'dependsOn': deps, 'zone': t['zone'], 'decompose': big})
    extra = f' (ждёт: {", ".join(deps)})' if deps else ''
    extra += f' [зона: {t["zone"]}]' if t['zone'] else ''
    extra += ' [ДЕКОМПОЗИЦИЯ]' if big else ''
    return f'{t["id"]} добавлена{extra}'


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


def add_plan(j, plan_json):
    """Создаёт цепочку задач из плана декомпозиции Jev.

    plan_json — JSON вида {"tasks":[{"key","title","role","zone","dependsOn":[key]}]}.
    Ключи t1..tN локальные: здесь они превращаются в реальные T-id, и связи
    dependsOn переписываются с ключей на id. Возвращает список созданных id.
    """
    try:
        plan = json.loads(plan_json) if isinstance(plan_json, str) else plan_json
    except Exception as e:
        return f'план не разобран: {e}'
    tasks = (plan or {}).get('tasks') or []
    if not tasks:
        return 'план пуст'
    if len(tasks) > 12:
        return f'слишком много задач в плане: {len(tasks)} (максимум 12)'

    key_to_id = {}
    created = []
    # создаём в порядке плана: к моменту задачи её предшественники уже существуют
    for item in tasks:
        title = str(item.get('title') or '').strip()
        if not title:
            continue
        role = item.get('role')
        if role not in ROLES:
            role = None
        zone = item.get('zone')
        dep_keys = item.get('dependsOn') or []
        dep_ids = [key_to_id[k] for k in dep_keys if k in key_to_id]
        r = add_task(j, title, 2, role, ','.join(dep_ids) or None, zone)
        if 'добавлена' not in r:
            # пропускаем непрошедшую задачу, но не рушим весь план
            continue
        tid = r.split()[0]
        key = item.get('key') or f't{len(created) + 1}'
        key_to_id[key] = tid
        created.append(tid)

    if not created:
        return 'ни одна задача плана не создана'
    log(j, 'addPlan', {'created': created})
    return f'план из {len(created)} задач создан: {", ".join(created)}'


def add_comment(j, task_id, author, text):
    """Протокол передачи находок между исполнителями.

    Комментарий переживает прогон: следующий воркер читает тред и не повторяет
    ошибку предыдущего. Jev пишет сюда причину провала, диспетчер передаёт тред
    исполнителю в контексте.
    """
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    if not text or not str(text).strip():
        return 'пустой комментарий'
    t.setdefault('comments', []).append({
        'at': now(), 'author': str(author or 'system'), 'text': str(text).strip()[:2000],
    })
    t['comments'] = t['comments'][-20:]  # держим последние 20
    log(j, 'comment', {'task': task_id, 'author': author})
    return f'{task_id}: комментарий от {author} ({len(t["comments"])} всего)'


def fail_attempt(j, task_id, reason=None):
    """Считает провал попытки. После 3-й задача снимается с ротации (blocked).

    reason — диагноз провала: кладём в комментарии задачи, чтобы следующий
    исполнитель (или человек) видел, на чём именно споткнулись, и не повторял.
    """
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    t['attempts'] = int(t.get('attempts') or 0) + 1
    # Возврат всегда оставляет след в треде задачи, а не только в log.
    reason = str(reason or '').strip() or 'причина не указана'
    t.setdefault('comments', []).append({
        'at': now(), 'author': 'jev', 'text': f'попытка {t["attempts"]}: {reason[:500]}',
    })
    t['comments'] = t['comments'][-20:]
    w = find_worker(j, t.get('assignedTo') or '')
    if w and w['task'] == task_id:
        w['task'] = None
        w['status'] = 'wait'
    t['assignedTo'] = None
    if t['attempts'] >= 3:
        t['blocked'] = True
        log(j, 'failAttempt', {'task': task_id, 'attempts': t['attempts'], 'blocked': True})
        return f'{task_id}: попытка {t["attempts"]} — снята с ротации, нужен человек'
    log(j, 'failAttempt', {'task': task_id, 'attempts': t['attempts']})
    return f'{task_id}: попытка {t["attempts"]} из 3, вернулась в лоток'


def remove_task(j, task_id, reason=None):
    """Убирает задачу из офиса: в архив, с причиной. Воркер не остаётся занят.

    Раньше убрать задачу было нечем — только ручной правкой journal.json
    (скрипт вне journal.py дважды терял воркеров). Здесь обе стороны связи
    задача ↔ воркер правятся в одной операции под замком журнала.
    """
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    reason = str(reason or '').strip() or 'снята без указания причины'
    freed = []
    for w in j['workers']:
        if w.get('task') == task_id:
            w['task'] = None
            w['status'] = 'wait'
            freed.append(w['id'])
    j['queue'] = [x for x in j['queue'] if x['id'] != task_id]
    # Зависимые: снятая задача не «выполнена» — связь убираем с пометкой в треде,
    # чтобы было видно, почему задача перестала ждать.
    for x in j['queue']:
        if task_id in (x.get('dependsOn') or []):
            x['dependsOn'] = [d for d in x['dependsOn'] if d != task_id]
            x.setdefault('comments', []).append({
                'at': now(), 'author': 'журнал',
                'text': f'предшественник {task_id} «{t.get("title", "")}» снят из офиса: {reason[:300]}',
            })
            x['comments'] = x['comments'][-20:]
    # Заявка на найм под снятую задачу больше не ждёт владельца.
    for r in j.get('staffRequests', []):
        if r.get('task') == task_id and r.get('status') == 'pending':
            r['status'] = 'cancelled'
            r['resolvedAt'] = now()
    arch = dict(t, assignedTo=None, archivedAt=time.strftime('%d.%m %H:%M'),
                archivedReason=reason[:300])
    j.setdefault('archive', []).append(arch)
    j['archive'] = j['archive'][-200:]
    log(j, 'removeTask', {'task': task_id, 'reason': reason[:120], 'freed': freed})
    return f'{task_id} убрана в архив' + (f', освобождён {", ".join(freed)}' if freed else '')


def unblock_task(j, task_id, reason=None):
    """Возвращает задачу в ротацию: снимает blocked и сбрасывает счётчик попыток.

    Тред попыток не стирается — следующий исполнитель видит, на чём спотыкались.
    """
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    was = int(t.get('attempts') or 0)
    t['blocked'] = False
    t['attempts'] = 0
    if reason and str(reason).strip():
        t.setdefault('comments', []).append({
            'at': now(), 'author': 'координатор',
            'text': f'задача возвращена в работу после {was} попыток: {str(reason).strip()[:500]}',
        })
        t['comments'] = t['comments'][-20:]
    log(j, 'unblockTask', {'task': task_id, 'attempts': was})
    return f'{task_id}: разблокирована, попытки сброшены (было {was})'


def set_task_role(j, task_id, role):
    """Роль задачи (kind). Для роли ВОРКЕРА — setRole."""
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    if role not in ROLES:
        return f'роль должна быть из {ROLES}'
    w = find_worker(j, t.get('assignedTo') or '')
    if w and w.get('role') != role:
        return f'{task_id} у {w["name"]} («{w["role"]}») — сначала сними задачу'
    prev = t.get('kind')
    t['kind'] = role
    log(j, 'setTaskRole', {'task': task_id, 'role': role, 'prev': prev})
    return f'{task_id}: роль «{role}»'


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
    # Старые журналы не имеют workerSeq. Существующие id сохраняем,
    # а записанный счётчик не уменьшаем после удаления воркеров.
    last_worker = max((int(w['id'][1:]) for w in j['workers']
                       if w['id'].startswith('w') and w['id'][1:].isdigit()), default=0)
    j['workerSeq'] = max(j.get('workerSeq', 0), last_worker) + 1
    wid = f'w{j["workerSeq"]}'
    j['workers'].append({'id': wid, 'model': model, 'name': name, 'provider': provider,
                         'role': role, 'status': 'wait', 'task': None, 'doneCount': 0, 'history': [],
                         'available': True, 'unavailableUntil': None, 'unavailableReason': None})
    log(j, 'addWorker', {'model': model, 'role': role})
    return f'{wid} {name} ({role}) добавлена'


def remove_worker(j, worker_id):
    """Убирает исполнителя из офиса, освобождая рабочее место.

    Координатор нанимает спецов под задачу и увольняет, когда роль больше не
    нужна — иначе офис забит простаивающими моделями. Нельзя убрать того, кто
    в работе или держит задачу: сначала задача должна быть завершена или снята.
    """
    w = find_worker(j, worker_id)
    if not w:
        return 'нет модели'
    if w['role'] == 'координатор':
        return 'координатора убрать нельзя'
    if w.get('task'):
        return f'{w["name"]} в работе ({w["task"]}) — сначала заверши или сними задачу'
    held = [t['id'] for t in j['queue'] if t.get('assignedTo') == worker_id]
    if held:
        return f'за моделью закреплены задачи: {", ".join(held)} — сначала unassign'
    j['workers'] = [x for x in j['workers'] if x['id'] != worker_id]
    log(j, 'removeWorker', {'worker': worker_id, 'name': w['name'], 'role': w.get('role')})
    return f'{w["name"]} ({w.get("role")}) убрана из офиса, место {worker_id} свободно'


def staff_request(j, payload_json):
    """Регистрирует заявку на найм специалиста (решение принимает владелец).

    payload: {role, task, reason, skills[], suggested, suggested_name}.
    Повторные заявки на ту же роль+задачу не дублируются.
    """
    try:
        p = json.loads(payload_json) if isinstance(payload_json, str) else payload_json
    except Exception as e:
        return f'заявка не разобрана: {e}'
    role = (p or {}).get('role')
    task = (p or {}).get('task')
    if not role:
        return 'в заявке нет роли'
    j.setdefault('staffRequests', [])
    dup = next((r for r in j['staffRequests']
                if r.get('role') == role and r.get('task') == task and r.get('status') == 'pending'), None)
    if dup:
        return f'заявка на {role} уже есть (ждёт решения)'
    req = {
        'id': f'SR-{len(j["staffRequests"]) + 1}',
        'at': now(), 'role': role, 'task': task,
        'reason': (p.get('reason') or '')[:300],
        'skills': p.get('skills') or [],
        'suggested': p.get('suggested') or '',
        'suggested_name': p.get('suggested_name') or '',
        'status': 'pending',
    }
    j['staffRequests'].append(req)
    j['staffRequests'] = j['staffRequests'][-50:]
    log(j, 'staffRequest', {'role': role, 'task': task})
    return f'{req["id"]}: заявка на {role} принята'


def resolve_staff_request(j, req_id, decision):
    """Закрывает заявку: hired (наняли) или declined (отказали)."""
    req = next((r for r in j.get('staffRequests', []) if r['id'] == req_id), None)
    if not req:
        return f'нет заявки {req_id}'
    if decision not in ('hired', 'declined'):
        return 'решение должно быть hired или declined'
    req['status'] = decision
    req['resolvedAt'] = now()
    log(j, 'staffDecision', {'id': req_id, 'decision': decision})
    return f'{req_id}: {decision}'


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


def set_unavailable(j, worker_id, reason, minutes=60):
    """П.3 спецификации: исполнитель «нет кофе» — недоступен до времени.

    Состояние живёт в ЖУРНАЛЕ, а не в памяти диспетчера: панель и Надзиратель
    должны его ВИДЕТЬ, а не выяснять сами.
    """
    w = find_worker(j, worker_id)
    if not w:
        return f'воркер {worker_id} не найден'
    until = time.time() + max(1, int(minutes)) * 60
    w['available'] = False
    w['unavailableUntil'] = until
    w['unavailableReason'] = reason
    log(j, 'setUnavailable', {'worker': worker_id, 'reason': reason, 'minutes': int(minutes)})
    return f'{w["name"]}: нет кофе — {reason} до {time.strftime("%H:%M", time.localtime(until))}'


def set_available(j, worker_id):
    """Ручной сброс недоступности (когда квота восстановлена)."""
    w = find_worker(j, worker_id)
    if not w:
        return f'воркер {worker_id} не найден'
    w['available'] = True
    w['unavailableUntil'] = None
    w['unavailableReason'] = None
    log(j, 'setAvailable', {'worker': worker_id})
    return f'{w["name"]}: снова доступен'


def refresh_availability(j):
    """Снимает истёкшую недоступность. Вызывается перед раздачей работы."""
    changed = []
    for w in j.get('workers', []):
        if w.get('available') is False and w.get('unavailableUntil'):
            if time.time() >= w['unavailableUntil']:
                w['available'] = True
                w['unavailableUntil'] = None
                w['unavailableReason'] = None
                changed.append(w['id'])
                log(j, 'setAvailable', {'worker': w['id'], 'auto': True})
    return changed


def is_available(w):
    """Доступен ли воркер прямо сейчас (по данным журнала)."""
    if w.get('available') is False:
        until = w.get('unavailableUntil') or 0
        if time.time() < until:
            return False, w.get('unavailableReason') or 'недоступен'
    return True, ''


def render(j):
    out = []
    for w in j['workers']:
        t = find_task(j, w['task']) if w['task'] else None
        task = f' — {t["title"]}' if t else ''
        # П.3: состояние «нет кофе» видно в списке
        mark = ''
        if w.get('available') is False and w.get('unavailableUntil'):
            left = int((w['unavailableUntil'] - time.time()) / 60)
            if left > 0:
                mark = f'  ☕ нет кофе ({w.get("unavailableReason")}, ещё {left} мин)'
        out.append(f'  {w["id"]:3} {w["name"]:14} {w["role"]:11} [{w["status"]:8}]' + task + mark)
    out.append(f'  очередь: {len(j["queue"])} задач, log: {len(j["log"])} записей')
    return '\n'.join(out)


def main(argv):
    if not argv:
        return 'команды: add-task, assign, unassign, remove-task, unblock-task, set-task-role, complete, block, add-worker, list, log'
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
        'remove-task': 'removeTask', 'remove_task': 'removeTask',
        'unblock-task': 'unblockTask', 'unblock_task': 'unblockTask',
        'set-task-role': 'setTaskRole', 'set_task_role': 'setTaskRole',
    }
    cmd = alias.get(cmd, cmd)
    if cmd == 'addTask':
        title = argv[1] if len(argv) > 1 else ''
        prio = argv[2] if len(argv) > 2 else 2
        kind = argv[3] if len(argv) > 3 else None
        if kind in ('None', 'null', '', 'none'):
            kind = None
        deps = argv[4] if len(argv) > 4 else None
        if deps in ('None', 'null', '', 'none'):
            deps = None
        zone = argv[5] if len(argv) > 5 else None
        if zone in ('None', 'null', '', 'none'):
            zone = None
        dec = argv[6] if len(argv) > 6 else None
        if dec in ('None', 'null', '', 'none'):
            dec = False
        r = add_task(j, title, prio, kind, deps, zone, dec)
    elif cmd == 'setDecomposed':
        r = set_decomposed(j, argv[1], argv[2].lower() == 'true' if len(argv) > 2 else True) if len(argv) > 1 else 'usage: setDecomposed <task> [true|false]'
    elif cmd == 'setDecomposedBack':
        r = set_decomposed(j, argv[1], False) if len(argv) > 1 else 'usage: setDecomposedBack <task>'
    elif cmd == 'assign':
        r = assign(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: assign <task> <worker>'
    elif cmd == 'reassign':
        r = reassign(j, argv[1], argv[2], argv[3]) if len(argv) > 3 else 'usage: reassign <task> <from> <to>'
    elif cmd == 'unassign':
        r = unassign(j, argv[1])
    elif cmd == 'failAttempt':
        r = fail_attempt(j, argv[1], argv[2] if len(argv) > 2 else None) if len(argv) > 1 else 'usage: failAttempt <task> [reason]'
    elif cmd == 'setUnavailable':
        r = (set_unavailable(j, argv[1], argv[2] if len(argv) > 2 else 'недоступен',
                             argv[3] if len(argv) > 3 else 60)
             if len(argv) > 1 else 'usage: setUnavailable <worker> [reason] [minutes]')
    elif cmd == 'setAvailable':
        r = set_available(j, argv[1]) if len(argv) > 1 else 'usage: setAvailable <worker>'
    elif cmd == 'comment':
        r = add_comment(j, argv[1], argv[2], argv[3]) if len(argv) > 3 else 'usage: comment <task> <author> <text>'
    elif cmd == 'addPlan':
        # plan приходит либо путём к файлу, либо JSON-строкой
        arg = argv[1] if len(argv) > 1 else ''
        if arg and os.path.isfile(arg):
            with open(arg, encoding='utf-8') as f:
                r = add_plan(j, f.read())
        else:
            r = add_plan(j, arg) if arg else 'usage: addPlan <file.json|json-строка>'
    elif cmd == 'removeTask':
        r = remove_task(j, argv[1], argv[2] if len(argv) > 2 else None) if len(argv) > 1 else 'usage: removeTask <task> [reason]'
    elif cmd == 'unblockTask':
        r = unblock_task(j, argv[1], argv[2] if len(argv) > 2 else None) if len(argv) > 1 else 'usage: unblockTask <task> [reason]'
    elif cmd == 'setTaskRole':
        r = set_task_role(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: setTaskRole <task> <role>'
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
        r = remove_worker(j, argv[1]) if len(argv) > 1 else 'usage: removeWorker <worker>'
    elif cmd == 'staffRequest':
        r = staff_request(j, argv[1]) if len(argv) > 1 else 'usage: staffRequest <json>'
    elif cmd == 'staffDecision':
        r = resolve_staff_request(j, argv[1], argv[2]) if len(argv) > 2 else 'usage: staffDecision <SR-id> <hired|declined>'
    elif cmd == 'staffList':
        reqs = [x for x in j.get('staffRequests', []) if x.get('status') == 'pending']
        if not argv or argv[0] != '--json':
            if not reqs:
                r = 'заявок на найм нет'
            else:
                r = '\n'.join(
                    f"{x['id']} {x['role']:12} задача={x.get('task')} скиллы: {', '.join(x.get('skills') or []) or '—'}"
                    for x in reqs)
        else:
            r = json.dumps(reqs, ensure_ascii=False)
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
