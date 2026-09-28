#!/usr/bin/env python3
"""Проверка согласованности journal.json; код выхода 0 — OK, 1 — ошибки."""

import argparse
import json
from pathlib import Path


def validate(journal):
    errors = []
    if not isinstance(journal, dict):
        return ["Журнал должен быть JSON-объектом"]

    collections = {}
    for key in ("workers", "queue"):
        rows = journal.get(key)
        if not isinstance(rows, list):
            errors.append(f"{key}: ожидается список")
            continue
        indexed = {}
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                errors.append(f"{key}[{index}]: ожидается объект со строковым id")
                continue
            if row["id"] in indexed:
                errors.append(f"{key}: повторяющийся id {row['id']!r}")
            indexed[row["id"]] = row
        collections[key] = indexed
    if errors:
        return errors

    workers, tasks = collections["workers"], collections["queue"]
    for worker_id, worker in workers.items():
        task_id = worker.get("task")
        if worker.get("status") in ("run", "blocked") and task_id is None:
            errors.append(
                f"Модель {worker_id}: статус {worker['status']} при task=null"
            )
        if task_id is not None:
            task = tasks.get(task_id) if isinstance(task_id, str) else None
            if task is None:
                errors.append(f"Модель {worker_id}: задача {task_id!r} не существует")
            elif task.get("assignedTo") != worker_id:
                errors.append(
                    f"Модель {worker_id}: у задачи {task_id} "
                    f"assignedTo={task.get('assignedTo')!r}, ожидается {worker_id!r}"
                )

    for task_id, task in tasks.items():
        worker_id = task.get("assignedTo")
        if worker_id is not None and (
            not isinstance(worker_id, str) or worker_id not in workers
        ):
            errors.append(f"Задача {task_id}: модель {worker_id!r} не существует")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "journal", nargs="?", type=Path,
        default=Path(__file__).resolve().with_name("journal.json"),
        help="Путь к журналу (по умолчанию рядом со скриптом)",
    )
    args = parser.parse_args()
    try:
        errors = validate(json.loads(args.journal.read_text(encoding="utf-8")))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors = [f"Не удалось прочитать журнал {args.journal}: {exc}"]
    print("\n".join(f"- {error}" for error in errors) if errors else "OK")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
