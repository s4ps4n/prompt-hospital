#!/usr/bin/env python3
"""Ревью ops.ts + types.ts моделью Nemotron (OpenRouter, free), без reasoning для скорости."""
import json, urllib.request

KEY = None
for line in open('/home/hermes/.hermes/.env', encoding='utf-8'):
    if line.startswith('OPENROUTER_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'")

base = '/home/hermes/prompt-hospital/src/journal/'
src = ''.join(f"\n// ===== {f} =====\n" + open(base + f, encoding='utf-8').read()
              for f in ['types.ts', 'ops.ts', 'selectors.ts'])

prompt = """Ты — строгий рецензент TypeScript. Код — ядро приложения «Prompt Hospital» (журнал + операции). Инвариант: у worker `task != null` ⇔ статус `run|blocked`; очередь модели = задачи assignedTo=worker.id кроме текущей.

Найди: 1) баги и нарушения инвариантов; 2) edge cases; 3) проблемы типов; 4) рассогласование операций; 5) нарушение иммутабельности (входной журнал мутируется). Ответ строго по убыванию серьёзности (критично/средне/мелочь), для каждой — файл, суть, почему, как исправить. Не выдумывай проблемы. Если чисто — скажи.

Код:
""" + src

body = json.dumps({
    'model': 'nvidia/nemotron-3-super-120b-a12b:free',
    'messages': [{'role': 'user', 'content': prompt}],
    'temperature': 0.2,
    'reasoning': {'enabled': False},
}).encode()

req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=body,
    headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    if 'choices' in d:
        print(d['choices'][0]['message']['content'])
    else:
        print('НЕТ choices:', json.dumps(d, ensure_ascii=False)[:1500])
except Exception as e:
    print(f'ERROR: {e}')
