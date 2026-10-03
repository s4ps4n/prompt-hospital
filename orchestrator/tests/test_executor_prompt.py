"""Промпт исполнителя: задача должна доходить целиком, а не одним заголовком.

Урок T-81/T-82 (03.10.2026): в промпт уходили только заголовок и три последних
комментария — описание не передавалось никогда, бриф из треда вытеснялся
служебными «попытка N: no_commit». Исполнитель не понимал задачу.

Проверяем через tick() на подменённых раннерах: настоящие claude/codex/HTTP-шлюз
не запускаются, перехватывается итоговый промпт.
"""
import io
import json
import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dispatch  # noqa: E402

BRIEF_TAIL = 'КОНЕЦ-БРИФА-7f3a: тесты зелёные, коммит сделан.'
BRIEF = (
    '# Бриф: сайт студии по продаже сайтов\n\n'
    '## Чего добиться\n\n'
    '1. **Пакеты** — три уровня с ценой.\n'
    '2. **Калькулятор стоимости** — считается в браузере.\n'
    '3. **Приём заявки** — форма, заявка сохраняется на сервере.\n\n'
    + 'Подробности требований. ' * 400   # ~10 КБ: обрезка будет видна
    + '\n\n' + BRIEF_TAIL
)
DESCRIPTION = 'Сайт студии: пакеты, калькулятор, заявки. ОПИСАНИЕ-МАРКЕР-41c2.'
EARLY_NOTE = 'Начатая работа лежит в sites/studio — не начинай с нуля. РАННИЙ-МАРКЕР-9d0e.'


def _task(**over):
    t = {
        'id': 'T-82', 'title': 'Сайт студии по продаже сайтов: довести до готовности',
        'description': DESCRIPTION, 'kind': 'фулстак', 'assignedTo': 'w1',
        'attempts': 3, 'dependsOn': [],
        'comments': [
            {'at': '03:58:30', 'author': 'координатор', 'text': EARLY_NOTE},
            {'at': '03:58:30', 'author': 'координатор', 'text': BRIEF},
            {'at': '04:01:00', 'author': 'jev', 'text': 'попытка 1: no_commit (структурный провал, без LLM)'},
            {'at': '04:03:00', 'author': 'jev', 'text': 'попытка 2: no_commit (структурный провал, без LLM)'},
            {'at': '04:05:00', 'author': 'jev', 'text': 'попытка 3: no_commit (структурный провал, без LLM)'},
        ],
    }
    t.update(over)
    return t


WORKERS = {
    'claude-cli': {'id': 'w1', 'name': 'Claude Code', 'provider': 'Anthropic',
                   'model': 'claude-code', 'role': 'фулстак'},
    'codex-cli': {'id': 'w1', 'name': 'Codex', 'provider': 'OpenAI',
                  'model': 'codex', 'role': 'фулстак'},
    'http': {'id': 'w1', 'name': 'Дипсик-Про', 'provider': 'deepseek',
             'model': 'deepseek-v4-pro', 'role': 'фулстак'},
}


def _run_tick(monkeypatch, tmp_path, task, runner='claude-cli'):
    """Один tick() с подменами; возвращает промпт, ушедший исполнителю."""
    workdir = str(tmp_path / 'wt')
    os.makedirs(workdir)
    worker = dict(WORKERS[runner], task=task['id'], status='run')
    journal = {'workers': [worker], 'queue': [task]}
    captured = []

    monkeypatch.setattr(dispatch, 'api', lambda *a, **k: json.loads(json.dumps(journal)))
    monkeypatch.setattr(dispatch, 'op', lambda *a, **k: {'ok': True})
    monkeypatch.setattr(dispatch, 'verify_journal', lambda j: [])
    monkeypatch.setattr(dispatch, 'auto_assign_with_jev', lambda: None)
    monkeypatch.setattr(dispatch, 'ensure_worktree', lambda tid, wd: workdir)
    monkeypatch.setattr(dispatch, 'set_retry_backoff', lambda *a, **k: None)

    def fake_run(cmd, *a, **k):
        if cmd[0] == 'claude':
            captured.append(cmd[2])
        elif cmd[0] == 'codex':
            captured.append(cmd[-1])
        return subprocess.CompletedProcess(cmd, 0, stdout='', stderr='')
    monkeypatch.setattr(dispatch.subprocess, 'run', fake_run)

    def fake_urlopen(req, *a, **k):
        body = json.loads(req.data.decode())
        captured.append(body['messages'][-1]['content'])
        answer = {'edits': [], 'files': [], 'summary': 'нет', 'done': False}
        return io.BytesIO(json.dumps(
            {'choices': [{'message': {'content': json.dumps(answer)}}]}).encode())
    monkeypatch.setattr(dispatch, '_provider_creds', lambda p: ('https://x.test/v1', 'k'))
    monkeypatch.setattr(dispatch.urllib.request, 'urlopen', fake_urlopen)

    dispatch.tick()
    assert len(captured) == 1, 'исполнитель должен быть вызван ровно один раз'
    return captured[0], workdir


@pytest.mark.parametrize('runner', ['claude-cli', 'codex-cli', 'http'])
def test_task_reaches_executor_in_full(monkeypatch, tmp_path, runner):
    prompt, workdir = _run_tick(monkeypatch, tmp_path, _task(), runner)

    assert 'Сайт студии по продаже сайтов: довести до готовности' in prompt
    assert DESCRIPTION in prompt
    assert BRIEF in prompt, 'бриф должен уйти целиком, без обрезки'
    assert BRIEF_TAIL in prompt
    assert EARLY_NOTE in prompt, 'ранние комментарии не должны вытесняться служебными'
    assert 'фулстак' in prompt
    assert workdir in prompt
    for n in (1, 2, 3):
        assert f'попытка {n}: no_commit' in prompt, 'служебные попытки не выбрасываются'


def test_prompt_sections_and_order(monkeypatch, tmp_path):
    prompt, _ = _run_tick(monkeypatch, tmp_path, _task())

    for head in ('ЗАДАЧА', 'ОПИСАНИЕ', 'БРИФ / ПРЕДЫДУЩИЕ НАХОДКИ', 'ГДЕ РАБОТАТЬ'):
        assert head in prompt, f'нет секции «{head}»'
    # хронология комментариев сохранена; попытки — отдельным блоком после брифа
    assert prompt.index(EARLY_NOTE) < prompt.index(BRIEF_TAIL) < prompt.index('попытка 1:')
    assert prompt.index('попытка 1:') < prompt.index('попытка 2:') < prompt.index('попытка 3:')
    # служебная приписка про тесты на месте (CLI-раннеры)
    assert 'ОБЯЗАТЕЛЬНО ПЕРЕД ЗАВЕРШЕНИЕМ: запусти тесты' in prompt
    assert 'нет описания' not in prompt


def test_empty_task_says_so_explicitly(monkeypatch, tmp_path):
    task = _task(title='разработать сайт под продажу сайтов', description=None, kind=None,
                 comments=[{'at': '03:49:34', 'author': 'jev',
                            'text': 'попытка 1: no_commit (структурный провал, без LLM)'}])
    prompt, workdir = _run_tick(monkeypatch, tmp_path, task)

    assert 'разработать сайт под продажу сайтов' in prompt
    assert 'в задаче нет описания, что именно требуется' in prompt
    assert 'попытка 1: no_commit' in prompt
    assert workdir in prompt


def test_description_alone_is_enough(monkeypatch, tmp_path):
    prompt, _ = _run_tick(monkeypatch, tmp_path, _task(comments=[]))
    assert DESCRIPTION in prompt
    assert 'нет описания' not in prompt
