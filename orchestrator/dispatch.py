#!/usr/bin/env python3
"""Диспетчер задач оркестратора (уровень D): 
Интегрирован с Jev (System 1 / TypeSafe) для автономного триажа и валидации.
Запускает реальные CLI-раннеры (Claude Code, Codex, Gemini Design) по результатам Jev.
"""
import base64
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Literal, Optional

from jev_system1 import (triage_task, gatekeeper_review,
                         decompose_request, needs_decomposition, sanitize_plan,
                         _parse_json_loose)

API = os.getenv('ORCHESTRATOR_API', 'http://localhost:8090')
AUTH = os.getenv('ORCHESTRATOR_AUTH', '')
WORKDIR_PROMPT = os.getenv('ORCHESTRATOR_WORKDIR', '/home/hermes/prompt-hospital')
WORKDIR_CMS = '/home/hermes/cms_teach/engine'
# Своя папка оркестратора: задачи про сам офис (диспетчер, журнал, Jev) правятся
# ЛОКАЛЬНО — там установлены CLI Клода и Codex с полным доступом к файлам.
# На сервере CLI нет, там только модели-генераторы без инструментов.
WORKDIR_ORCHESTRATOR = os.getenv('ORCHESTRATOR_SELF_DIR', '/home/hermes/orchestrator')

def api(path, method='GET', payload=None):
    req = urllib.request.Request(API + path, method=method)
    if AUTH:
        if AUTH.startswith('token:'):
            req.add_header('Authorization', 'Bearer ' + AUTH[6:])
        else:
            req.add_header('Authorization', 'Basic ' + base64.b64encode(AUTH.encode()).decode())
    data = None
    if payload is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=120) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, Exception) as e:
        print(f'  ⚠ API {method} {path}: {e}', file=sys.stderr)
        return None

def op(name, args):
    return api('/op', 'POST', {'name': name, 'args': args})

## ─────────────────────────────────────────────────────────────────────
##  ПУНКТ 1 + 2: StructuredResult и таксономия провалов
## ─────────────────────────────────────────────────────────────────────

@dataclass
class StructuredResult:
    """Структурный результат исполнителя — проверяется диспетчером, не верится."""
    verdict: Literal['ok', 'fail', 'unknown'] = 'unknown'
    has_new_commit: bool = False
    tests_passed: bool = False
    failure_type: str = 'unknown'          # таксономия п.2
    failure_markers: list = field(default_factory=list)
    raw_output: str = ''
    git_diff_stat: str = ''


# Таксономия п.2: регэкспы определяют причину провала ДО Jev.
# Jev вызывается только для 'unknown'.
FAILURE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ('quota_exhausted', re.compile(
        r'usage limit exhausted|rate.?limit|quota|too many requests|'
        r'billing|insufficient.?credits|payment required|429',
        re.IGNORECASE)),
    ('no_access', re.compile(
        r'permission denied|not inside a trusted directory|EACCES|'
        r'access denied|not permitted|Operation not permitted|'
        r'authentication required|401 Unauthorized',
        re.IGNORECASE)),
    ('wrong_directory', re.compile(
        r'file not found|no such file|not found.*dispatch|not found.*journal|'
        r'cannot find module|ENOENT|FileNotFoundError|ModuleNotFoundError',
        re.IGNORECASE)),
    ('tests_failed', re.compile(
        r'FAIL[ED]*\s|tests?\s+failed|\d+\s+failing|AssertionError|'
        r'test\s+suite\s+failed|pytest.*ERROR|✗.*test',
        re.IGNORECASE)),
]

# Маркеры отказа — исполнитель честно завершился, не сделав работы
REFUSAL_MARKERS = re.compile(
    r'no changes|nothing to commit|no modifications|I cannot|'
    r'I\'m unable|outside.*scope|not able to|I don\'t have|'
    r'cannot proceed|Task failed|FAILED|fatal:',
    re.IGNORECASE)

# Маркер прогона тестов — должен быть в выводе
TEST_RUN_MARKERS = re.compile(
    r'tests?\s+passed|tests?\s+suites?|✓.*test|\d+\s+passed|'
    r'test result|PASS|pytest|test_.*ok|Tests:.*\d|'
    r'тестов нет|no tests|0 tests',
    re.IGNORECASE)


def _git_head(workdir):
    """Текущий HEAD — для сравнения до/после."""
    try:
        r = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=workdir,
                           capture_output=True, text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else ''
    except Exception:
        return ''


def _git_evidence(workdir):
    """Структурированное свидетельство работы: изменённые файлы и объём правки."""
    try:
        st = subprocess.run(['git', 'status', '--porcelain'], cwd=workdir,
                            capture_output=True, text=True, timeout=20)
        diff = subprocess.run(['git', 'diff', '--stat'], cwd=workdir,
                              capture_output=True, text=True, timeout=20)
        return {'changed': (st.stdout or '').strip(), 'diffstat': (diff.stdout or '').strip()}
    except Exception as e:
        return {'changed': '', 'diffstat': f'git недоступен: {e}'}


def classify_failure(output: str) -> tuple[str, list[str]]:
    """Таксономия п.2: определяет тип провала регэкспами, без LLM.

    Возвращает (тип, [найденные маркеры]).
    """
    markers = []
    for refusal in REFUSAL_MARKERS.finditer(output):
        markers.append(refusal.group(0))

    for ftype, pattern in FAILURE_PATTERNS:
        m = pattern.search(output)
        if m:
            return ftype, markers + [m.group(0)]

    if markers:
        return 'no_commit', markers  # есть маркеры отказа, но конкретный тип не определён

    return 'unknown', markers


def verify_result(output: str, workdir: str, head_before: str) -> StructuredResult:
    """Постусловия п.1: структурная проверка результата исполнителя.

    Три проверки:
      a) новый коммит появился в git
      b) в выводе есть строка прогона тестов
      c) в выводе нет маркеров отказа
    """
    head_after = _git_head(workdir)
    has_new_commit = bool(head_before and head_after
                          and head_before != head_after
                          and len(head_after) >= 7)

    tests_passed = bool(TEST_RUN_MARKERS.search(output))
    failure_type, failure_markers = classify_failure(output)
    ev = _git_evidence(workdir)

    # Вердикт
    if has_new_commit and tests_passed and not failure_markers:
        verdict = 'ok'
    elif has_new_commit and not failure_markers:
        verdict = 'ok'  # коммит есть, маркеров отказа нет — допускаем (тестов может не быть)
    else:
        verdict = 'fail'

    # Если коммита нет — уточняем тип
    if not has_new_commit and failure_type == 'unknown':
        failure_type = 'no_commit'

    return StructuredResult(
        verdict=verdict,
        has_new_commit=has_new_commit,
        tests_passed=tests_passed,
        failure_type=failure_type,
        failure_markers=failure_markers,
        raw_output=output[-3000:],
        git_diff_stat=ev.get('diffstat', ''),
    )


def _test_hint(workdir):
    """Подсказка о прогоне тестов: без неё исполнители закрывают задачи «на глаз».

    Jev-гейткипер отклоняет задачи, где тесты не запускались (урок релиза 1.5.0:
    approve 0.97 при шести красных тестах). Поэтому требуем прогон явно.
    """
    marks = []
    if os.path.exists(os.path.join(workdir, 'package.json')):
        marks.append('npm test / pnpm test')
    if os.path.isdir(os.path.join(workdir, 'tests')):
        marks.append('python3 -m pytest tests/')
    if any(f.startswith('test_') and f.endswith('.py') for f in os.listdir(workdir)):
        marks.append('python3 -m pytest')
    if not marks:
        marks = ['подходящие тесты проекта, если они есть']
    return (
        "\n\nОБЯЗАТЕЛЬНО ПЕРЕД ЗАВЕРШЕНИЕМ: запусти тесты (%s) и приведи в ответе "
        "ТОЧНУЮ команду и её вывод. Если тестов нет — напиши «тестов нет» и укажи, "
        "чем проверял. Задача без прогона тестов будет ОТКЛОНЕНА гейткипером."
        % ', '.join(marks)
    )


def _is_service_comment(c):
    """Служебный комментарий диспетчера/журнала («попытка N: ...», эскалации) — их пишет jev."""
    return str(c.get('author') or '').strip().lower() == 'jev'


def build_task_prompt(task, workdir, worker=None):
    """Промпт исполнителя из всей задачи: заголовок, описание, весь тред, роль, папка.

    Урок T-81/T-82: уходили только заголовок и три последних комментария —
    описание не передавалось никогда, бриф вытеснялся служебными «попытка N»,
    и исполнитель выдумывал, что от него хотят. Теперь ничего не режем:
    содержательные комментарии идут в хронологическом порядке, служебные —
    отдельным блоком в конце.
    """
    title = str(task.get('title') or '').strip()
    desc = task.get('description')
    desc = str(desc).strip() if desc is not None else ''
    comments = [c for c in (task.get('comments') or []) if str(c.get('text') or '').strip()]
    notes = [c for c in comments if not _is_service_comment(c)]
    attempts = [c for c in comments if _is_service_comment(c)]

    def fmt(c):
        at = f" {c.get('at')}" if c.get('at') else ''
        return f"[{c.get('author') or '?'}{at}]\n{str(c.get('text')).strip()}"

    parts = [f"## ЗАДАЧА {task.get('id', '')}".rstrip() + f"\n{title}"]
    if desc:
        parts.append(f"## ОПИСАНИЕ\n{desc}")
    if notes:
        parts.append("## БРИФ / ПРЕДЫДУЩИЕ НАХОДКИ\n"
                     "Комментарии к задаче целиком, в хронологическом порядке:\n\n"
                     + '\n\n'.join(fmt(c) for c in notes))
    if not desc and not notes:
        parts.append("## ВНИМАНИЕ: в задаче нет описания, что именно требуется\nЕсть только "
                     "заголовок. Делай то, что из него однозначно следует. Если объём работ "
                     "по заголовку понять нельзя — не выдумывай: так и напиши в ответе и "
                     "перечисли, каких сведений не хватает.")
    if attempts:
        parts.append("## ПРЕДЫДУЩИЕ ПОПЫТКИ (не повторяй ошибок)\n"
                     + '\n'.join(f"- {str(c.get('text')).strip()}" for c in attempts))

    kind = str(task.get('kind') or '').strip()
    role = kind or ('не указана' + (f" (исполнитель — {worker['role']})"
                                     if worker and worker.get('role') else ''))
    parts.append(f"## ГДЕ РАБОТАТЬ\nРоль: {role}\nРабочая папка: {workdir}\n"
                 "Работай в этой папке и зафиксируй результат коммитом в ней — "
                 "без нового коммита задача не принимается.")
    return '\n\n'.join(parts)


def run_claude(task_id, prompt, workdir):
    print(f'  ▶ [Claude Code] берёт {task_id} в {workdir} (промпт {len(prompt)} симв.)')
    r = subprocess.run(
        ['claude', '-p', prompt + _test_hint(workdir), '--permission-mode', 'acceptEdits'],
        cwd=workdir, capture_output=True, text=True, timeout=1800,
    )
    out = ((r.stdout or '') + '\n' + (r.stderr or '')).strip()
    if r.returncode == 0:
        print('  ✓ [Claude Code] завершил:', out.splitlines()[-1] if out else '(пусто)')
    else:
        print('  ✗ [Claude Code] ошибка:', out[:200])
    ev = _git_evidence(workdir)
    return {'ok': r.returncode == 0, 'output': out[-3000:], 'evidence': ev}


def run_codex(task_id, prompt, workdir):
    print(f'  ▶ [Codex] берёт {task_id} в {workdir} (промпт {len(prompt)} симв.)')
    r = subprocess.run(
        ['codex', 'exec', '-s', 'workspace-write', prompt + _test_hint(workdir)],
        cwd=workdir, capture_output=True, text=True, timeout=1800,
    )
    out = ((r.stdout or '') + '\n' + (r.stderr or '')).strip()
    if r.returncode == 0:
        print('  ✓ [Codex] завершил:', out.splitlines()[-1] if out else '(пусто)')
    else:
        print('  ✗ [Codex] ошибка:', out[:200])
    ev = _git_evidence(workdir)
    return {'ok': r.returncode == 0, 'output': out[-3000:], 'evidence': ev}

def deps_ready(task, queue, workers):
    """Задача готова к работе, если все её предшественники закрыты.

    Закрытая = её больше нет в очереди (complete убирает задачу из queue),
    либо она помечена выполненной. Если предшественник ещё висит — ждём.
    """
    deps = task.get('dependsOn') or []
    return all(not any(t['id'] == d for t in queue) for d in deps)


# Пул моделей-кандидатов под роль: не для автонайма, а чтобы ПОДСКАЗАТЬ владельцу,
# кого можно взять. Решение о найме принимает владелец — это трата ресурсов,
# автоматика тут только портит офис (наняли сисадмина → работу отдали фулстаку).
HIRE_POOL = {
    'архитектор': [
        {'model': 'claude-sonnet-4-5', 'name': 'Архитектор', 'provider': 'antigravity',
         'skills': ['проектирование структуры', 'инфо-архитектура', 'описание API-контрактов']},
    ],
    'сисадмин': [
        {'model': 'codex', 'name': 'Сисадмин', 'provider': 'openai',
         'skills': ['Docker', 'Traefik', 'деплой', 'бэкапы', 'диагностика серверов']},
    ],
    'копирайтер': [
        {'model': 'claude-sonnet-4-5', 'name': 'Копирайтер', 'provider': 'antigravity',
         'skills': ['тексты для сайта', 'заголовки', 'структура повествования', 'SEO-тексты']},
    ],
    'дизайнер': [
        {'model': 'google/gemini-2.5-flash', 'name': 'Gemini Design', 'provider': 'Google',
         'skills': ['визуальный язык', 'макеты', 'типографика', 'UI-кит']},
    ],
}


## ─────────────────────────────────────────────────────────────────────
##  ПУНКТ 3: Состояние исполнителя — память о провале
## ─────────────────────────────────────────────────────────────────────

# Память о недоступности: worker_id → (until_timestamp, reason).
# Не пробник — пробник сам ест квоту. Это память о последнем провале.
_worker_unavailable: dict[str, tuple[float, str]] = {}

# Пункт 4: паузы с ростом. Ключ: (task_id, worker_id) → timestamp ближайшего повтора.
_retry_backoff: dict[tuple[str, str], float] = {}

BACKOFF_MINUTES = [1, 5, 30]  # после каждой попытки — растущая пауза


def mark_worker_unavailable(worker_id: str, reason: str, minutes: int = 60):
    """П.3: исполнитель недоступен до указанного времени.

    Не пробник — пробник сам ест квоту. Это память о последнем провале:
    «кончился кофе» ≠ «бездельник». Состояние пишется В ЖУРНАЛ: панель и
    будущий Надзиратель должны его видеть, а не выяснять сами.
    """
    until = time.time() + minutes * 60
    _worker_unavailable[worker_id] = (until, reason)
    try:
        op('setUnavailable', [worker_id, reason, minutes])
    except Exception as e:
        print(f"  ! состояние не записано в журнал: {e}")
    print(f"  ☕ {worker_id} недоступен {minutes} мин: {reason}")


def worker_available(w: dict) -> tuple[bool, str]:
    """П.3: доступность по данным ЖУРНАЛА (единственный источник правды)."""
    if w.get('available') is False:
        left = (w.get('unavailableUntil') or 0) - time.time()
        if left > 0:
            return False, f"{w.get('unavailableReason') or 'недоступен'} (ещё {int(left/60)} мин)"
        # истекло — снимаем пометку в журнале
        try:
            op('setAvailable', [w['id']])
        except Exception:
            pass
    # локальный кеш как дополнение (если журнал не успел обновиться)
    return is_worker_available(w.get('id', ''))


def is_worker_available(worker_id: str) -> tuple[bool, str]:
    """П.3: проверка доступности в локальном кеше (дубль журнального состояния)."""
    entry = _worker_unavailable.get(worker_id)
    if not entry:
        return True, ''
    until, reason = entry
    if time.time() >= until:
        del _worker_unavailable[worker_id]
        print(f"  ☕ {worker_id} снова доступен (истекло)")
        return True, ''
    remaining = int((until - time.time()) / 60)
    return False, f"{reason} (ещё {remaining} мин)"


def should_retry(task_id: str, worker_id: str, attempt: int) -> tuple[bool, int]:
    """П.4: можно ли повторить задачу этому воркеру сейчас.

    Возвращает (можно, секунд_до_повтора).
    """
    key = (task_id, worker_id)
    deadline = _retry_backoff.get(key)
    if deadline and time.time() < deadline:
        return False, int(deadline - time.time())
    return True, 0


def set_retry_backoff(task_id: str, worker_id: str, attempt: int):
    """П.4: устанавливает паузу перед повтором с ростом 1→5→30 мин."""
    idx = min(attempt - 1, len(BACKOFF_MINUTES) - 1)
    minutes = BACKOFF_MINUTES[idx]
    key = (task_id, worker_id)
    _retry_backoff[key] = time.time() + minutes * 60
    print(f"  ⏳ повтор {task_id} → {worker_id}: пауза {minutes} мин (попытка {attempt})")


def role_present(workers, role):
    """Есть ли в офисе хоть один исполнитель этой роли (кроме координатора)."""
    return any(w.get('id') != 'w0' and (w.get('role') or '').strip() == role for w in workers)


def request_staff(role, task_id, reason, skills=None):
    """Заводит ЗАЯВКУ на найм вместо самого найма.

    Автоматика не тратит ресурсы: она только фиксирует потребность и показывает
    владельцу, кого и с какими навыками имеет смысл взять. Владелец решает.
    """
    cands = HIRE_POOL.get(role) or []
    suggestion = cands[0] if cands else None
    payload = {
        'role': role,
        'task': task_id,
        'reason': str(reason or '')[:300],
        'skills': skills or (suggestion or {}).get('skills') or [],
        'suggested': (suggestion or {}).get('model') or 'модель на выбор владельца',
        'suggested_name': (suggestion or {}).get('name') or '',
    }
    r = op('staffRequest', [json.dumps(payload, ensure_ascii=False)])
    out = r if isinstance(r, str) else (r or {}).get('out', '')
    print(f"  ! заявка на найм: {role} (задача {task_id}) — ждём решения владельца")
    return out


# Найм под роль задачи (issue #5): задача на роль, которой в офисе нет, не
# выкидывается и не уходит другой роли наугад — ждёт решения владельца.
HIRE_WAIT_MARK = 'ждёт решения владельца о найме'
HIRE_DECLINED_MARK = 'владелец отказал в найме'
HIRE_NOTE_AUTHOR = 'найм'          # не 'jev': пометка об отказе нужна исполнителю в брифе
DECLINE_FALLBACK_ROLE = 'фулстак'  # при отказе работа идёт силами офиса, осознанно


def _sr_id(out):
    m = re.search(r'SR-\d+', str(out or ''))
    return m.group(0) if m else ''


def _staff_request_for(task, role, staff_requests):
    """Последняя заявка на найм этой роли под эту задачу (любого статуса)."""
    reqs = [r for r in staff_requests or []
            if r.get('task') == task['id'] and r.get('role') == role]
    return reqs[-1] if reqs else None


def hire_gate(task, workers, staff_requests):
    """Задача на роль, которой в офисе нет. True — исполнителю сейчас не отдаём.

    Нет заявки → заводим (с обоснованием) и ждём. pending / hired без исполнителя
    → ждём. declined → задача не пропадает: идёт без профильной роли силами
    офиса (DECLINE_FALLBACK_ROLE) с пометкой в треде, а если и такой роли нет —
    остаётся в очереди остановленной, с пометкой для координатора.
    """
    tid, role = task['id'], (task.get('kind') or '').strip()
    req = _staff_request_for(task, role, staff_requests)
    if req is None:
        out = request_staff(role, tid, f"задача {tid} «{task.get('title', '')[:120]}» требует роль "
                                       f"«{role}», в офисе её нет")
        sr = _sr_id(out)
        op('comment', [tid, 'jev', f"{HIRE_WAIT_MARK}: {sr or 'заявка'} на роль «{role}» — "
                                   f"исполнителю задача не уходит до решения"])
        return True
    status = req.get('status')
    if status == 'declined':
        noted = _has_mark(task, HIRE_DECLINED_MARK)
        if role_present(workers, DECLINE_FALLBACK_ROLE) and role != DECLINE_FALLBACK_ROLE:
            if not noted:
                op('comment', [tid, HIRE_NOTE_AUTHOR,
                               f"{HIRE_DECLINED_MARK} «{role}» ({req.get('id')}): задача идёт без "
                               f"профильной роли — делает «{DECLINE_FALLBACK_ROLE}», осознанно"])
            op('setTaskRole', [tid, DECLINE_FALLBACK_ROLE])
            task['kind'] = DECLINE_FALLBACK_ROLE
            print(f"[{time.strftime('%H:%M:%S')}] {tid}: найм «{role}» отклонён — идёт как «{DECLINE_FALLBACK_ROLE}»")
            return False
        if not noted:
            op('comment', [tid, 'jev',
                           f"{HIRE_DECLINED_MARK} «{role}» ({req.get('id')}): задача остановлена — "
                           f"исполнителя нет; координатору: setTaskRole на роль из офиса или removeTask"])
            print(f"[{time.strftime('%H:%M:%S')}] {tid}: найм «{role}» отклонён — остановлена")
        return True
    what = 'наём одобрен, ждём исполнителя в офисе' if status == 'hired' else 'ждём решения владельца'
    print(f"[{time.strftime('%H:%M:%S')}] {tid} ({role}): {req.get('id')} — {what}")
    return True


def release_idle_specialists(queue, workers):
    """Увольняет нанятых спецов, под роль которых больше нет задач.

    Координатор не держит в офисе простаивающие места: наняли под задачу —
    освободили, когда работа кончилась. Кадровые роли (фулстак, приёмщик,
    дизайнер) не трогаем — они в штате постоянно.
    """
    CORE_ROLES = ('фулстак', 'приёмщик', 'дизайнер')
    pending_roles = {(t.get('kind') or '').strip() for t in queue if not t.get('blocked')}
    for w in list(workers):
        if w.get('id') == 'w0' or w.get('task'):
            continue
        role = (w.get('role') or '').strip()
        if not role or role in CORE_ROLES:
            continue
        if role in pending_roles:
            continue  # работа для роли ещё есть — держим
        r = op('removeWorker', [w['id']])
        out = r if isinstance(r, str) else (r or {}).get('out', '')
        if 'свободно' in str(out):
            print(f"[{time.strftime('%H:%M:%S')}] - {w['name']} ({role}) уволена: задач под роль нет")


# Маркеры комментариев декомпозиции: состояние живёт в треде задачи и переживает
# перезапуск службы (тот же приём, что ESCALATE_MARK).
DECOMPOSE_PLAN_MARK = 'разбито на'
DECOMPOSE_ASK_MARK = 'не могу разбить задачу'
DECOMPOSE_SINGLE_MARK = 'разбивать не на что'
DECOMPOSE_RETRY_SEC = 300   # пауза после сбоя вызова Jev-декомпозера
SUBTASK_BRIEF_AUTHOR = 'декомпозиция'   # не 'jev': бриф родителя должен попасть в БРИФ исполнителю

# Кеш решений needs_decomposition: ключ меняется, если у задачи появился бриф.
_decomp_cache: dict = {}
# Сбои вызова декомпозера: task_id → время следующей попытки.
_decomp_errors: dict = {}


def _has_mark(task, mark):
    return any(mark in str(c.get('text', '')) for c in (task.get('comments') or []))


def _awaiting_author(task):
    """Задан вопрос автору, а ответа (содержательного комментария после него) ещё нет."""
    comments = task.get('comments') or []
    asked = [i for i, c in enumerate(comments)
             if _is_service_comment(c) and DECOMPOSE_ASK_MARK in str(c.get('text', ''))]
    if not asked:
        return False
    return not any(not _is_service_comment(c) and str(c.get('text') or '').strip()
                   for c in comments[asked[-1] + 1:])


def _task_request_text(task):
    """Замысел целиком для декомпозера: заголовок, описание и бриф из треда."""
    parts = [str(task.get('title') or '').strip()]
    desc = str(task.get('description') or '').strip()
    if desc:
        parts.append(desc)
    parts += [str(c.get('text')).strip() for c in (task.get('comments') or [])
              if not _is_service_comment(c) and str(c.get('text') or '').strip()]
    return '\n\n'.join(p for p in parts if p)


def _decision_for(task, workers):
    key = (task['id'], task.get('title'), str(task.get('description') or ''),
           len(task.get('comments') or []), bool(task.get('decompose')))
    if key not in _decomp_cache:
        _decomp_cache[key] = needs_decomposition(task, workers)
    return _decomp_cache[key]


def _brief_comments(parent, n, total):
    """Бриф родителя кусками под лимит комментария журнала (2000 символов)."""
    head = (f"Подзадача {n} из {total} замысла {parent['id']} «{parent.get('title', '')}». "
            f"Замысел целиком:\n\n")
    body = _task_request_text(parent)
    size = 1900
    chunks = [body[i:i + size] for i in range(0, len(body), size)] or ['']
    out = [head + chunks[0]] + [f"{parent['id']}, продолжение брифа:\n{c}" for c in chunks[1:6]]
    if len(chunks) > 6:
        out[-1] += f"\n\n(бриф длиннее — полностью в задаче {parent['id']})"
    return out


def decompose_task(t, workers, why):
    """Разбивает одну задачу. Возвращает True, если задача остаётся у системы (hold)."""
    tid = t['id']
    print(f"[{time.strftime('%H:%M:%S')}] Jev decompose: разбираю «{t['title'][:60]}» ({why})")
    # Сохраняем флаг до Jev: прерванный тик не должен создать второй план.
    op('setDecomposed', [tid, 'true'])
    # Передаём состав офиса: Jev не должен ставить задачи на роли, которых нет,
    # и не должен плодить параллельные задачи одной роли (один воркер = очередь).
    raw = decompose_request(_task_request_text(t), workers)
    if raw is None:
        # Сбой вызова — не вина автора и не повод гнать исполнителя наугад: ждём и повторим.
        op('setDecomposed', [tid, 'false'])
        _decomp_errors[tid] = time.time() + DECOMPOSE_RETRY_SEC
        print(f"  → Jev-декомпозер не ответил, повтор через {DECOMPOSE_RETRY_SEC // 60} мин")
        return True
    _decomp_errors.pop(tid, None)

    items = raw.get('tasks') or [] if isinstance(raw, dict) else []
    if len(items) == 1:
        # Jev видит одну работу — разбивать нечего, задача идёт одним исполнителем.
        op('setDecomposed', [tid, 'false'])
        op('comment', [tid, 'jev', f"{DECOMPOSE_SINGLE_MARK}: Jev видит одну работу — "
                                   f"задача идёт одним исполнителем"])
        print('  → одна работа, идёт как есть')
        return False

    plan = sanitize_plan(raw, workers, tid)
    if not plan:
        # Jev не понял даже, из чего задача состоит: спрашиваем автора, никому не отдаём.
        op('setDecomposed', [tid, 'false'])
        q = str((raw or {}).get('question') or '').strip() if isinstance(raw, dict) else ''
        q = q or 'Опишите, что должно получиться в итоге: для кого, что умеет, где работает.'
        op('comment', [tid, 'jev', f"{DECOMPOSE_ASK_MARK} — не понятно, из чего она состоит. "
                                   f"Вопрос автору: {q[:600]} Ответьте комментарием — "
                                   f"после ответа разобью заново."])
        print(f"  → разбить нельзя, вопрос автору; задача без назначения")
        return True

    r = op('addPlan', [json.dumps(plan, ensure_ascii=False)])
    out = r if isinstance(r, str) else (r or {}).get('out', '')
    created = re.findall(r'T-\d+', str(out)) if 'создан' in str(out) else []
    print(f"  → {out}")
    if not created:
        op('setDecomposed', [tid, 'false'])
        _decomp_errors[tid] = time.time() + DECOMPOSE_RETRY_SEC
        print('  → журнал не принял план, повтор позже')
        return True
    for n, sid in enumerate(created, 1):
        for text in _brief_comments(t, n, len(created)):
            op('comment', [sid, SUBTASK_BRIEF_AUTHOR, text])
    # Роль нужна по плану, а исполнителя нет: задача остаётся, найм — владельцу.
    hires = []
    for sid, x in zip(created, plan['tasks']):
        if not x.get('hire'):
            continue
        sr = _sr_id(request_staff(x['role'], sid,
                                  f"замысел {tid} «{t.get('title', '')[:80]}»: подзадача {sid} "
                                  f"«{x['title'][:100]}» требует роль «{x['role']}», в офисе её нет"))
        op('comment', [sid, 'jev', f"{HIRE_WAIT_MARK}: {sr or 'заявка'} на роль «{x['role']}» — "
                                   f"исполнителю задача не уходит до решения"])
        hires.append(f"{x['role']} ({sid}{', ' + sr if sr else ''})")
    sub = '; '.join(f"{sid} «{x['title']}» ({x.get('role') or 'роль на триаже'})"
                    for sid, x in zip(created, plan['tasks']))
    hire_note = (f". Нужен найм: {', '.join(hires)} — эти подзадачи ждут решения владельца, "
                 f"остальные идут") if hires else ''
    op('comment', [tid, 'jev', f"{DECOMPOSE_PLAN_MARK} {len(created)} подзадач ({why}): {sub}{hire_note}"[:1900]])
    return True


def plan_decompositions(j):
    """Решает, какие задачи разбить, и разбивает не больше одной за тик.

    Возвращает множество id задач, которые исполнителю целиком не отдаются.
    """
    workers = j.get('workers', [])
    hold, done_one = set(), False
    for t in j.get('queue', []):
        if t.get('assignedTo') or t.get('blocked') or t.get('decomposed'):
            continue
        tid = t['id']
        if _has_mark(t, DECOMPOSE_SINGLE_MARK):
            continue                       # уже решено: одна работа
        if _has_mark(t, DECOMPOSE_ASK_MARK):
            if _awaiting_author(t):
                hold.add(tid)              # ждём ответа автора
                continue
            why = 'автор ответил на вопрос'
        else:
            d = _decision_for(t, workers)
            if not d.get('decompose'):
                continue
            why = d.get('reason') or 'крупная задача'
        hold.add(tid)
        if done_one or time.time() < _decomp_errors.get(tid, 0):
            continue                       # по одному плану за тик; после сбоя — пауза
        done_one = True
        if not decompose_task(t, workers, why):
            hold.discard(tid)
    return hold


def auto_assign_with_jev():
    """Jev (System 1) автономно распределяет задачи из лотка.

    Учитывает зависимости (ждём предшественников) и зоны (не запускаем двух
    воркеров в одной области параллельно).
    """
    j = api('/journal')
    if not j:
        return

    # Крупные задачи разбиваем сами: решение принимает система, не владелец (issue #5).
    # hold — задачи, которые сейчас НЕ отдаются исполнителю целиком: замысел уже
    # разбит (подзадачи идут сами), ждёт разбиения или ответа автора на вопрос.
    hold = plan_decompositions(j)
    j = api('/journal') or j

    # Кадры: увольняем простаивающих нанятых спецов перед раздачей работы — после
    # разбиения, иначе спеца уволят за тик до появления его подзадачи.
    release_idle_specialists(j.get('queue', []), j.get('workers', []))

    j = api('/journal')
    if not j:
        return
    queue = j.get('queue', [])
    unassigned = [t for t in queue
                  if not t.get('assignedTo') and not t.get('blocked')
                  and t['id'] not in hold and not t.get('decomposed')]
    if not unassigned:
        return

    workers = j.get('workers', [])
    # снимок занятых зон: по задачам, которые сейчас в работе
    busy_zones = set()
    for w in workers:
        if w.get('task'):
            t_cur = next((t for t in queue if t['id'] == w['task']), None)
            if t_cur and t_cur.get('zone'):
                busy_zones.add(t_cur['zone'])

    staff_requests = j.get('staffRequests', [])
    for task in unassigned:
        # 0. Роли нет в офисе — найм решает владелец; заявку заводим сразу, ещё до
        #    готовности предшественников: согласовать найм надо до запуска проекта.
        need_role = (task.get('kind') or '').strip()
        if need_role and need_role != 'координатор' and not role_present(workers, need_role):
            if hire_gate(task, workers, staff_requests):
                continue

        # 1. Зависимости: пока предшественники не закрыты — не берём
        if not deps_ready(task, queue, workers):
            pend = [d for d in (task.get('dependsOn') or []) if any(t['id'] == d for t in queue)]
            print(f"[{time.strftime('%H:%M:%S')}] {task['id']} ждёт предшественников: {', '.join(pend)}")
            continue

        # 2. Зона: не запускаем второго воркера в той же области
        if task.get('zone') and task['zone'] in busy_zones:
            print(f"[{time.strftime('%H:%M:%S')}] {task['id']} ждёт освобождения зоны '{task['zone']}'")
            continue

        # 3. Сначала триаж и выбор исполнителя из текущего состава офиса.
        # Журнал отказывает в назначении задачи с ролью исполнителю другой роли —
        # такого кандидата не выбираем ни у Jev, ни в fallback.
        kind = (task.get('kind') or '').strip()

        def fits(w):
            return not kind or (w.get('role') or '').strip() == kind

        decision = triage_task(task, workers)
        target = None
        if decision and decision.get('worker_id'):
            cand = next((w for w in workers
                         if w['id'] == decision['worker_id'] and w['id'] != 'w0' and fits(w)
                         and w.get('status') in ('wait', 'done') and not w.get('task')), None)
            # П.3: проверяем доступность выбранного Jev кандидата
            if cand:
                avail, why = worker_available(cand)
                if avail:
                    target = cand
                else:
                    print(f"  ☕ {cand['name']} недоступен: {why}")
            repo = decision.get('repo', 'prompt-hospital')
            print(f"[{time.strftime('%H:%M:%S')}] Jev (System 1): задача {task['id']} → {target['name'] if target else decision['worker_id']} (repo: {repo}, conf: {decision.get('confidence')})")

        # Fallback если Jev недоступен
        if not target:
            for w in workers:
                if w['id'] != 'w0' and fits(w) and w.get('status') in ('wait', 'done') and not w.get('task'):
                    # П.3: проверяем доступность (память о провале, из журнала)
                    avail, why = worker_available(w)
                    if not avail:
                        continue
                    target = w
                    break

        if target:
            print(f"[{time.strftime('%H:%M:%S')}] Назначение: {task['id']} → {target['name']} ({target['id']})")
            op('assign', [task['id'], target['id']])
            target['task'] = task['id']
            target['status'] = 'run'
            if task.get('zone'):
                busy_zones.add(task['zone'])
        elif not kind:
            # Роль в штате, но занята — ждём её (найм решён в шаге 0). Без роли — координатору.
            escalate_to_coordinator(task, decision)


# Маркер комментария эскалации: по нему не дублируем запись после перезапуска.
ESCALATE_MARK = 'роль не определена'
_escalated: set = set()


def escalate_to_coordinator(task, decision):
    """Роль у задачи не указана, Jev исполнителя не дал, свободных нет — не молчим.

    Задача передаётся координатору комментарием в треде (видно в офисе),
    один раз на задачу: и в памяти процесса, и по треду журнала.
    """
    tid = task['id']
    if tid in _escalated:
        return
    if any(ESCALATE_MARK in str(c.get('text', '')) for c in (task.get('comments') or [])):
        _escalated.add(tid)
        return
    why = (decision or {}).get('reason') or 'Jev не ответил'
    text = (f"{ESCALATE_MARK}, свободного исполнителя нет — нужен координатор (w0): "
            f"указать роль или нанять. Jev: {str(why)[:200]}")
    op('comment', [tid, 'jev', text])
    _escalated.add(tid)
    print(f"[{time.strftime('%H:%M:%S')}] {tid}: {ESCALATE_MARK} — передано координатору")


## ─────────────────────────────────────────────────────────────────────
##  ПУНКТ 5: git worktree на задачу — параллельные рабочие деревья
## ─────────────────────────────────────────────────────────────────────

def ensure_worktree(task_id: str, base_workdir: str) -> str:
    """Создаёт git worktree для задачи, возвращает путь.

    Каждая задача в своём дереве и ветке — конфликтов нет.
    Зона становится нужна только когда задачи трогают одни файлы.
    Без worktree — зоны по задаче, не по проекту.
    """
    branch = f"task/{task_id}"
    wt_dir = os.path.join(base_workdir, '.worktrees', task_id)

    if os.path.isdir(wt_dir):
        return wt_dir  # уже создано

    os.makedirs(os.path.dirname(wt_dir), exist_ok=True)

    # Создаём ветку от текущего HEAD, если ещё нет
    try:
        subprocess.run(['git', 'branch', branch], cwd=base_workdir,
                       capture_output=True, text=True, timeout=15)
    except Exception:
        pass

    try:
        r = subprocess.run(
            ['git', 'worktree', 'add', wt_dir, branch],
            cwd=base_workdir, capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            print(f"  🌳 worktree {task_id} → {wt_dir}")
            return wt_dir
        else:
            # fallback: worktree не удалось (может быть detached HEAD, bare и т.п.)
            print(f"  ! worktree не создан: {r.stderr.strip()[:120]}")
            return base_workdir
    except Exception as e:
        print(f"  ! worktree ошибка: {e}")
        return base_workdir


def cleanup_worktree(task_id: str, base_workdir: str):
    """Убирает worktree после завершения задачи."""
    wt_dir = os.path.join(base_workdir, '.worktrees', task_id)
    branch = f"task/{task_id}"
    if not os.path.isdir(wt_dir):
        return
    try:
        subprocess.run(['git', 'worktree', 'remove', '--force', wt_dir],
                       cwd=base_workdir, capture_output=True, text=True, timeout=15)
        subprocess.run(['git', 'branch', '-D', branch],
                       cwd=base_workdir, capture_output=True, text=True, timeout=10)
        print(f"  🧹 worktree {task_id} убран")
    except Exception:
        pass


# Провайдер воркера → раннер. Провайдер в журнале пишется свободно
# ('Anthropic', 'NVIDIA/OpenRouter', 'DeepSeek'), поэтому сверяем по частям
# после '/'. CLI есть только у Anthropic и OpenAI; всё остальное — HTTP-шлюз.
PROVIDER_RUNNERS = {
    'anthropic': 'claude-cli',
    'openai': 'codex-cli',
    'antigravity': 'http',
    'openrouter': 'http',
    'google': 'http',
    'deepseek': 'http',
}


def pick_runner(worker):
    """Раннер по провайдеру воркера; имя модели не учитывается. None — раннера нет."""
    parts = [p.strip() for p in (worker.get('provider') or '').lower().split('/')]
    # приоритет у последнего звена: 'NVIDIA/OpenRouter' — это OpenRouter
    for p in reversed(parts):
        if p in PROVIDER_RUNNERS:
            return PROVIDER_RUNNERS[p]
    return None


# Сколько содержимого существующих файлов отдаём HTTP-модели как контекст.
HTTP_CONTEXT_FILE_LIMIT = 60_000
HTTP_CONTEXT_TOTAL_LIMIT = 120_000


def _http_context_files(workdir, text):
    """Файлы рабочей папки, упомянутые в задаче, с содержимым.

    У HTTP-модели нет инструментов: без содержимого она не видит код и отвечает
    «файл недоступен» (так провалились T-61/T-68/T-62). Поэтому кладём в промпт
    те файлы, чьи имена встречаются в тексте задачи.
    """
    low = text.lower()
    picked, total = [], 0
    try:
        names = sorted(os.listdir(workdir))
    except Exception:
        return picked
    for name in names:
        path = os.path.join(workdir, name)
        if not os.path.isfile(path) or name.lower() not in low:
            continue
        try:
            with open(path, encoding='utf-8') as f:
                body = f.read()
        except Exception:
            continue
        if len(body) > HTTP_CONTEXT_FILE_LIMIT or total + len(body) > HTTP_CONTEXT_TOTAL_LIMIT:
            continue
        picked.append((name, body))
        total += len(body)
    return picked


def run_http(task_id, prompt, workdir, worker):
    """Исполнитель через HTTP-шлюз (antigravity/openrouter): модель правит файлы сама.

    В отличие от CLI-раннеров, здесь нет песочницы инструментов — модель отвечает
    текстом. Поэтому даём ей список и содержимое упомянутых в задаче файлов и
    просим вернуть новые файлы целиком либо точечные замены в существующих —
    их затем применяем на диск. Это честный путь для провайдеров, недоступных
    через CLI (геоблок Anthropic/OpenAI на сервере).
    """
    model = worker.get('model')
    endpoint, key = _provider_creds(worker.get('provider'))
    if not key:
        return {'ok': False, 'output': f'нет ключа для провайдера {worker.get("provider")}', 'evidence': {}}

    # Собираем контекст: что уже есть в рабочей папке
    listing = ''
    try:
        files = sorted(os.listdir(workdir))[:60]
        listing = ', '.join(files)
    except Exception as e:
        listing = f'(не прочитан: {e})'

    context = _http_context_files(workdir, prompt)
    context_block = ''.join(
        f"\n=== FILE: {name} ===\n{body}\n=== END FILE: {name} ===\n" for name, body in context)

    system_prompt = (
        "You are a senior engineer working on a real project. You edit files directly. "
        "Answer ONLY with a JSON object, no prose, no markdown fences: "
        '{"edits": [{"path": "relative/path", "find": "exact existing text", "replace": "new text"}], '
        '"files": [{"path": "relative/path", "content": "FULL file content"}], '
        '"summary": "one line what changed", "done": true|false} '
        "Rules: path is relative to the project root. To change an existing file use edits: "
        "find must be copied verbatim from the file shown to you and occur exactly once. "
        "Use files only for NEW files (content is the complete file). "
        "If nothing needs changing, return empty lists and done=false with a reason. "
        "Never invent files that are not needed for this task."
    )
    user_prompt = (
        f"Project root: {workdir}\n"
        f"Files present: {listing}\n"
        f"{context_block}\n"
        f"TASK:\n{prompt}\n\n"
        "Return the JSON described in the system prompt."
    )

    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt},
        ],
        'temperature': 0.0,
        'max_tokens': 8000,
    }
    print(f'  ▶ [{worker["name"]}] {model} через {endpoint.split("/")[2]}, работа в {workdir}')
    started = time.time()
    try:
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode(),
            headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=1800) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f'  ✗ [{worker["name"]}] ошибка шлюза: {str(e)[:160]}')
        return {'ok': False, 'output': str(e), 'evidence': _git_evidence(workdir)}

    content = (data.get('choices') or [{}])[0].get('message', {}).get('content', '')
    parsed = _parse_json_loose(content)
    if not parsed:
        print(f'  ✗ [{worker["name"]}] ответ не разобран: {content[:120]}')
        return {'ok': False, 'output': content[:2000], 'evidence': _git_evidence(workdir)}

    def _dest(rel):
        # защита от записи за пределы рабочей папки
        dest = os.path.normpath(os.path.join(workdir, rel))
        if not dest.startswith(os.path.normpath(workdir) + os.sep):
            print(f'  ! пропущен путь вне проекта: {rel}')
            return None
        return dest

    written, failed = [], []
    for item in (parsed.get('edits') or []):
        rel = (item.get('path') or '').strip()
        find, repl = item.get('find'), item.get('replace')
        dest = _dest(rel) if rel else None
        if not dest or not find or repl is None:
            continue
        try:
            with open(dest, encoding='utf-8') as f:
                src = f.read()
        except Exception as e:
            failed.append(f'{rel}: {e}')
            continue
        if src.count(find) != 1:
            failed.append(f'{rel}: фрагмент find найден {src.count(find)} раз(а)')
            continue
        with open(dest, 'w', encoding='utf-8') as f:
            f.write(src.replace(find, repl, 1))
        if rel not in written:
            written.append(rel)

    for item in (parsed.get('files') or []):
        rel = (item.get('path') or '').strip()
        body = item.get('content')
        dest = _dest(rel) if rel else None
        if not dest or body is None:
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'w', encoding='utf-8') as f:
            f.write(body)
        if rel not in written:
            written.append(rel)

    summary = parsed.get('summary') or ''
    ok = bool(parsed.get('done')) and bool(written) and not failed
    print(f'  {"✓" if ok else "✗"} [{worker["name"]}]: {summary[:120]} (файлов: {len(written)})')
    output = f'{summary}\nфайлы: {", ".join(written)}'
    if failed:
        output += '\nне применено: ' + '; '.join(failed)
    return {
        'ok': ok,
        'output': output,
        'evidence': _git_evidence(workdir),
    }


def _shuttle_key():
    """Ключ шлюза Antigravity — тем же способом, что в jev_system1."""
    key = os.getenv('ANTIGRAVITY_FATHER_API_KEY')
    if key:
        return key
    for p in ('/home/hermes/.hermes/profiles/papa/config.yaml', '/home/hermes/.hermes/config.yaml'):
        try:
            with open(os.path.expanduser(p), encoding='utf-8') as f:
                for line in f:
                    if 'ANTIGRAVITY_FATHER_API_KEY' in line and ':' in line:
                        val = line.split(':', 1)[1].strip().strip('"\'')
                        if val and not val.startswith('env:'):
                            return val
        except Exception:
            continue
    try:
        env_path = '/home/hermes/.hermes/.env'
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                if line.startswith('ANTIGRAVITY_FATHER_API_KEY='):
                    return line.split('=', 1)[1].strip().strip('"\'')
    except Exception:
        pass
    return ''


def _shuttle_endpoint():
    return os.getenv('JEV_ENDPOINT', 'https://ag.omni.mice.zone/v1/chat/completions')


# Провайдер → (файл секрета, переменная ключа, эндпоинт по умолчанию).
# Провайдеры со своим API ходят напрямую; остальные — через шлюз Antigravity.
PROVIDER_SECRETS = {
    'deepseek': ('/home/hermes/orchestrator/secrets/deepseek.env',
                 'DEEPSEEK_API_KEY',
                 'https://api.deepseek.com/v1/chat/completions'),
}


def _provider_creds(provider: str):
    """Возвращает (endpoint, key) для провайдера воркера.

    Свой ключ у провайдера — идём напрямую; иначе — шлюз Antigravity.
    Ключ берём из env, затем из файла секрета.
    """
    name = (provider or '').strip().lower()
    entry = PROVIDER_SECRETS.get(name)
    if not entry:
        return _shuttle_endpoint(), _shuttle_key()

    path, var, default_ep = entry
    ep_var = var.replace('_API_KEY', '_ENDPOINT')
    key = os.getenv(var) or ''
    ep = os.getenv(ep_var) or default_ep
    if not key:
        try:
            with open(path, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(var + '='):
                        key = line.split('=', 1)[1].strip().strip('"\'')
                    elif line.startswith(ep_var + '='):
                        ep = line.split('=', 1)[1].strip().strip('"\'')
        except Exception:
            pass
    if key:
        return ep, key
    # ключа нет — падаем на шлюз, чтобы воркер не молчал
    print(f"  ! нет ключа для провайдера '{name}' ({path})")
    return _shuttle_endpoint(), _shuttle_key()


def verify_journal(j):
    """Приводит журнал в согласованное состояние: задача ↔ воркер.

    Трижды за сессию ловился один рассинхрон: задача в лотке свободна, а воркер
    считает её своей (или наоборот). Ручные правки не синхронизируют обе стороны.
    Здесь выравниваем через штатные операции assign/unassign — они пишут в журнал
    на сервере, поэтому результат сохраняется.
    """
    ids = {t['id']: t for t in j.get('queue', [])}
    fixed = []
    for w in j.get('workers', []):
        held = w.get('task')
        if not held:
            continue
        t = ids.get(held)
        if t is None:
            # воркер держит задачу, которой нет в очереди: возвращаем его в строй
            op('unassign', [held])
            fixed.append(f'{w["id"]} отпустил удалённую {held}')
        elif t.get('assignedTo') != w['id']:
            op('assign', [held, w['id']])
            fixed.append(f'{held} привязана к {w["id"]}')
    # задача назначена тому, кто её не держит — возвращаем в лоток
    for t in j.get('queue', []):
        a = t.get('assignedTo')
        if not a:
            continue
        w = next((x for x in j.get('workers', []) if x['id'] == a), None)
        if w is None or w.get('task') != t['id']:
            op('unassign', [t['id']])
            fixed.append(f'{t["id"]} снята с нечужого держателя')
    if fixed:
        for f in fixed:
            print(f'  [журнал] выровнено: {f}')
    return fixed


def tick():
    # Перед раздачей работы выравниваем журнал: задача ↔ воркер.
    j0 = api('/journal')
    if j0:
        if verify_journal(j0):
            j0 = api('/journal') or j0
    auto_assign_with_jev()
    j = api('/journal')
    if not j:
        return

    for w in j.get('workers', []):
        if not w['task']:
            continue
        if w.get('status') == 'blocked':
            continue  # результат ждёт ручной приёмки — не перезапускаем по кругу
        task = next((t for t in j.get('queue', []) if t['id'] == w['task']), None)
        if not task or task.get('assignedTo') != w['id']:
            continue

        # Определяем папку репозитория
        text = (task.get('title', '') + ' ' + str(task.get('description', ''))).lower()
        is_cms = any(k in text for k in ['cms', 'каркас', 'teach', '#5', 'seo', 'sitemap', 'llms', 'drawer', 'раздел'])
        # Определяем рабочую папку по СМЫСЛУ задачи, а не только по ключевым словам
        # Каркаса. Задачи про сам оркестр (журнал, диспетчер, Jev, зоны, найм)
        # должны исполняться в WORKDIR_ORCHESTRATOR — иначе исполнитель ищет
        # dispatch.py не там и рапортует «файл недоступен».
        is_orchestrator = any(k in text for k in [
            'диспетчер', 'оркестратор', 'journal', 'dispatch', 'jev', 'раннер',
            'декомпозиц', 'найм', 'зона', 'воркер', 'офис', 'id воркеров',
        ])
        if is_orchestrator and os.path.exists(WORKDIR_ORCHESTRATOR):
            workdir = WORKDIR_ORCHESTRATOR
        else:
            workdir = WORKDIR_CMS if is_cms and os.path.exists(WORKDIR_CMS) else WORKDIR_PROMPT

        # П.5: worktree на задачу — параллельное рабочее дерево
        workdir = ensure_worktree(task['id'], workdir)

        # ПРОТОКОЛ НАХОДОК: исполнитель получает задачу целиком — заголовок,
        # описание, весь тред комментариев, роль и рабочую папку.
        prompt = build_task_prompt(task, workdir, w)
        print(f"  → задача «{task.get('title', '')}»: передаю исполнителю "
              f"{len(task.get('comments') or [])} комментариев, промпт {len(prompt)} симв.")

        # ВЫБОР РАННЕРА ПО ПРОВАЙДЕРУ, а не по имени модели: 'claude-sonnet-4-5'
        # у antigravity — это HTTP-шлюз, а не Claude CLI.
        provider = (w.get('provider') or '').strip()
        mdl = (w.get('model') or '').strip()
        runner = pick_runner(w)

        # П.1: снимаем HEAD до запуска — для сравнения постусловия «новый коммит»
        head_before = _git_head(workdir)

        if runner == 'claude-cli':
            print(f"[{time.strftime('%H:%M:%S')}] Задача {task['id']} → Claude CLI")
            result = run_claude(task['id'], prompt, workdir)
        elif runner == 'codex-cli':
            print(f"[{time.strftime('%H:%M:%S')}] Задача {task['id']} → Codex CLI")
            result = run_codex(task['id'], prompt, workdir)
        elif runner == 'http':
            print(f"[{time.strftime('%H:%M:%S')}] Задача {task['id']} → {w['name']} ({w.get('model')} через {provider})")
            result = run_http(task['id'], prompt, workdir, w)
        else:
            print(f"  ! для воркера {w['id']} ({w['name']}) нет раннера: провайдер '{provider}', модель '{mdl}'")
            continue

        # ─────────────────────────────────────────────────────────────
        #  П.1 + П.2 + П.3 + П.4 + П.5: Структурная приёмка
        # ─────────────────────────────────────────────────────────────
        raw_output = result.get('output', '') if isinstance(result, dict) else ''

        # П.1: постусловия — проверяем структурно, не верим returncode
        sr = verify_result(raw_output, workdir, head_before)

        print(f"  [структура] verdict={sr.verdict} commit={sr.has_new_commit} "
              f"tests={sr.tests_passed} type={sr.failure_type} "
              f"markers={len(sr.failure_markers)}")

        # П.5: гейткипер по структуре — если нет коммита → reject без Jev
        if sr.verdict == 'fail' and not sr.has_new_commit:
            verdict = 'reject'
            diag_note = f"{sr.failure_type} (структурный провал, без LLM)"
            print(f"  [авто-reject] {diag_note}")

            # П.3: если quota_exhausted → исполнитель недоступен
            if sr.failure_type == 'quota_exhausted':
                mark_worker_unavailable(w['id'], 'quota_exhausted', minutes=60)

        elif sr.verdict == 'fail':
            # Есть коммит, но есть и маркеры провала — зовём Jev только на unknown
            if sr.failure_type == 'unknown':
                from jev_system1 import diagnose_failure
                diag = diagnose_failure(raw_output, stage=workdir)
                diag_note = (f"{diag.get('cause')} → {diag.get('action')} "
                             f"(уверенность {diag.get('confidence')})")
            else:
                diag_note = f"{sr.failure_type} (регэксп)"
            verdict = 'reject'
            print(f"  [Jev/regex] {diag_note}")

        elif sr.verdict == 'ok':
            # Структурно ок — зовём Jev-гейткипер для финальной проверки
            gate = gatekeeper_review(task, w.get('name', ''), raw_output, True)
            verdict = gate.get('verdict', 'approve')
            diag_note = gate.get('reason', '')
            print(f"  [Jev gatekeeper] вердикт: {verdict} "
                  f"(tests={gate.get('tests_passed')}, spec={gate.get('spec_compliant')})")
            if diag_note:
                print(f"    причина: {diag_note[:160]}")

        else:  # unknown
            verdict = 'escalate_to_human'
            diag_note = 'структурный результат неопределён'

        # Закрытие или возврат задачи
        j2 = api('/journal')
        if j2:
            t2 = next((t for t in j2.get('queue', []) if t['id'] == task['id']), None)
            if t2 and t2.get('assignedTo') == w['id']:
                if verdict == 'approve':
                    print('  →', op('complete', [w['id']]))
                    # П.5: убираем worktree после успешного завершения
                    cleanup_worktree(task['id'], workdir)
                elif verdict == 'escalate_to_human':
                    print(f"  → эскалация на ручную приёмку: {task['id']} "
                          f"(diffstat: {sr.git_diff_stat[:80] or 'нет правок'})")
                    # Раньше здесь журнал не менялся: задача оставалась за воркером,
                    # и следующий тик запускал её заново — по кругу и молча.
                    op('comment', [task['id'], 'jev',
                                   f"нужна ручная приёмка: {str(diag_note or '')[:300]}; "
                                   f"правки: {sr.git_diff_stat[:120] or 'нет'}"])
                    if w.get('status') != 'blocked':
                        op('block', [w['id']])
                else:
                    # П.4: пауза с ростом + запрет повтора к тому же воркеру
                    attempt = int(t2.get('attempts', 0)) + 1
                    set_retry_backoff(task['id'], w['id'], attempt)

                    # П.4: комментарий — только диагноз, не сырой вывод
                    reason = diag_note or 'провал исполнения'
                    print(f"  → отклонено: {task['id']} [{sr.failure_type}]")
                    print('  →', op('failAttempt', [task['id'], str(reason)[:400]]))

_running = True

def _stop(signum, frame):
    global _running
    _running = False
    print('\nОстановка диспетчера…')

def main(argv):
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    once = '--once' in argv
    loop = 20
    if '--loop' in argv:
        loop = int(argv[argv.index('--loop') + 1])
    if once:
        tick()
        return
    print(f"Диспетчер запущен с Jev (System 1). Цикл: {loop}s")
    while _running:
        tick()
        for _ in range(loop):
            if not _running:
                break
            time.sleep(1)

if __name__ == '__main__':
    main(sys.argv[1:])
