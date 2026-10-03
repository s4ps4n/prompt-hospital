"""Крупная задача разбивается сама — без ТЗ от владельца (issue #5).

Урок T-81/T-82 (03.10.2026): «разработать сайт под продажу сайтов» без описания
ушла одному исполнителю целиком (флага decompose в форме нет) и провалилась.
Теперь решение «разбивать или нет» принимает система.

Журнал и Джев подменены: сети и живых моделей нет. FakeOffice повторяет
семантику операций журнала (journal.py на боевом), которыми пользуется диспетчер.
"""
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dispatch  # noqa: E402
import jev_system1  # noqa: E402
from jev_system1 import needs_decomposition  # noqa: E402

# Состав офиса как на боевом 03.10: дизайнера, сисадмина, архитектора нет.
WORKERS = [
    {'id': 'w0', 'name': 'Гермес', 'role': 'координатор', 'model': 'deepseek', 'task': None, 'status': 'wait'},
    {'id': 'w1', 'name': 'Claude Code', 'role': 'фулстак', 'model': 'claude-code', 'task': None, 'status': 'wait'},
    {'id': 'w3', 'name': 'Nemotron', 'role': 'приёмщик', 'model': 'nemotron-120b', 'task': None, 'status': 'wait'},
    {'id': 'w64', 'name': 'Codex', 'role': 'фулстак', 'model': 'codex', 'task': None, 'status': 'wait'},
]
OFFICE_ROLES = {'фулстак', 'приёмщик'}

# Джев-декомпозер «по привычке» ставит задачи и на роли, которых в офисе нет.
SITE_PLAN = {'tasks': [
    {'key': 't1', 'title': 'Структура сайта: страницы и разделы', 'role': 'архитектор', 'zone': 'arch', 'dependsOn': []},
    {'key': 't2', 'title': 'Макет главной и страницы пакета', 'role': 'дизайнер', 'zone': 'design', 'dependsOn': []},
    {'key': 't3', 'title': 'Вёрстка и калькулятор стоимости', 'role': 'фулстак', 'zone': 'code', 'dependsOn': ['t1', 't2']},
    {'key': 't4', 'title': 'Выкладка на сервер', 'role': 'сисадмин', 'zone': None, 'dependsOn': ['t3']},
    {'key': 't5', 'title': 'Приёмка по брифу', 'role': 'приёмщик', 'zone': 'qa', 'dependsOn': ['t4', 't9']},
]}


def task(tid, title, **over):
    t = {'id': tid, 'title': title, 'priority': 2, 'assignedTo': None, 'kind': None,
         'attempts': 0, 'dependsOn': [], 'comments': [], 'zone': None,
         'decompose': False, 'decomposed': False}
    t.update(over)
    return t


class FakeOffice:
    """Журнал в памяти: /journal и /op с той же семантикой, что у боевого journal.py."""

    def __init__(self, queue, workers=None):
        self.j = {'queue': queue, 'workers': json.loads(json.dumps(workers or WORKERS)),
                  'seq': 100}
        self.ops = []

    def find(self, tid):
        return next((t for t in self.j['queue'] if t['id'] == tid), None)

    def api(self, path, method='GET', payload=None):
        if path == '/journal':
            return json.loads(json.dumps(self.j))
        if path == '/op':
            return self.op(payload['name'], payload['args'])
        return None

    def op(self, name, args):
        self.ops.append((name, list(args)))
        if name == 'setDecomposed':
            self.find(args[0])['decomposed'] = str(args[1]).lower() == 'true'
            return {'out': 'ok'}
        if name == 'comment':
            self.find(args[0])['comments'].append({'at': '00:00', 'author': args[1], 'text': args[2]})
            return {'out': 'ok'}
        if name == 'addPlan':
            plan = json.loads(args[0])
            key_to_id, created = {}, []
            for item in plan['tasks']:
                self.j['seq'] += 1
                tid = f"T-{self.j['seq']}"
                deps = [key_to_id[k] for k in item.get('dependsOn') or [] if k in key_to_id]
                self.j['queue'].append(task(tid, item['title'], kind=item.get('role'),
                                            zone=item.get('zone'), dependsOn=deps))
                key_to_id[item['key']] = tid
                created.append(tid)
            return {'out': f'план из {len(created)} задач создан: {", ".join(created)}'}
        if name == 'assign':
            t, w = self.find(args[0]), next(w for w in self.j['workers'] if w['id'] == args[1])
            t['assignedTo'] = w['id']
            w['task'], w['status'] = t['id'], 'run'
            return {'out': 'ok'}
        return {'out': 'ok'}

    def names(self):
        return [n for n, _ in self.ops]

    def comments(self, tid):
        return [c['text'] for c in self.find(tid)['comments']]


class FakeJev:
    """Подмена jev_system1._call_jev: ответы по роли вызова, учёт вызовов."""

    def __init__(self, decompose=None, scope=None):
        self.answers = {'decompose': decompose, 'scope': scope}
        self.calls = []

    def __call__(self, role, task_id, system_prompt, user_prompt, **kw):
        self.calls.append((role, user_prompt))
        ans = self.answers.get(role)
        if isinstance(ans, Exception):
            return None, str(ans)
        if ans is None:
            return None, 'не задано в тесте'
        return json.loads(json.dumps(ans)), None

    def roles(self):
        return [r for r, _ in self.calls]


@pytest.fixture
def office(monkeypatch):
    def make(queue, decompose=None, scope=None, workers=None):
        o = FakeOffice(queue, workers)
        jev = FakeJev(decompose, scope)
        monkeypatch.setattr(dispatch, 'api', o.api)
        monkeypatch.setattr(dispatch, 'op', o.op)
        monkeypatch.setattr(jev_system1, '_call_jev', jev)
        # триаж исполнителя — не предмет теста: Джев «молчит», работает fallback
        monkeypatch.setattr(dispatch, 'triage_task', lambda t, w: None)
        dispatch._decomp_cache.clear()
        dispatch._decomp_errors.clear()
        return o, jev
    return make


# ── 1. Крупная задача: система сама ставит разбиение ─────────────────────────

def test_big_task_without_description_is_decomposed(office):
    o, jev = office([task('T-81', 'создать сайт под продажу сайтов')], decompose=SITE_PLAN)
    dispatch.auto_assign_with_jev()

    assert 'decompose' in jev.roles(), 'крупная задача должна уйти Джеву-декомпозеру'
    assert ('setDecomposed', ['T-81', 'true']) in o.ops
    plans = [json.loads(a[0]) for n, a in o.ops if n == 'addPlan']
    assert len(plans) == 1
    subs = plans[0]['tasks']
    assert len(subs) >= 2, 'план из нескольких подзадач'
    for s in subs:
        # issue #5: роль, которой в офисе нет, не выкидывается — помечена под найм
        assert s['role'] in OFFICE_ROLES or s.get('hire'), f'роль «{s["role"]}» без исполнителя и без найма'
        assert s.get('zone'), 'у подзадачи должна быть зона: она часть плана'
        assert all(d in {x['key'] for x in subs} for d in s['dependsOn'])
    # состав офиса передан Джеву
    decompose_prompt = next(p for r, p in jev.calls if r == 'decompose')
    assert 'дизайнер: ИСПОЛНИТЕЛЯ НЕТ' in decompose_prompt
    # сам замысел исполнителю целиком НЕ уходит
    assert ('assign', ['T-81', 'w1']) not in o.ops
    assert o.find('T-81')['assignedTo'] is None
    assert any('разбито на' in c for c in o.comments('T-81'))


def test_subtasks_get_parent_brief_and_are_not_redecomposed(office):
    brief = '# Бриф\nПакеты, калькулятор, заявки. БРИФ-МАРКЕР-55aa'
    o, jev = office([task('T-82', 'Сайт студии по продаже сайтов: довести до готовности',
                          comments=[{'at': '1', 'author': 'координатор', 'text': brief}])],
                    decompose=SITE_PLAN)
    dispatch.auto_assign_with_jev()
    decompose_prompt = next(p for r, p in jev.calls if r == 'decompose')
    assert 'БРИФ-МАРКЕР-55aa' in decompose_prompt, 'Джев разбивает по всему брифу, не по заголовку'

    subs = [t for t in o.j['queue'] if t['id'] != 'T-82']
    assert subs
    for s in subs:
        assert any('T-82' in c and 'БРИФ-МАРКЕР-55aa' in c for c in o.comments(s['id'])), \
            'подзадача должна нести бриф родителя'

    # следующие тики: подзадачи идут исполнителям, повторно не разбиваются
    n_plans = o.names().count('addPlan')
    for _ in range(4):
        dispatch.auto_assign_with_jev()
        for w in o.j['workers']:     # исполнители «доделали» задачи
            if w['task']:
                o.j['queue'] = [t for t in o.j['queue'] if t['id'] != w['task']]
                w['task'], w['status'] = None, 'done'
    assert o.names().count('addPlan') == n_plans
    assert jev.roles().count('decompose') == 1
    assert o.find('T-82')['assignedTo'] is None, 'родитель-замысел исполнителю не уходит'


# ── 2. Мелкая задача: одним исполнителем, без разбиения ──────────────────────

def test_small_task_goes_to_one_executor(office):
    o, jev = office([task('T-90', 'починить опечатку в заголовке')], decompose=SITE_PLAN)
    dispatch.auto_assign_with_jev()

    assert 'decompose' not in jev.roles()
    assert 'setDecomposed' not in o.names() and 'addPlan' not in o.names()
    assert o.find('T-90')['assignedTo'] in ('w1', 'w64')


# ── 3. Разбить нельзя: вопрос автору, без назначения ─────────────────────────

def test_unclear_task_gets_question_and_stays_unassigned(office):
    q = 'Что именно должен уметь сервис и для кого он?'
    o, jev = office([task('T-91', 'сделать сервис')], decompose={'tasks': [], 'question': q})
    dispatch.auto_assign_with_jev()

    assert 'addPlan' not in o.names()
    assert o.find('T-91')['assignedTo'] is None
    assert 'assign' not in o.names()
    asked = [c for c in o.comments('T-91') if q in c]
    assert len(asked) == 1, 'автору задан вопрос'

    # пока автор не ответил — ни повторного вопроса, ни Джева, ни исполнителя
    calls = len(jev.calls)
    dispatch._decomp_cache.clear()           # как после перезапуска службы
    dispatch.auto_assign_with_jev()
    dispatch.auto_assign_with_jev()
    assert len(jev.calls) == calls
    assert len([c for c in o.comments('T-91') if q in c]) == 1
    assert 'assign' not in o.names()

    # автор ответил — разбиваем заново, уже с ответом
    o.find('T-91')['comments'].append({'at': '2', 'author': 'координатор',
                                       'text': 'Сервис записи клиентов на стрижку: сайт + бот.'})
    jev.answers['decompose'] = SITE_PLAN
    dispatch.auto_assign_with_jev()
    assert 'addPlan' in o.names()
    assert 'записи клиентов на стрижку' in [p for r, p in jev.calls if r == 'decompose'][-1]


def test_empty_plan_without_question_also_asks(office):
    o, _ = office([task('T-92', 'создать платформу')], decompose={'tasks': []})
    dispatch.auto_assign_with_jev()
    assert o.find('T-92')['assignedTo'] is None
    assert any(dispatch.DECOMPOSE_ASK_MARK in c for c in o.comments('T-92'))


def test_jev_down_holds_big_task_instead_of_blind_run(office):
    o, _ = office([task('T-93', 'создать сайт под продажу сайтов')],
                  decompose=RuntimeError('timeout'))
    dispatch.auto_assign_with_jev()
    assert 'assign' not in o.names()
    assert 'addPlan' not in o.names()
    assert o.find('T-93')['decomposed'] is False, 'флаг откатан: следующий тик повторит'


# ── Ручной путь сохранён ─────────────────────────────────────────────────────

def test_manual_flag_still_decomposes_even_small_wording(office):
    o, jev = office([task('T-94', 'добавить кнопку «Заказать»', decompose=True)],
                    decompose=SITE_PLAN)
    dispatch.auto_assign_with_jev()
    assert 'addPlan' in o.names()
    assert 'scope' not in jev.roles(), 'ручной флаг не перепроверяется'


def test_single_task_plan_runs_as_is(office):
    one = {'tasks': [{'key': 't1', 'title': 'Сделать всё', 'role': 'фулстак',
                      'zone': 'code', 'dependsOn': []}]}
    o, _ = office([task('T-95', 'создать сайт-визитку', decompose=True)], decompose=one)
    dispatch.auto_assign_with_jev()
    assert 'addPlan' not in o.names()
    dispatch.auto_assign_with_jev()
    assert o.find('T-95')['assignedTo'] in ('w1', 'w64')


# ── 4. Не плодить: роли из офиса, мелочь не в цепочки ────────────────────────

def test_plan_with_absent_roles_keeps_them_for_hire(office):
    # Было: отсутствующие роли молча становились «фулстак» — так T-83 потеряла
    # дизайн и тексты. Теперь роль из плана остаётся, под неё — заявка на найм.
    only_fullstack = [w for w in WORKERS if w['id'] in ('w0', 'w1')]
    o, _ = office([task('T-96', 'создать сайт под продажу сайтов')],
                  decompose=SITE_PLAN, workers=only_fullstack)
    dispatch.auto_assign_with_jev()
    subs = json.loads(next(a[0] for n, a in o.ops if n == 'addPlan'))['tasks']
    assert [s['role'] for s in subs] == [s['role'] for s in SITE_PLAN['tasks']]
    assert {s['role'] for s in subs if s.get('hire')} == {'архитектор', 'дизайнер', 'сисадмин', 'приёмщик'}
    requested = {json.loads(a[0])['role'] for n, a in o.ops if n == 'staffRequest'}
    assert requested == {'архитектор', 'дизайнер', 'сисадмин', 'приёмщик'}
    assert len(subs) <= 8


@pytest.mark.parametrize('title', [
    'создать сайт под продажу сайтов',
    'сделать сервис записи клиентов',
    'настроить интеграцию с Битрикс24',
    'Сайт студии по продаже сайтов: довести до готовности',
    'разработать интернет-магазин',
    'дизайн, вёрстка и деплой лендинга',
])
def test_rules_big(title, monkeypatch):
    jev = FakeJev()
    monkeypatch.setattr(jev_system1, '_call_jev', jev)
    d = needs_decomposition(task('T-1', title), WORKERS)
    assert d['decompose'] is True, d
    assert jev.calls == [], 'явный случай решается правилами, без модели'


@pytest.mark.parametrize('title', [
    'починить опечатку в заголовке',
    'добавить кнопку',
    'сделать кнопку на сайте синей',
    'исправить ошибку в калькуляторе стоимости сайта',
    'обновить dispatch.py: таймаут Джева 40 с',
    '#517: /llms.txt генерация движком',
    'переименовать функцию build_task_prompt()',
    'проверить деплой',
])
def test_rules_small(title, monkeypatch):
    jev = FakeJev(scope={'big': True, 'work_kinds': ['design', 'code'], 'reason': 'x'})
    monkeypatch.setattr(jev_system1, '_call_jev', jev)
    d = needs_decomposition(task('T-1', title), WORKERS)
    assert d['decompose'] is False, d


def test_plan_subtask_is_never_auto_decomposed(monkeypatch):
    jev = FakeJev(scope={'big': True, 'work_kinds': ['design', 'code'], 'reason': 'x'})
    monkeypatch.setattr(jev_system1, '_call_jev', jev)
    sub = task('T-2', 'Сверстать сайт целиком', kind='фулстак', zone='code')
    assert needs_decomposition(sub, WORKERS)['decompose'] is False
    sub = task('T-3', 'Запустить сайт', kind='фулстак', dependsOn=['T-2'])
    assert needs_decomposition(sub, WORKERS)['decompose'] is False
    assert jev.calls == []


def test_gray_zone_asks_jev_and_needs_two_kinds_of_work(monkeypatch):
    t = task('T-4', 'лендинг для осенней акции')
    jev = FakeJev(scope={'big': True, 'work_kinds': ['design', 'code', 'copy'], 'reason': 'макет+тексты+вёрстка'})
    monkeypatch.setattr(jev_system1, '_call_jev', jev)
    assert needs_decomposition(t, WORKERS)['decompose'] is True
    assert jev.roles() == ['scope']

    jev = FakeJev(scope={'big': True, 'work_kinds': ['code'], 'reason': 'один вид работы'})
    monkeypatch.setattr(jev_system1, '_call_jev', jev)
    assert needs_decomposition(t, WORKERS)['decompose'] is False

    jev = FakeJev(scope=RuntimeError('нет сети'))
    monkeypatch.setattr(jev_system1, '_call_jev', jev)
    assert needs_decomposition(t, WORKERS)['decompose'] is False, 'без Джева — как раньше, одной задачей'
