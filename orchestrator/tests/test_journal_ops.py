"""Операции над задачами в журнале (issue #4).

Живой результат 03.10.2026: в офисе накопилось 10 задач, убрать их было нечем —
только ручной правкой journal.json (скрипт вне journal.py дважды терял воркеров).
Теперь у журнала есть removeTask, unblockTask, setTaskRole, а причина возврата
при failAttempt всегда видна в треде задачи.

Проверяем через CLI journal.py (как его зовёт server.py) на временном журнале.
"""
import io
import json
import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dispatch  # noqa: E402
import journal  # noqa: E402


def _task(tid, **over):
    t = {'id': tid, 'title': f'задача {tid}', 'priority': 2, 'order': int(tid[2:]),
         'assignedTo': None, 'kind': 'фулстак', 'attempts': 0, 'dependsOn': [],
         'comments': [], 'zone': None, 'decompose': False, 'decomposed': False}
    t.update(over)
    return t


def _worker(wid, role='фулстак', **over):
    w = {'id': wid, 'model': 'm', 'name': f'Воркер {wid}', 'provider': 'p', 'role': role,
         'status': 'wait', 'task': None, 'doneCount': 0, 'history': []}
    w.update(over)
    return w


@pytest.fixture
def jfile(tmp_path, monkeypatch):
    """Временный journal.json; journal.py работает с ним вместо боевого."""
    path = tmp_path / 'journal.json'
    monkeypatch.setattr(journal, 'J', path)
    monkeypatch.setattr(journal, 'LOCK', tmp_path / 'journal.json.lock')

    def make(queue, workers=None, **extra):
        j = {'workers': [_worker('w0', 'координатор')] + (workers or []), 'queue': queue,
             'log': [], 'seq': 100, 'workerSeq': 10, 'staffRequests': [], 'archive': []}
        j.update(extra)
        path.write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
        return path
    return make


def cli(*argv):
    return journal.main([str(a) for a in argv])


def state():
    return journal.load()


def find(j, tid):
    return next((t for t in j['queue'] if t['id'] == tid), None)


def worker(j, wid):
    return next(w for w in j['workers'] if w['id'] == wid)


# ── removeTask ───────────────────────────────────────────────────────────────

def test_remove_task_frees_worker_and_archives(jfile):
    jfile([_task('T-5', assignedTo='w1'), _task('T-6', dependsOn=['T-5'])],
          [_worker('w1', task='T-5', status='run')])
    out = cli('removeTask', 'T-5', 'тестовая, дубль T-4')
    assert 'T-5' in out

    j = state()
    assert find(j, 'T-5') is None, 'задача ушла из очереди'
    w1 = worker(j, 'w1')
    assert w1['task'] is None and w1['status'] == 'wait', 'воркер не остался занят'

    arch = [t for t in j['archive'] if t['id'] == 'T-5']
    assert len(arch) == 1
    assert arch[0]['archivedReason'] == 'тестовая, дубль T-4'
    assert arch[0]['archivedAt']
    assert arch[0]['title'] == 'задача T-5', 'в архиве задача целиком'

    assert j['log'][0]['op'] == 'removeTask'
    assert j['log'][0]['args']['task'] == 'T-5'

    # зависимая задача не ждёт снятую вечно и не стартует молча: связь снята с пометкой
    t6 = find(j, 'T-6')
    assert 'T-5' not in t6['dependsOn']
    assert any('T-5' in c['text'] for c in t6['comments'])


def test_remove_task_without_reason_still_archived(jfile):
    jfile([_task('T-7')])
    cli('remove-task', 'T-7')
    j = state()
    assert find(j, 'T-7') is None
    assert [t['id'] for t in j['archive']] == ['T-7']
    assert j['archive'][0]['archivedReason']


def test_remove_unknown_task_changes_nothing(jfile):
    jfile([_task('T-8')], [_worker('w1')])
    out = cli('removeTask', 'T-999')
    assert 'нет задачи' in out
    j = state()
    assert [t['id'] for t in j['queue']] == ['T-8']
    assert j['archive'] == []


def test_remove_task_closes_its_pending_staff_request(jfile):
    sr = {'id': 'SR-1', 'at': '10:00:00', 'role': 'дизайнер', 'task': 'T-9', 'reason': 'макет',
          'skills': [], 'suggested': 'm', 'suggested_name': 'Д', 'status': 'pending'}
    jfile([_task('T-9', kind='дизайнер')], staffRequests=[sr])
    cli('removeTask', 'T-9', 'не нужна')
    j = state()
    assert j['staffRequests'][0]['status'] != 'pending', \
        'заявка на найм под снятую задачу не висит у владельца'


# ── unblockTask ──────────────────────────────────────────────────────────────

def test_unblock_task_clears_block_and_attempts(jfile):
    jfile([_task('T-10', blocked=True, attempts=3,
                 comments=[{'at': '1', 'author': 'jev', 'text': 'попытка 3: no_commit'}])])
    out = cli('unblockTask', 'T-10', 'поправили окружение')
    assert 'T-10' in out
    j = state()
    t = find(j, 'T-10')
    assert not t.get('blocked')
    assert t['attempts'] == 0
    assert any('попытка 3' in c['text'] for c in t['comments']), 'история попыток не стирается'
    assert any('поправили окружение' in c['text'] for c in t['comments'])
    assert j['log'][0]['op'] == 'unblockTask'


def test_unblocked_task_is_picked_by_dispatcher_again(jfile, monkeypatch):
    jfile([_task('T-11', blocked=True, attempts=3)], [_worker('w1')])
    cli('unblockTask', 'T-11')
    j = state()
    monkeypatch.setattr(dispatch, 'api', lambda *a, **k: json.loads(json.dumps(j)))
    assigned = []
    monkeypatch.setattr(dispatch, 'op', lambda n, a: assigned.append((n, a)) or {'out': 'ok'})
    monkeypatch.setattr(dispatch, 'triage_task', lambda t, w: None)
    monkeypatch.setattr(dispatch, 'needs_decomposition', lambda t, w: {'decompose': False})
    dispatch._decomp_cache.clear()
    dispatch.auto_assign_with_jev()
    assert ('assign', ['T-11', 'w1']) in assigned


# ── setTaskRole ──────────────────────────────────────────────────────────────

def test_set_task_role_sets_kind(jfile):
    jfile([_task('T-12', kind=None)])
    cli('setTaskRole', 'T-12', 'дизайнер')
    j = state()
    assert find(j, 'T-12')['kind'] == 'дизайнер'
    assert j['log'][0]['op'] == 'setTaskRole'


def test_set_task_role_rejects_unknown_role(jfile):
    jfile([_task('T-13', kind='фулстак')])
    out = cli('set-task-role', 'T-13', 'маркетолог')
    assert 'роль' in out
    assert find(state(), 'T-13')['kind'] == 'фулстак', 'роль не из ROLES не ставится'


def test_set_task_role_refuses_while_other_role_works_on_it(jfile):
    jfile([_task('T-14', assignedTo='w1')], [_worker('w1', task='T-14', status='run')])
    cli('setTaskRole', 'T-14', 'дизайнер')
    j = state()
    assert find(j, 'T-14')['kind'] == 'фулстак'
    assert worker(j, 'w1')['task'] == 'T-14'


def test_set_task_role_does_not_touch_worker_role(jfile):
    jfile([_task('T-15')], [_worker('w1')])
    cli('setTaskRole', 'T-15', 'копирайтер')
    assert worker(state(), 'w1')['role'] == 'фулстак'


# ── failAttempt: причина видна в задаче ─────────────────────────────────────

def test_fail_attempt_reason_goes_to_task_comments(jfile):
    jfile([_task('T-16', assignedTo='w1')], [_worker('w1', task='T-16', status='run')])
    cli('failAttempt', 'T-16', 'no_commit: исполнитель не сделал коммит')
    t = find(state(), 'T-16')
    assert any('no_commit: исполнитель не сделал коммит' in c['text'] for c in t['comments'])


def test_fail_attempt_without_reason_is_still_visible_in_task(jfile):
    jfile([_task('T-17', assignedTo='w1')], [_worker('w1', task='T-17', status='run')])
    cli('failAttempt', 'T-17')
    t = find(state(), 'T-17')
    assert any('попытка 1' in c['text'] for c in t['comments']), \
        'возврат без причины тоже оставляет след в треде'


def test_dispatcher_reject_reason_lands_in_task(jfile, monkeypatch, tmp_path):
    """Сквозной путь: tick() отклонил результат → причина в треде задачи, не только в log."""
    jfile([_task('T-18', assignedTo='w1')],
          [_worker('w1', task='T-18', status='run', provider='Anthropic', model='claude-code')])
    monkeypatch.setattr(journal, 'save', lambda j: None)
    j = state()

    def op(name, args):
        return {'ok': True, 'out': journal.dispatch(j, [name] + [str(a) for a in args])}
    monkeypatch.setattr(dispatch, 'api', lambda *a, **k: json.loads(json.dumps(j)))
    monkeypatch.setattr(dispatch, 'op', op)
    monkeypatch.setattr(dispatch, 'verify_journal', lambda jj: [])
    monkeypatch.setattr(dispatch, 'auto_assign_with_jev', lambda: None)
    wd = str(tmp_path / 'wt')
    os.makedirs(wd)
    monkeypatch.setattr(dispatch, 'ensure_worktree', lambda tid, w: wd)
    monkeypatch.setattr(dispatch, 'set_retry_backoff', lambda *a, **k: None)
    monkeypatch.setattr(dispatch.subprocess, 'run',
                        lambda cmd, *a, **k: subprocess.CompletedProcess(cmd, 0, stdout='готово', stderr=''))
    dispatch.tick()

    t = find(j, 'T-18')
    assert t['attempts'] == 1
    service = [c['text'] for c in t['comments'] if c['author'] == 'jev']
    assert service and 'попытка 1' in service[-1]
    assert 'no_commit' in service[-1] or 'провал' in service[-1]
