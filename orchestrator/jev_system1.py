#!/usr/bin/env python3
"""Jev: System 1 (TypeSafe) детерминированный триаж и гейткипер задач.

Работает через серверный шлюз Antigravity (Gemini Flash) в строгом режиме
генерации JSON-схем без текста и свободных рассуждений (0% галлюцинаций, 1 токен на решение).
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error

ENDPOINT = os.getenv('JEV_ENDPOINT', 'https://ag.omni.mice.zone/v1/chat/completions')
API_KEY = os.getenv('ANTIGRAVITY_FATHER_API_KEY', '')
COSTS_DB = os.path.expanduser('~/.hermes/logs/costs.db')

# Модель Jev. Gemini на этом шлюзе отбивается геоблоком апстрима
# («User location is not supported»), Claude проходит. Haiku — быстрый и дешёвый,
# для типизированных решений этого достаточно.
JEV_MODEL = os.getenv('JEV_MODEL', 'claude-haiku-4')


def _log_usage(role, task_id, model, usage, latency_ms):
    """Пишет расход Jev в costs.db. Ошибки логирования не должны ронять конвейер."""
    if not usage:
        return
    try:
        conn = sqlite3.connect(COSTS_DB, timeout=5)
        conn.execute(
            'INSERT INTO jev_usage (ts, date, role, task_id, model, '
            'input_tokens, output_tokens, total_tokens, latency_ms) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                time.strftime('%Y-%m-%d %H:%M:%S'),
                time.strftime('%Y-%m-%d'),
                role,
                str(task_id) if task_id else None,
                model,
                usage.get('prompt_tokens', 0) or 0,
                usage.get('completion_tokens', 0) or 0,
                usage.get('total_tokens', 0) or 0,
                latency_ms,
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f'  [Jev usage] не записалось: {e}', file=sys.stderr)


def _parse_json_loose(text):
    """Достаёт JSON из ответа модели, терпимо к обёрткам и мусору.

    Клод часто оборачивает в ```json, добавляет пояснения до/после или
    оставляет висячие запятые. Для декомпозиции нам нужен устойчивый разбор:
    иначе один лишний символ рушит всю задачу.
    """
    if not text:
        return None
    t = text.strip()
    if t.startswith('```'):
        parts = t.split('```')
        if len(parts) >= 2:
            t = parts[1]
            if t.lstrip().startswith('json'):
                t = t.lstrip()[4:]
    t = t.strip()
    # берём от первой { до последней } — отсекаем пояснения вокруг
    i, j = t.find('{'), t.rfind('}')
    if i != -1 and j != -1 and j > i:
        t = t[i:j + 1]
    # висячие запятые перед } и ]
    import re as _re
    t = _re.sub(r',\s*([}\]])', r'\1', t)
    try:
        return json.loads(t)
    except Exception:
        return None


def _call_jev(role, task_id, system_prompt, user_prompt, timeout=15, max_tokens=400):
    """Единая точка вызова System 1 через шлюз Antigravity с учётом расхода."""
    key = _get_api_key()
    if not key:
        return None, 'нет ключа шлюза'

    payload = {
        "model": JEV_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.0,
        "max_tokens": max_tokens,
    }
    started = time.time()
    try:
        req = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        latency = int((time.time() - started) * 1000)

        _log_usage(role, task_id, data.get('model', JEV_MODEL),
                   data.get('usage'), latency)

        content = data["choices"][0]["message"]["content"]
        parsed = _parse_json_loose(content)
        if parsed is None:
            return None, f'не разобран JSON: {content[:120]}'
        return parsed, None
    except Exception as e:
        return None, str(e)


def _get_api_key():
    global API_KEY
    if API_KEY:
        return API_KEY
    config_path = os.path.expanduser('~/.hermes/profiles/papa/config.yaml')
    if os.path.exists(config_path):
        with open(config_path) as f:
            for line in f:
                if 'api_key:' in line:
                    API_KEY = line.split(':', 1)[1].strip().strip('"').strip("'")
                    return API_KEY
    return ''

def triage_task(task, available_workers):
    """Выполняет входной триаж задачи: выбор воркера, репозитория и роли через System 1."""
    key = _get_api_key()
    if not key:
        return None

    workers_info = [
        {"id": w["id"], "name": w.get("name"), "role": w.get("role"), "model": w.get("model")}
        for w in available_workers if w.get("id") != "w0" and w.get("status") in ("wait", "done") and not w.get("task")
    ]
    if not workers_info:
        return None

    system_prompt = (
        "You are Jev, a strict System 1 dispatcher. Choose the optimal worker and repository for the incoming task. "
        "Allowed repositories: 'cms_teach' (for Karkas CMS, engine, storefront, admin-api) or 'prompt-hospital' (for orchestrator office). "
        "IMPORTANT worker constraint: Claude Code (model 'claude-code') refuses tasks that mention "
        "infrastructure/network keywords (Traefik, nginx, middleware, proxy, Docker, firewall, TLS, DNS, "
        "deploy, rollout, weights) — its provider safety filter blocks them and the run fails. "
        "Such infrastructure tasks MUST go to Codex (model 'codex'), never to Claude Code. "
        "Claude Code is for code, UI, layout, refactoring, docs. Codex is for infra, scripts, tests, audits. "
        "Respond strictly with raw JSON matching this schema: "
        '{"worker_id": string, "repo": "cms_teach"|"prompt-hospital", "confidence": float, '
        '"requires_review": boolean, "reason": string}'
    )
    user_prompt = f"Task: {task.get('title')}\nKind: {task.get('kind')}\nAvailable workers:\n{json.dumps(workers_info, ensure_ascii=False)}"

    decision, err = _call_jev('triage', task.get('id'), system_prompt, user_prompt, timeout=10)
    if err:
        print(f"  [Jev] Ошибка триажа: {err}", file=sys.stderr)
    return decision

if __name__ == '__main__':
    # Тест автономного вызова
    task = {"id": "T-TEST", "title": "#517: /llms.txt генерация движком", "kind": "фулстак"}
    workers = [
        {"id": "w1", "name": "Claude Code", "role": "фулстак", "model": "claude", "status": "done"},
        {"id": "w2", "name": "Codex", "role": "фулстак", "model": "codex", "status": "wait"},
        {"id": "w18", "name": "Gemini Design", "role": "дизайнер", "model": "gemini", "status": "done"}
    ]
    decision = triage_task(task, workers)
    print("Результат Jev:", decision)


def gatekeeper_review(task, worker_name, exec_output, exit_ok):
    """Jev как ГЕЙТКИПЕР (System 1): проверяет результат перед закрытием задачи.

    Возвращает типизированное решение:
      verdict: 'approve' | 'reject' | 'escalate_to_human'
      tests_passed: bool
      spec_compliant: bool
      reason: str
    """
    key = _get_api_key()
    if not key:
        return {"verdict": "escalate_to_human", "tests_passed": False,
                "spec_compliant": False, "reason": "нет ключа шлюза"}

    system_prompt = (
        "You are Jev, a strict System 1 gatekeeper for a software task pipeline. "
        "You decide whether a worker's result may close the task. "
        "Judge only on evidence given. Be conservative: incomplete or off-scope work must NOT be approved. "
        "Respond strictly with raw JSON matching: "
        '{"verdict": "approve"|"reject"|"escalate_to_human", '
        '"tests_passed": boolean, "spec_compliant": boolean, "reason": string}'
    )
    user_prompt = (
        f"Task title: {task.get('title')}\n"
        f"Task kind: {task.get('kind')}\n"
        f"Worker: {worker_name}\n"
        f"Process exit ok: {exit_ok}\n"
        f"Worker output tail:\n{(exec_output or '')[-1500:]}\n\n"
        "Rules: approve only if exit ok AND the output shows actual work matching the task title "
        "AND (tests were run and passed, or the task is non-testable and the change is evidently complete). "
        "If output mentions errors, refused output, wrong directory, missing evidence of work, or scope mismatch → reject. "
        "If ambiguous but plausibly done → escalate_to_human."
    )

    # max_tokens=1500: вердикт — это JSON с полями verdict/tests_passed/spec_compliant
    # и обоснованием. На дефолтных 400 токенах ответ обрывался ровно на 400 (упор в
    # потолок), гейткипер не мог вынести решение и жёг токены впустую.
    verdict, err = _call_jev('gatekeeper', task.get('id'), system_prompt, user_prompt,
                             timeout=40, max_tokens=1500)
    if err:
        print(f"  [Jev gatekeeper] ошибка: {err}", file=sys.stderr)
        return {"verdict": "escalate_to_human", "tests_passed": False,
                "spec_compliant": False, "reason": err}
    return verdict


# Классы падений раскатки — собраны из реальных `die` в deploy/rollout.sh,
# wait-health.sh, traefik-file-gate.sh. Один класс = один вид решения.
ROLLOUT_FAILURES = [
    "git_head_mismatch",       # HEAD ≠ ожидаемый коммит: зеркало отстало
    "registry_missing",        # носителя нет в реестре флота / реестр не прочитан
    "carrier_excluded",        # носитель исключён в реестре
    "compose_missing",         # compose объявлен, но не передан / не найден
    "entrypoint_stale",        # устаревший entrypoint
    "stamp_mismatch",          # конфигурация разошлась со Студией
    "app_dir_wrong",           # сервис поднимется не своим приложением
    "image_incomplete",        # нет сети в образе: tsx/prisma недоступны
    "migration_failed",        # миграции не применены
    "health_timeout",          # не стал healthy / не ответил на healthz
    "gitsha_stale",            # метка gitSha ≠ HEAD: деплой не доехал (кэш/зеркало)
    "preset_missing",          # после сида нет presetHash: тема не применилась
    "theme_package_missing",   # файла/пакета темы нет, не скопирован, не установлен
    "traefik_router_missing",  # контейнер здоров, но прокси не отдаёт (роутер не зарегистрирован)
    "agent_stale",             # engine-agent старый/не перезапустился
    "steps_incomplete",        # выполнено шагов меньше плана
    "unknown",                 # не распознано
]

DIAGNOSE_SYSTEM = (
    "You are Jev, a strict System 1 diagnostic classifier for a CMS deployment pipeline "
    "(Karkas CMS: bash rollout.sh + docker compose + Traefik + Postgres + Prisma). "
    "Given the failure output, pick exactly ONE cause class from the allowed list. "
    "Do not explain, do not write prose. Judge only on the evidence present; if evidence is "
    "insufficient to pick confidently, return 'unknown'. "
    "Also pick the operator action from: retry, fix_config, rebuild_image, check_registry, "
    "restart_agent, manual_intervention. "
    "Respond strictly with raw JSON matching: "
    '{"cause": <one of the allowed classes>, "action": <one of the actions>, '
    '"confidence": <float 0..1>, "note": <short string, max 120 chars>}'
)


def diagnose_failure(log_output, stage='rollout.sh'):
    """Jev как диагност падений раскатки (примитив Choice).

    Возвращает типизированное решение:
      cause: класс падения из ROLLOUT_FAILURES
      action: что делать оператору
      confidence: уверенность
      note: короткое пояснение
    """
    if not log_output or not log_output.strip():
        return {"cause": "unknown", "action": "manual_intervention",
                "confidence": 0.0, "note": "пустой вывод — диагностировать нечего"}

    user_prompt = (
        f"Stage: {stage}\n"
        f"Allowed cause classes:\n{', '.join(ROLLOUT_FAILURES)}\n\n"
        f"Failure output (tail):\n{log_output[-2500:]}"
    )

    result, err = _call_jev('diagnose', None, DIAGNOSE_SYSTEM, user_prompt, timeout=20)
    if err:
        print(f"  [Jev diagnose] ошибка: {err}", file=sys.stderr)
        return {"cause": "unknown", "action": "manual_intervention",
                "confidence": 0.0, "note": f"сбой вызова: {err[:100]}"}
    return result


# Роли офиса и их зоны по умолчанию: подсказка Jev при декомпозиции.
OFFICE_ROLES = {
    "фулстак": "код, верстка, рефакторинг, инфраструктура",
    "дизайнер": "визуальный язык, макеты, типографика, UX",
    "копирайтер": "тексты сайта, заголовки, описания, тон",
    "сисадмин": "серверы, деплой, Traefik, Docker, БД",
    "приёмщик": "проверка, сверка с ТЗ, тесты, аудит",
    "архитектор": "структура, инфо-архитектура, схемы данных",
}

DECOMPOSE_SYSTEM = (
    "You are Jev, a strict System 1 task decomposer for a software office. "
    "You split one big request into the MINIMUM set of subtasks and you decide the REAL dependencies between them. "
    "ABSOLUTE RULE — a dependency exists ONLY when a task literally cannot start without the other's ARTIFACT. "
    "Architecture (structure, page order, hierarchy) is consumed by IMPLEMENTATION/LAYOUT — never required by design or copywriting. "
    "DESIGN depends on the BRIEF (what product, for whom, tone) — the brief already exists in the request, so design has NO dependency on architecture. "
    "COPYWRITING depends on the BRIEF too — text is written from the request, so copywriting has NO dependency on architecture. "
    "Therefore the DEFAULT shape of a website/landing request is: "
    "architecture + design + copywriting all start TOGETHER (no dependencies between them), "
    "then implementation waits for design AND copywriting AND architecture, then deploy, then acceptance. "
    "NEVER make design or copywriting wait for architecture. NEVER build a waterfall chain out of habit. "
    "Before adding any dependency, ask: does this task physically need a FILE from that task? If not — no dependency. "
    "Zones: give each task a short zone slug (ascii, e.g. arch, design, copy, code, infra, qa). "
    "Two tasks with the SAME zone never run in parallel — give parallel tasks DIFFERENT zones. "
    "Prefer FEWER tasks: 3-6 for a normal request, never more than 8. "
    "Write task titles in Russian, each one a concrete piece of work with a visible result. "
    "If the request is so vague that you cannot tell what it consists of, do NOT guess: "
    'return {"tasks": [], "question": "<one short clarifying question to the author, in Russian>"}. '
    "Respond strictly with raw JSON matching: "
    '{"tasks": [{"key": "t1", "title": string, "role": string, "zone": string, "dependsOn": [string]}]} '
    "where dependsOn lists task KEYS (not ids) that must finish first. "
    f"Allowed roles: {', '.join(OFFICE_ROLES.keys())}."
)



def decompose_request(request, workers=None):
    """Jev как декомпозер: разбивает запрос на задачи и расставляет зависимости.

    workers — состав офиса из журнала. Передаём его Джеву, чтобы он не обходил
    ограничение «один воркер на роль» фиктивными зонами вида infra2. Роль, которой
    в офисе нет, из плана НЕ выкидывается (issue #5, T-83 без дизайна и текстов):
    задача под неё создаётся, а найм согласует владелец.
    Возвращает {'tasks': [{'key','title','role','zone','dependsOn'}]} или None.
    """
    roles_hint = '\n'.join(f"- {r}: {d}" for r, d in OFFICE_ROLES.items())

    # Состав офиса: по сколько исполнителей каждой роли сейчас доступно.
    # Пустая роль — Jev не должен ставить на неё параллельные задачи.
    staff_lines = []
    if workers:
        counts = {}
        idle = {}
        for w in workers:
            if w.get('id') == 'w0':
                continue  # координатор исполнителем не является
            role = (w.get('role') or '').strip()
            if not role:
                continue
            counts[role] = counts.get(role, 0) + 1
            busy = bool(w.get('task'))
            idle[role] = idle.get(role, 0) + (0 if busy else 1)
        for role in sorted(counts):
            names = ', '.join(w['name'] for w in workers
                              if (w.get('role') or '').strip() == role and w.get('id') != 'w0')
            staff_lines.append(
                f"- {role}: всего {counts[role]}, свободно {idle.get(role, 0)} ({names})")
        missing = [r for r in OFFICE_ROLES if r not in counts]
        for r in missing:
            staff_lines.append(f"- {r}: ИСПОЛНИТЕЛЯ НЕТ (если работа этой роли нужна — всё равно "
                               f"создай задачу под неё: найм согласует владелец)")

    staff_block = ''
    if staff_lines:
        staff_block = (
            "\n\nCURRENT OFFICE STAFF (how many workers each role has now):\n"
            + '\n'.join(staff_lines)
            + "\nRULES about staff: "
              "Do NOT create more parallel tasks for a staffed role than it has FREE workers. "
              "If the work needs a role that has NO worker (e.g. design, copywriting), STILL create the task "
              "with that role — never drop it and never hand it to another role: the office will ask "
              "the owner to hire. "
              "NEVER invent a fake zone (like infra2, code2) to bypass the one-worker-per-role limit: "
              "the worker is still one, so those tasks run sequentially anyway. "
              "If the work genuinely needs two parallel tasks of the same role, say so in the task title "
              "rather than faking zones."
        )

    user_prompt = (
        f"Request from the owner:\n{request}\n\n"
        f"Office roles (use only these):\n{roles_hint}"
        f"{staff_block}\n\n"
        "Split into the minimum subtasks. Mark dependencies only where the artifact is truly required. "
        "Tasks that can start together must have DIFFERENT zones and NO dependency between them."
    )
    result, err = _call_jev('decompose', None, DECOMPOSE_SYSTEM, user_prompt,
                            timeout=40, max_tokens=2000)
    if err:
        print(f"  [Jev decompose] ошибка: {err}", file=sys.stderr)
        return None
    # _call_jev уже пытается json.loads; если не вышло — вернул None с ошибкой.
    # На этот случай достаём JSON из сырого текста терпимым разбором.
    return result


## ─────────────────────────────────────────────────────────────────────
##  Крупная ли задача: решение о декомпозиции принимает система (issue #5)
## ─────────────────────────────────────────────────────────────────────
#
# Владелец пишет замысел («создать сайт»), а не ТЗ. Явные случаи решают правила —
# детерминированно и бесплатно; Jev спрашиваем только в серой зоне.

import re as _re

# Глагол результата + продукт сразу после него: «создать сайт», «настроить интеграцию».
_BUILD_VERB = r'(?:созда|сдела|разработ|запуст|постро|настро|собра|внедр|реализ|запил|сверста|подготов)\w*'
# Префикс только через дефис («интернет-магазин»), иначе «бот» найдётся в «работа».
_PRODUCT = (r'(?:\w+-)?(?:микро|веб-?)?(?:сайт|лендинг|сервис|магазин|приложени|платформ|интеграци|'
            r'портал|кабинет|бот\b|бота\b|crm|админк|витрин|mvp|продукт)\w*')
_PREPS = {'на', 'в', 'во', 'для', 'у', 'к', 'ко', 'о', 'об', 'по', 'из', 'с', 'со', 'под',
          'над', 'при', 'от', 'до', 'за', 'про'}
_RESULT_RE = _re.compile(rf'\b{_BUILD_VERB}\s+((?:[\w-]+\s+){{0,2}}?){_PRODUCT}')
_COMPLETE_RE = _re.compile(r'довести до готовност|под ключ|с нуля|целиком|полностью|от и до')
_PRODUCT_RE = _re.compile(rf'\b{_PRODUCT}')
_LEAD_PRODUCT_RE = _re.compile(rf'^\s*(?:[\w-]+\s+)?{_PRODUCT}')

# Признаки мелкой задачи: есть конкретная точка приложения или это исправление.
_ANCHOR_RE = _re.compile(
    r'[\w./-]+\.(?:py|js|ts|tsx|jsx|vue|css|scss|html?|md|json|ya?ml|sh|sql|toml|env|txt|php)\b'
    r'|\w+\(\)|`[^`]+`|#\d+|\bстрок[аеиу]\s*\d+|(?:^|\s)/[\w.-]+')
_FIX_RE = _re.compile(r'\b(?:почин|исправ|поправ|опечат|баг|ошибк|откат|переимен)\w*')

# Виды работ. Проверка (qa) не считается: она сопровождает любую задачу.
_WORK_KINDS = {
    'arch': r'архитектур|структур[уа] сайт|схем[ауы] данн',
    'design': r'дизайн|макет|визуал|логотип|айдентик|\bui\b|\bux\b',
    'copy': r'тексты|копирайт|контент|наполнени',
    'code': r'\bкод\b|верст|бэкенд|фронтенд|backend|frontend|\bapi\b',
    'infra': r'депло|выкат|выложить|хостинг|домен|docker|\bssl\b|nginx|traefik',
}


def _norm(text):
    return str(text or '').lower().replace('ё', 'е')


def _author_notes(task):
    """Содержательные комментарии (не служебные jev) — это и есть бриф задачи."""
    return [c for c in (task.get('comments') or [])
            if str(c.get('author') or '').strip().lower() != 'jev' and str(c.get('text') or '').strip()]


def _has_result_wording(title):
    for m in _RESULT_RE.finditer(title):
        between = m.group(1).split()
        if not any(w in _PREPS for w in between):
            return True
    return bool(_COMPLETE_RE.search(title) and _PRODUCT_RE.search(title))


def _lead_product(title):
    m = _LEAD_PRODUCT_RE.match(title)
    return bool(m) and title.split()[0] not in _PREPS


SCOPE_SYSTEM = (
    "You are Jev, a strict System 1 scope classifier for a software office. "
    "Decide whether ONE request is a single piece of work for one executor, or a BIG request "
    "that needs several different kinds of work done by different roles. "
    "Small: fix, tweak, add one element, change one file/module/function. "
    "Big: the request names a RESULT (a site, a service, an integration) rather than an action, "
    "and getting there needs several kinds of work. "
    "Kinds of work: arch, design, copy, code, infra. Verification (qa) does not count. "
    "Respond strictly with raw JSON matching: "
    '{"big": boolean, "work_kinds": [string], "reason": string}'
)


def needs_decomposition(task, workers=None):
    """Нужно ли разбивать задачу на подзадачи.

    Возвращает {'decompose': bool, 'source': 'manual'|'rules'|'jev', 'reason': str}.
    Порядок: ручной флаг → часть плана → признаки мелкой → признаки крупной →
    серая зона (Jev). Ошибка Jev = «не разбивать»: задача идёт как раньше.
    """
    if task.get('decompose'):
        return {'decompose': True, 'source': 'manual', 'reason': 'флаг decompose поставлен вручную'}
    if task.get('zone') or task.get('dependsOn'):
        return {'decompose': False, 'source': 'rules',
                'reason': 'часть цепочки (есть зона или предшественники)'}

    title = _norm(task.get('title'))
    if _ANCHOR_RE.search(str(task.get('title') or '')) or _FIX_RE.search(title):
        return {'decompose': False, 'source': 'rules',
                'reason': 'конкретная правка: указан файл/функция или это исправление'}

    kinds = [k for k, rx in _WORK_KINDS.items() if _re.search(rx, title)]
    if _has_result_wording(title):
        return {'decompose': True, 'source': 'rules',
                'reason': 'формулировка про результат, а не про действие'}
    if len(kinds) >= 3:
        return {'decompose': True, 'source': 'rules',
                'reason': 'названо несколько видов работы: ' + ', '.join(kinds)}
    if len(kinds) < 2 and not _lead_product(title):
        return {'decompose': False, 'source': 'rules', 'reason': 'одно действие'}

    # Серая зона: «лендинг для акции», «дизайн и вёрстка футера».
    desc = str(task.get('description') or '').strip()
    notes = _author_notes(task)
    brief = '\n\n'.join([desc] + [str(c.get('text')) for c in notes]).strip()
    user_prompt = (f"Request title: {task.get('title')}\n"
                   f"Request details:\n{brief[:3000] or '(none — only the title)'}")
    verdict, err = _call_jev('scope', task.get('id'), SCOPE_SYSTEM, user_prompt, timeout=15)
    if err or not isinstance(verdict, dict):
        print(f"  [Jev scope] ошибка: {err}", file=sys.stderr)
        return {'decompose': False, 'source': 'jev', 'reason': f'Jev не ответил: {err}'}
    work = [k for k in (verdict.get('work_kinds') or []) if k in _WORK_KINDS]
    big = bool(verdict.get('big')) and len(set(work)) >= 2
    return {'decompose': big, 'source': 'jev',
            'reason': str(verdict.get('reason') or '')[:200] + (f" ({', '.join(work)})" if work else '')}


def sanitize_plan(plan, workers, parent_id='T'):
    """Приводит план Jev к тому, что офис может исполнить. Детерминированно.

    - не больше 8 подзадач, без пустых заголовков;
    - роль из справочника офиса (OFFICE_ROLES) сохраняется, даже если исполнителя
      этой роли нет: такая подзадача помечается hire=True — под неё диспетчер
      заводит заявку на найм, владелец решает (issue #5: роли не выкидываются молча);
    - роль вне справочника → 'фулстак' (если есть), иначе без роли (триаж выберет);
    - у каждой подзадачи есть зона (по ней подзадача не разбивается повторно);
    - dependsOn только на ключи этого плана, без ссылок на себя.
    Возвращает {'tasks': [...]} или None, если осталось меньше двух подзадач.
    """
    if not isinstance(plan, dict) or not isinstance(plan.get('tasks'), list):
        return None
    items = plan['tasks']
    present = {(w.get('role') or '').strip() for w in (workers or [])
               if w.get('id') != 'w0' and (w.get('role') or '').strip()}
    present.discard('координатор')
    fallback = 'фулстак' if 'фулстак' in present else None

    out, keys = [], set()
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        title = str(it.get('title') or '').strip()
        if not title:
            continue
        key = str(it.get('key') or f't{i + 1}')
        if key in keys:
            key = f'{key}_{i + 1}'
        keys.add(key)
        role = str(it.get('role') or '').strip()
        if role not in present and role not in OFFICE_ROLES:
            role = fallback
        item = {'key': key, 'title': title[:200], 'role': role,
                'zone': _re.sub(r'[^a-z0-9_-]', '', str(it.get('zone') or '').lower())
                        or f'{parent_id.lower()}-{key}',
                'dependsOn': [str(d) for d in (it.get('dependsOn') or [])]}
        if role and role not in present:
            item['hire'] = True
        out.append(item)
        if len(out) == 8:
            break
    for it in out:
        it['dependsOn'] = [d for d in dict.fromkeys(it['dependsOn']) if d in keys and d != it['key']]
    return {'tasks': out} if len(out) >= 2 else None
