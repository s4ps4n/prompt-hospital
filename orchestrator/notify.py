#!/usr/bin/env python3
"""Уведомление владельцу в Telegram о падении/остановке/подъёме диспетчера.

Вызывается из systemd:
  notify.py stop   — ExecStopPost (SERVICE_RESULT/EXIT_CODE/EXIT_STATUS от systemd)
  notify.py start  — ExecStartPost: шлёт «снова работает», только если до этого был сбой
Транспорт — engine-autopost/deliver.py, токен из engine-autopost/.env.
Если доставка не удалась — пишет в лог и в journald, код возврата 0 (не мешаем рестарту).
"""
import json
import os
import socket
import sys
import time
from pathlib import Path

D = Path(__file__).resolve().parent
STATE = D / 'notify.state.json'
LOG = D / 'logs' / 'dispatcher.log'
AUTOPOST = Path('/home/hermes/engine-autopost')
OWNER_CHAT_ID = '313740595'
THROTTLE_SEC = 15 * 60  # при цикле падений — не чаще раза в 15 минут

sys.path.insert(0, str(AUTOPOST))


def load_env(path):
    env = {}
    try:
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"\'')
    except OSError:
        pass
    return env


def state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def save(st):
    STATE.write_text(json.dumps(st))


def log_tail(n=8):
    try:
        lines = LOG.read_text(encoding='utf-8', errors='replace').splitlines()
        return '\n'.join(l[:200] for l in lines[-n:])
    except OSError:
        return '(лог недоступен)'


def send(text):
    from deliver import send_telegram
    env = load_env(AUTOPOST / '.env')
    chat = env.get('TELEGRAM_CHAT_ID_OWNER') or OWNER_CHAT_ID
    return send_telegram(text, token=env.get('TELEGRAM_BOT_TOKEN'), chat_id=chat)


def main(kind):
    st = state()
    now = time.time()
    host = socket.gethostname()
    if kind == 'stop':
        result = os.getenv('SERVICE_RESULT', '?')
        code = os.getenv('EXIT_CODE', '?')
        status = os.getenv('EXIT_STATUS', '?')
        planned = result == 'success' and code == 'exited' and status == '0'
        st['down'] = True
        st['planned'] = planned
        if planned:
            text = (f'⏹ Диспетчер оркестратора ОСТАНОВЛЕН ({host}).\n'
                    f'Если это перезапуск — следом придёт «снова работает».\n'
                    f'Иначе задачи из офиса не раздаются, пока не запустят:\n'
                    f'sudo systemctl start orch-dispatcher')
        else:
            text = (f'🔴 Диспетчер оркестратора УПАЛ ({host}): {result}, {code}={status}.\n'
                    f'systemd перезапустит его через 30 с.\n\nПоследние строки лога:\n{log_tail()}')
            if now - st.get('last_fail_sent', 0) < THROTTLE_SEC:
                st['suppressed'] = st.get('suppressed', 0) + 1
                save(st)
                print(f'notify: падение не отправлено (throttle), подряд: {st["suppressed"]}')
                return
            if st.get('suppressed'):
                text += f'\n\n(ещё падений с прошлого сообщения: {st["suppressed"]})'
            st['last_fail_sent'] = now
            st['suppressed'] = 0
    elif kind == 'start':
        if not st.get('down'):
            return
        st['down'] = False
        text = f'🟢 Диспетчер оркестратора снова работает ({host}).'
        # В цикле падений «поднялся» шлём один раз на одно сообщение о падении
        fail_at = st.get('last_fail_sent', 0)
        if not st.get('planned') and fail_at and st.get('recovery_for') == fail_at:
            save(st)
            return
        st['recovery_for'] = fail_at
    else:
        print('usage: notify.py stop|start')
        return
    save(st)
    try:
        r = send(text)
        print(f'notify: отправлено владельцу ({kind}): {r}')
    except BaseException as e:  # deliver кидает SystemExit без токена
        print(f'notify: НЕ ДОСТАВЛЕНО ({kind}): {type(e).__name__}: {str(e)[:200]}', file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '')
