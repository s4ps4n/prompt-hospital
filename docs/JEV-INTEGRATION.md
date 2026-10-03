# Подключение Jev (TypeSafe System One) к локальным агентам

Практический гайд: как подключить Jev к Гермесу, Claude Code, Codex и другим агентам, которые работают локально.

---

## Что такое Jev и зачем он в связке с агентом

Jev — это System One модель от TypeSafe AI. Её ключевое отличие от обычных LLM:

| | Обычная LLM (Claude, GPT) | Jev (System One) |
|---|---|---|
| Что делает | Генерирует текст | Отдаёт типизированное решение |
| Формат ответа | Свободные строки | `Choice` / `Noul` / `Score` + вероятность |
| Галлюцинации | Возможны | Невозможны (выход ограничен схемой) |
| Скорость | Секунды | Миллисекунды |
| Расход токенов на решение | 400–800 (рассуждения) | 1–5 (индекс выбора) |

Примитивы:
- **`Choice`** — выбрать один из заданного списка (какая роль, какой исполнитель, какой репозиторий).
- **`Noul`** — да/нет с вероятностью (прошли ли тесты, выполнена ли спецификация).
- **`Score`** — оценка по упорядоченной шкале (приоритет 1–3, качество 1–5).

Практический смысл для агента: **Jev берёт на себя решения, а не рассуждения.** Он не пишет код и не объясняет — он говорит «отдать задачу `w1`, репозиторий `cms_teach`, уверенность `0.95`», и агент действует строго по этому решению.

---

## Способ 1. Гермес (проще всего)

Гермесу достаточно одного сообщения в чат:

```
Гермес, давай подключим Jev. Вот ссылка:
https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md
```

Гермес сам:
1. Скачает скилл в профиль.
2. Разберёт протоколы `Choice` / `Noul` / `Score`.
3. Предложит, куда встроить Jev в рабочий цикл.

Проверка, что скилл встал:

```bash
ls ~/.hermes/profiles/<профиль>/skills/typesafe-ai/SKILL.md
```

---

## Способ 2. Claude Code

Официальный способ от TypeSafe — плагинный маркетплейс:

```bash
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

Проверка:

```bash
claude plugin list | grep typesafe
```

После установки Claude Code видит скилл `typesafe-ai` и применяет его, когда задача требует типизированного решения (маршрутизация, извлечение, верификация).

---

## Способ 3. Codex

Установщик от TypeSafe умеет раскладывать скилл сразу по агентам, которых находит на машине:

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

Он спросит, какому агенту ставить (список из 79 штук) — выбираете Codex.

**Неинтерактивная установка** (сервер, скрипт, CI — там, где нет терминала для выбора):

```bash
npx --yes skills add typesafe-ai/skills --skill typesafe-ai --agent codex -y
```

Без флагов `--agent <имя>` и `-y` установщик упрётся в приглашение выбора и отменится с сообщением
`Interactive prompt required but stdin is not a TTY`.

Файлы при этом ложатся в общий каталог `~/.agents/skills/typesafe-ai/` — его читают все агенты,
понимающие этот стандарт, и Codex в их числе.

Проверка, что Codex видит скилл:

```bash
cd <доверенный_каталог>
codex exec -s read-only "Перечисли доступные тебе скиллы. Есть ли typesafe-ai?"
```

Codex ответит списком, в котором будет `typesafe-ai`. Запускать надо из каталога, помеченного
`trust_level = "trusted"` в `~/.codex/config.toml`, иначе Codex откажется работать.

---

## Способ 4. Любой другой локальный агент

Скилл — это обычная Markdown-инструкция. Скачиваете и кладёте туда, где ваш агент ищет инструкции:

```bash
curl -sL https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md \
  -o <путь_инструкций_вашего_агента>/SKILL.md
```

Агент прочитает файл и получит:
- три примитива решений и когда какой брать;
- правила формулировки вопросов (одно узкое суждение на вопрос);
- ссылки на живую документацию и SDK (Python / JavaScript / HTTP API).

**Живая документация — источник истины:** https://docs.typesafe.ai/llms.txt

---

## Как это выглядит в коде: рабочий пример

Ниже — минимальный модуль триажа на Python. Именно так Jev встроен в наш диспетчер задач.

```python
import json, os, urllib.request

ENDPOINT = os.getenv("JEV_ENDPOINT", "https://api.typesafe.ai/v1/chat/completions")
API_KEY  = os.getenv("JEV_API_KEY", "")

def triage_task(task, available_workers):
    """Выбрать исполнителя и репозиторий под задачу (примитив Choice)."""
    workers = [
        {"id": w["id"], "name": w["name"], "role": w["role"]}
        for w in available_workers
        if w.get("status") in ("wait", "done") and not w.get("task")
    ]
    if not workers:
        return None

    payload = {
        "model": "jev",
        "messages": [
            {"role": "system", "content": (
                "Ты Jev, строгий System One диспетчер. "
                "Выбери лучшего исполнителя и репозиторий под задачу. "
                "Разрешённые репозитории: 'cms_teach' или 'prompt-hospital'. "
                'Отвечай строго JSON: {"worker_id": str, "repo": str, '
                '"confidence": float, "requires_review": bool}'
            )},
            {"role": "user", "content": (
                f"Задача: {task['title']}\n"
                f"Роль: {task.get('kind')}\n"
                f"Свободные исполнители:\n{json.dumps(workers, ensure_ascii=False)}"
            )},
        ],
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }

    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {API_KEY}",
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
        return json.loads(data["choices"][0]["message"]["content"])
```

Вызов:

```python
decision = triage_task(
    {"title": "#517: /llms.txt движком", "kind": "фулстак"},
    [
        {"id": "w1", "name": "Claude Code", "role": "фулстак", "status": "done"},
        {"id": "w2", "name": "Codex",       "role": "фулстак", "status": "wait"},
    ],
)
print(decision)
# {'worker_id': 'w1', 'repo': 'cms_teach', 'confidence': 0.95, 'requires_review': False}
```

---

## Две позиции в конвейере: триаж и гейткипер

Jev даёт максимум пользы, когда стоит **и на входе, и на выходе**:

```
Входящая задача
      │
      ▼
[JEV: триаж]        Choice — кому отдать, куда, с какой уверенностью
      │
      ▼
[Исполнитель]       Claude Code / Codex пишет код, запускает тесты
      │
      ▼
[JEV: гейткипер]    Noul — тесты прошли? спецификация соблюдена?
      │             Choice — approve / reject / escalate_to_human
      ▼
complete  или  возврат в работу
```

Гейткипер закрывает главную дыру наивного диспетчера: код выхода `0` ещё не значит, что работа сделана. Бывает, что агент отработал в неверной папке, отказался от задачи или изменил не то — и такая задача уходила в «выполненные». Jev смотрит на свидетельство (вывод + реальные `git diff`), а не на код выхода.

Пример гейткипера:

```python
def gatekeeper_review(task, worker_name, exec_output, exit_ok):
    payload = {
        "model": "jev",
        "messages": [
            {"role": "system", "content": (
                "Ты Jev, строгий System One гейткипер. "
                "Реши, можно ли закрыть задачу по результату исполнителя. "
                "Суди только по предъявленным доказательствам, будь консервативен. "
                'Отвечай строго JSON: {"verdict": "approve"|"reject"|"escalate_to_human", '
                '"tests_passed": bool, "spec_compliant": bool, "reason": str}'
            )},
            {"role": "user", "content": (
                f"Задача: {task['title']}\n"
                f"Роль: {task.get('kind')}\n"
                f"Исполнитель: {worker_name}\n"
                f"Код выхода ok: {exit_ok}\n"
                f"Хвост вывода исполнителя:\n{exec_output[-1500:]}"
            )},
        ],
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }
    # ... тот же HTTP-вызов, что выше ...
```

Гейткипер отдаёт `reject`, когда видит «работа сделана, но не то» или «изменений в репозитории нет», и `escalate_to_human` — когда доказательств недостаточно, но результат правдоподобен.

---

## Сколько это экономит

Оценка на одной операции классификации (вход ~4000 токенов):

| Подход | Выходных токенов | Время | Стоимость |
|---|---|---|---|
| Большая LLM | 400–800 (рассуждения, вступления) | 4–8 с | ~$0.015–0.03 |
| Jev | 1–5 (индекс выбора / вероятность) | 50–100 мс | ~$0.0001 |

Экономия по выходным токенам (самым дорогим) — **в 50–100 раз**, по отклику — на два порядка. На потоке из сотен задач разница становится решающей.

---

## Практические замечания

1. **Ключи только на сервере.** В веб-приложениях учётные данные Jev не должны попадать в браузер.
2. **Пороги проверяйте на своих данных.** Пороги уверенности из кукбуков — примеры, а не универсальные правила.
3. **Одно узкое суждение на вопрос.** Не просите Jev «оценить всё сразу» — разделяйте независимые измерения.
4. **Типы гарантируют интерфейс, а не истину.** Jev не ошибётся в формате, но решение всё равно стоит валидировать на своей предметной области.
5. **Живые доки важнее любого гайда.** Всё, что выше, может устареть: https://docs.typesafe.ai/llms.txt

---

## Ссылки

- Скилл: https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md
- Документация: https://docs.typesafe.ai/llms.txt
- Классификация исходной задачи (с чего всё началось): https://typesafe.ai/blog/introducing-system-one-models-and-jev
