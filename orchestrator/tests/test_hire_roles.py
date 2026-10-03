"""Декомпозиция не выкидывает роли молча: нужна роль — заявка на найм (issue #5).

Живой результат 03.10.2026: T-83 «нужно сделать сайт для доставки суши» разбилась
на водопад архитектура → вёрстка → деплой → приёмка БЕЗ дизайна и текстов:
дизайнера и копирайтера в офисе нет, и Джеву прямо велели не создавать под них
задачи. Требование владельца: «Это роли, он должен согласовать со мной найм».

Теперь: задача под отсутствующую роль создаётся и видна в очереди, на роль
заводится staffRequest, исполнителю задача не уходит до решения владельца.
Отказ — задача не пропадает: идёт осознанно без роли или останавливается.

Диспетчер работает поверх НАСТОЯЩЕГО journal.py (журнал в памяти, без файла),
Джев подменён: сети и живых моделей нет.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dispatch  # noqa: E402
import jev_system1  # noqa: E402
import journal  # noqa: E402
from jev_system1 import sanitize_plan  # noqa: E402


def _w(wid, name, role, model='m'):
    return {'id': wid, 'model': model, 'name': name, 'provider': 'p', 'role': role,
            'status': 'wait', 'task': None, 'doneCount': 0, 'history': []}


# Состав офиса как на боевом 03.10: фулстаки и приёмщик; дизайнера и копирайтера нет.
COORD = _w('w0', 'Гермес', 'координатор', 'deepseek')
FULL1 = _w('w1', 'Claude Code', 'фулстак', 'claude-code')
QA = _w('w3', 'Nemotron', 'приёмщик', 'nemotron-120b')
FULL2 = _w('w64', 'Codex', 'фулстак', 'codex')
ARCH = _w('w70', 'Архитектор', 'архитектор', 'claude-sonnet-4-5')
PROD = [COORD, FULL1, QA, FULL2]

# План сайта в форме, которую требует DECOMPOSE_SYSTEM: архитектура, дизайн и
# тексты стартуют вместе (зависят только от брифа), вёрстка ждёт все три.
SITE_PLAN = {'tasks': [
    {'key': 't1', 'title': 'Структура сайта доставки суши: страницы, меню, корзина',
     'role': 'архитектор', 'zone': 'arch', 'dependsOn': []},
    {'key': 't2', 'title': 'Макеты главной, меню и корзины', 'role': 'дизайнер',
     'zone': 'design', 'dependsOn': []},
    {'key': 't3', 'title': 'Тексты: главная, о доставке, описания сетов', 'role': 'копирайтер',
     'zone': 'copy', 'dependsOn': []},
    {'key': 't4', 'title': 'Вёрстка сайта по макетам и текстам', 'role': 'фулстак',
     'zone': 'code', 'dependsOn': ['t1', 't2', 't3']},
    {'key': 't5', 'title': 'Приёмка по брифу', 'role': 'приёмщик', 'zone': 'qa',
     'dependsOn': ['t4']},
]}


class Office:
    """/journal и /op поверх настоящего journal.dispatch — та же семантика, что на боевом."""

    def __init__(self, monkeypatch, queue, workers):
        monkeypatch.setattr(journal, 'save', lambda j: None)
        self.j = {'workers': json.loads(json.dumps(workers)), 'queue': queue, 'log': [],
                  'seq': 100, 'workerSeq': 100, 'staffRequests': [], 'archive': []}
        self.ops = []

    def api(self, path, method='GET', payload=None):
        if path == '/journal':
            return json.loads(json.dumps(self.j))
        if path == '/op':
            return self.op(payload['name'], payload['args'])
        return None

    def op(self, name, args):
        args = [str(a) for a in args]
        self.ops.append((name, args))
        return {'ok': True, 'out': journal.dispatch(self.j, [name] + args)}

    # — помощники теста —
    def find(self, tid):
        return next((t for t in self.j['queue'] if t['id'] == tid), None)

    def by_title(self, part):
        return next(t for t in self.j['queue'] if part in t['title'])

    def requests(self, tid=None):
        return [r for r in self.j['staffRequests'] if tid is None or r['task'] == tid]

    def assigned(self, tid):
        return any(n == 'assign' and a[0] == tid for n, a in self.ops)

    def comments(self, tid):
        return [c['text'] for c in self.find(tid)['comments']]

    def decide(self, sr_id, decision):
        journal.dispatch(self.j, ['staffDecision', sr_id, decision])

    def hire(self, w):
        self.j['workers'].append(json.loads(json.dumps(w)))

    def finish(self, tid):
        """Исполнитель доделал задачу: как complete в журнале."""
        w = next(w for w in self.j['workers'] if w['task'] == tid)
        journal.dispatch(self.j, ['complete', w['id']])


class FakeJev:
    def __init__(self, decompose):
        self.decompose = decompose
        self.calls = []

    def __call__(self, role, task_id, system_prompt, user_prompt, **kw):
        self.calls.append((role, system_prompt, user_prompt))
        if role == 'decompose':
            return json.loads(json.dumps(self.decompose)), None
        return None, 'не задано в тесте'


@pytest.fixture
def office(monkeypatch):
    def make(queue, workers=PROD, plan=SITE_PLAN):
        o = Office(monkeypatch, queue, workers)
        jev = FakeJev(plan)
        monkeypatch.setattr(dispatch, 'api', o.api)
        monkeypatch.setattr(dispatch, 'op', o.op)
        monkeypatch.setattr(jev_system1, '_call_jev', jev)
        monkeypatch.setattr(dispatch, 'triage_task', lambda t, w: None)
        dispatch._decomp_cache.clear()
        dispatch._decomp_errors.clear()
        return o, jev
    return make


def site_request(tid='T-83'):
    return {'id': tid, 'title': 'нужно сделать сайт для доставки суши', 'priority': 2,
            'order': 83, 'assignedTo': None, 'kind': None, 'attempts': 0, 'dependsOn': [],
            'comments': [], 'zone': None, 'decompose': False, 'decomposed': False}


# ── Промпт и план: роли не выкидываются ──────────────────────────────────────

def test_decompose_prompt_does_not_forbid_missing_roles(office):
    o, jev = office([site_request()])
    dispatch.auto_assign_with_jev()
    _, system, user = next(c for c in jev.calls if c[0] == 'decompose')
    assert 'не создавай задачи' not in user, 'Джеву больше не велят выкидывать роль'
    assert 'копирайтер' in system, 'копирайтер — разрешённая роль плана'
    assert 'дизайнер: ИСПОЛНИТЕЛЯ НЕТ' in user, 'состав офиса Джев видит честно'
    assert 'найм' in user


def test_sanitize_keeps_missing_known_role_and_flags_hire():
    plan = sanitize_plan(SITE_PLAN, PROD, 'T-83')
    roles = {t['key']: t['role'] for t in plan['tasks']}
    assert roles == {'t1': 'архитектор', 't2': 'дизайнер', 't3': 'копирайтер',
                     't4': 'фулстак', 't5': 'приёмщик'}
    hire = {t['key'] for t in plan['tasks'] if t.get('hire')}
    assert hire == {'t1', 't2', 't3'}, 'отсутствующие роли помечены под найм'


def test_sanitize_unknown_role_still_falls_back():
    plan = sanitize_plan({'tasks': [
        {'key': 't1', 'title': 'Продвижение в соцсетях', 'role': 'маркетолог', 'zone': 'smm'},
        {'key': 't2', 'title': 'Вёрстка', 'role': 'фулстак', 'zone': 'code'},
    ]}, PROD, 'T-1')
    assert plan['tasks'][0]['role'] == 'фулстак', 'роли вне справочника не выдумываем'
    assert not plan['tasks'][0].get('hire')


# ── Отсутствующая роль: задача есть, заявка есть, исполнителю не уходит ──────

def test_missing_role_creates_task_and_staff_request(office):
    o, _ = office([site_request()])
    dispatch.auto_assign_with_jev()

    design = o.by_title('Макеты')
    copy = o.by_title('Тексты')
    assert design['kind'] == 'дизайнер', 'задача на дизайн создана и видна в очереди'
    assert copy['kind'] == 'копирайтер'

    for t, role in ((design, 'дизайнер'), (copy, 'копирайтер')):
        reqs = o.requests(t['id'])
        assert len(reqs) == 1, f'заявка на найм «{role}» под {t["id"]}'
        r = reqs[0]
        assert r['role'] == role and r['status'] == 'pending'
        assert r['suggested'], 'предложена модель'
        assert t['title'][:20] in r['reason'] or 'T-83' in r['reason'], 'обоснование: для чего роль'
        assert any(r['id'] in c for c in o.comments(t['id'])), 'в задаче видно, что ждёт найма'

    # Замысел говорит владельцу, что план ждёт решения по найму.
    assert any('найм' in c for c in o.comments('T-83'))


def test_hire_pending_task_never_goes_to_executor(office):
    o, _ = office([site_request()])
    for _ in range(4):
        dispatch.auto_assign_with_jev()
    design = o.by_title('Макеты')
    assert not o.assigned(design['id']), 'пока владелец не решил — исполнителю не уходит'
    assert design['assignedTo'] is None
    assert len(o.requests(design['id'])) == 1, 'заявка не дублируется по тикам'


def test_other_subtasks_start_while_hire_is_pending(office):
    o, _ = office([site_request()], workers=PROD + [ARCH])
    dispatch.auto_assign_with_jev()
    arch = o.by_title('Структура')
    assert arch['assignedTo'] == 'w70', 'архитектура стартует, не дожидаясь найма дизайнера'
    assert not o.requests(arch['id'])
    assert not o.assigned(o.by_title('Макеты')['id'])


def test_manual_task_with_missing_role_also_waits_for_owner(office):
    t = site_request('T-50')
    t.update(title='Нарисовать иконки для меню', kind='дизайнер')
    o, _ = office([t])
    dispatch.auto_assign_with_jev()
    assert not o.assigned('T-50'), 'дизайн не уходит фулстаку наугад'
    assert [r['role'] for r in o.requests('T-50')] == ['дизайнер']


# ── Решение владельца ────────────────────────────────────────────────────────

def test_hired_role_gets_its_task(office):
    o, _ = office([site_request()])
    dispatch.auto_assign_with_jev()
    design = o.by_title('Макеты')
    sr = o.requests(design['id'])[0]['id']

    o.decide(sr, 'hired')
    dispatch.auto_assign_with_jev()
    assert not o.assigned(design['id']), 'наём одобрен, но исполнителя ещё нет — ждём'

    o.hire(_w('w80', 'Gemini Design', 'дизайнер'))
    dispatch.auto_assign_with_jev()
    assert o.find(design['id'])['assignedTo'] == 'w80'


def test_declined_role_task_does_not_vanish(office):
    o, _ = office([site_request()])
    dispatch.auto_assign_with_jev()
    copy = o.by_title('Тексты')
    sr = o.requests(copy['id'])[0]['id']

    o.decide(sr, 'declined')
    dispatch.auto_assign_with_jev()
    dispatch.auto_assign_with_jev()

    t = o.find(copy['id'])
    assert t is not None, 'после отказа задача остаётся в очереди'
    notes = [c for c in o.comments(copy['id']) if 'отказ' in c]
    assert len(notes) == 1, 'отказ отмечен в задаче один раз'
    assert 'копирайтер' in notes[0]
    # осознанно идёт без профильной роли — силами офиса
    assert t['kind'] == 'фулстак'
    assert t['assignedTo'] in ('w1', 'w64')


def test_declined_without_fallback_stops_visibly(office):
    o, _ = office([site_request()], workers=[COORD, QA])
    dispatch.auto_assign_with_jev()
    copy = o.by_title('Тексты')
    o.decide(o.requests(copy['id'])[0]['id'], 'declined')
    for _ in range(3):
        dispatch.auto_assign_with_jev()
    t = o.find(copy['id'])
    assert t is not None and t['assignedTo'] is None
    stops = [c for c in o.comments(copy['id']) if 'отказ' in c]
    assert len(stops) == 1 and 'остановлена' in stops[0]


# ── Параллель: arch/design/copy вместе, вёрстка ждёт все три ────────────────

def test_site_plan_runs_arch_design_copy_in_parallel(office):
    o, _ = office([site_request()], workers=PROD + [ARCH])
    dispatch.auto_assign_with_jev()

    arch, design, copy = o.by_title('Структура'), o.by_title('Макеты'), o.by_title('Тексты')
    code = o.by_title('Вёрстка')
    first = (arch, design, copy)
    assert {t['zone'] for t in first} == {'arch', 'design', 'copy'}
    assert all(t['dependsOn'] == [] for t in first), 'первая волна зависит только от брифа'
    assert sorted(code['dependsOn']) == sorted(t['id'] for t in first), \
        'вёрстка ждёт архитектуру, дизайн и тексты'

    # все нужные исполнители есть — первая волна стартует одновременно
    o.hire(_w('w80', 'Gemini Design', 'дизайнер'))
    o.hire(_w('w81', 'Копирайтер', 'копирайтер'))
    for r in o.requests():
        o.decide(r['id'], 'hired')
    dispatch.auto_assign_with_jev()
    assert {o.find(t['id'])['assignedTo'] for t in first} == {'w70', 'w80', 'w81'}
    assert o.find(code['id'])['assignedTo'] is None, 'вёрстка ещё ждёт'

    for t in first:
        o.finish(t['id'])
    dispatch.auto_assign_with_jev()
    assert o.find(code['id'])['assignedTo'] in ('w1', 'w64')
