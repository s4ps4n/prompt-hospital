#!/usr/bin/env python3
"""
Патч идемпотентности декомпозиции в /root/orchestrator.

Запуск:  sudo python3 scripts/patch_idempotent_decompose.py

Что делает:
1. journal.py — добавляет функцию set_decomposed() и CLI-команду setDecomposed
2. dispatch.py — переставляет захват флага ДО вызова decompose_request
"""
import re, sys, os, ast, shutil
from pathlib import Path

ROOT = Path('/root/orchestrator')
JOURNAL = ROOT / 'journal.py'
DISPATCH = ROOT / 'dispatch.py'

def backup(p: Path):
    dst = p.with_suffix(p.suffix + '.bak')
    if not dst.exists():
        shutil.copy2(p, dst)
        print(f'  backup → {dst}')

# ── 1. Patch journal.py ──────────────────────────────────────────────
def patch_journal():
    print('\n=== journal.py ===')
    src = JOURNAL.read_text(encoding='utf-8')

    # 1a. Добавить функцию set_decomposed если её нет
    if 'def set_decomposed' not in src:
        # Найти последнюю def-функцию верхнего уровня и вставить после неё
        # или вставить перед блоком if __name__
        func_code = '''

def set_decomposed(j, task_id, value=True):
    """Пометить/снять пометку задачи как разобранной (идемпотентность декомпозиции)."""
    t = find_task(j, task_id)
    if not t:
        return 'нет задачи'
    t['decomposed'] = value
    action = 'setDecomposed' if value else 'setDecomposedBack'
    log(j, action, {'task': task_id})
    return f'{task_id}: помечена {"разобранной" if value else "НЕразобранной"}'
'''
        # Вставляем перед if __name__
        marker = "if __name__"
        if marker in src:
            idx = src.index(marker)
            src = src[:idx] + func_code + '\n' + src[idx:]
        else:
            src += func_code
        print('  + добавлена функция set_decomposed')
    else:
        print('  ✓ функция set_decomposed уже есть')

    # 1b. Добавить CLI-команду setDecomposed
    if "cmd == 'setDecomposed'" not in src:
        # Найти последний elif cmd == '...' и вставить после него
        # Ищем паттерн elif cmd == '...': и вставляем наш блок
        cli_block = """    elif cmd == 'setDecomposed':
        r = set_decomposed(j, argv[1]) if len(argv) > 1 else 'usage: setDecomposed <task>'
    elif cmd == 'setDecomposedBack':
        r = set_decomposed(j, argv[1], False) if len(argv) > 1 else 'usage: setDecomposedBack <task>'"""

        # Стратегия: найти последний 'elif cmd ==' и вставить после его блока
        lines = src.split('\n')
        insert_idx = None
        # Ищем последний elif cmd == (перед else: или перед финальной записью)
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("elif cmd =="):
                insert_idx = i
        
        if insert_idx is not None:
            # Найти конец блока этого elif — следующий elif/else на том же уровне
            base_indent = len(lines[insert_idx]) - len(lines[insert_idx].lstrip())
            end_idx = insert_idx + 1
            while end_idx < len(lines):
                l = lines[end_idx]
                if l.strip() == '':
                    end_idx += 1
                    continue
                cur_indent = len(l) - len(l.lstrip())
                if cur_indent <= base_indent and l.strip():
                    break
                end_idx += 1
            lines.insert(end_idx, cli_block)
            src = '\n'.join(lines)
            print('  + добавлены CLI-команды setDecomposed / setDecomposedBack')
        else:
            print('  ⚠ не нашёл elif cmd == для вставки CLI; добавляю в конец main-блока')
            src += '\n' + cli_block + '\n'
    else:
        print('  ✓ CLI-команда setDecomposed уже есть')

    # Проверяем синтаксис перед записью
    try:
        ast.parse(src)
    except SyntaxError as e:
        print(f'  ✗ СИНТАКСИЧЕСКАЯ ОШИБКА после патча: {e}')
        print('  файл НЕ перезаписан')
        return False

    backup(JOURNAL)
    JOURNAL.write_text(src, encoding='utf-8')
    print('  ✓ записано')
    return True


# ── 2. Patch dispatch.py ─────────────────────────────────────────────
def patch_dispatch():
    print('\n=== dispatch.py ===')
    src = DISPATCH.read_text(encoding='utf-8')

    # Ищем блок, где вызывается decompose_request
    if 'decompose_request' not in src:
        print('  ⚠ decompose_request не найден в файле — нечего патчить')
        return False

    lines = src.split('\n')
    patched = False

    # Проверяем: если setDecomposed уже стоит ДО decompose_request — уже ок
    set_decomposed_line = None
    decompose_line = None
    for i, line in enumerate(lines):
        if 'setDecomposed' in line and 'op(' in line:
            set_decomposed_line = i
        if 'decompose_request' in line and set_decomposed_line is None:
            decompose_line = i

    if set_decomposed_line is not None and decompose_line is None:
        print('  ✓ setDecomposed уже стоит до decompose_request')
        return True

    # Найти строку с decompose_request и вставить перед ней op('setDecomposed')
    new_lines = []
    decompose_idx = None
    for i, line in enumerate(lines):
        if 'decompose_request' in line and '=' in line and decompose_idx is None:
            decompose_idx = i
            indent = line[:len(line) - len(line.lstrip())]
            # Вставляем захват флага ДО вызова
            new_lines.append(f"{indent}op('setDecomposed', [t['id']])  # идемпотентность: захват ДО Jev")
            new_lines.append(line)
            patched = True
        else:
            new_lines.append(line)

    if not patched:
        print('  ⚠ не удалось найти строку с decompose_request для вставки')
        return False

    # Теперь найти место после decompose_request, где проверяется plan,
    # и добавить сброс флага при пустом плане
    src2 = '\n'.join(new_lines)
    
    # Ищем проверку plan (if plan, if not plan, и т.д.)
    # Добавляем setDecomposedBack если его ещё нет
    if 'setDecomposedBack' not in src2:
        final_lines = []
        for i, line in enumerate(new_lines):
            final_lines.append(line)
            stripped = line.strip()
            # Ищем: if not plan  или  if plan is None  или не-план проверку
            if decompose_idx is not None and i > decompose_idx:
                if ('not plan' in stripped or 'plan is None' in stripped or 
                    (stripped.startswith('if') and 'plan' in stripped and ('not' in stripped or 'None' in stripped))):
                    indent2 = line[:len(line) - len(line.lstrip())]
                    # Вставляем внутрь этого if-блока сброс флага
                    body_indent = indent2 + '    '
                    # Ищем первую строку тела if и вставляем перед ней
                    if i + 1 < len(new_lines):
                        next_line = new_lines[i + 1]
                        next_indent = next_line[:len(next_line) - len(next_line.lstrip())]
                        final_lines.append(f"{next_indent}op('setDecomposedBack', [t['id']])  # сброс: план пуст")
                    patched = True
                    break
        if len(final_lines) < len(new_lines):
            final_lines.extend(new_lines[len(final_lines):])
        new_lines = final_lines

    result = '\n'.join(new_lines)

    # Проверяем синтаксис
    try:
        ast.parse(result)
    except SyntaxError as e:
        print(f'  ✗ СИНТАКСИЧЕСКАЯ ОШИБКА после патча: {e}')
        print('  файл НЕ перезаписан')
        # Пишем в .patched для отладки
        debug_path = DISPATCH.with_suffix('.py.patched')
        debug_path.write_text(result, encoding='utf-8')
        print(f'  результат записан в {debug_path} для отладки')
        return False

    backup(DISPATCH)
    DISPATCH.write_text(result, encoding='utf-8')
    print('  ✓ записано')
    return True


# ── 3. Verify ────────────────────────────────────────────────────────
def verify():
    print('\n=== Проверка ===')
    ok = True

    # Синтаксис
    for f in [JOURNAL, DISPATCH]:
        try:
            ast.parse(f.read_text(encoding='utf-8'))
            print(f'  ✓ {f.name} — синтаксис OK')
        except SyntaxError as e:
            print(f'  ✗ {f.name} — ОШИБКА: {e}')
            ok = False

    # Наличие set_decomposed
    jsrc = JOURNAL.read_text(encoding='utf-8')
    if 'def set_decomposed' in jsrc:
        print('  ✓ journal.py: функция set_decomposed есть')
    else:
        print('  ✗ journal.py: функция set_decomposed НЕ НАЙДЕНА')
        ok = False

    if "cmd == 'setDecomposed'" in jsrc:
        print('  ✓ journal.py: CLI-команда setDecomposed зарегистрирована')
    else:
        print('  ✗ journal.py: CLI-команда setDecomposed НЕ НАЙДЕНА')
        ok = False

    # Порядок в dispatch.py
    dsrc = DISPATCH.read_text(encoding='utf-8')
    sd_pos = dsrc.find('setDecomposed')
    dr_pos = dsrc.find('decompose_request')
    if sd_pos >= 0 and dr_pos >= 0 and sd_pos < dr_pos:
        print('  ✓ dispatch.py: setDecomposed стоит ДО decompose_request')
    else:
        print(f'  ✗ dispatch.py: порядок неверный (setDecomposed@{sd_pos}, decompose_request@{dr_pos})')
        ok = False

    return ok


def main():
    print('Патч идемпотентности декомпозиции')
    print(f'Целевой каталог: {ROOT}')

    if not ROOT.exists():
        print(f'\n✗ Каталог {ROOT} не существует!')
        sys.exit(1)

    for f in [JOURNAL, DISPATCH]:
        if not f.exists():
            print(f'\n✗ Файл {f} не существует!')
            sys.exit(1)
        if not os.access(f, os.R_OK):
            print(f'\n✗ Нет доступа на чтение к {f} — запустите через sudo')
            sys.exit(1)
        if not os.access(f, os.W_OK):
            print(f'\n✗ Нет доступа на запись к {f} — запустите через sudo')
            sys.exit(1)

    j_ok = patch_journal()
    d_ok = patch_dispatch()

    if j_ok and d_ok:
        if verify():
            print('\n✓ Всё готово.')
        else:
            print('\n⚠ Патч применён, но проверка выявила проблемы.')
    else:
        print('\n✗ Не все патчи применены.')
        sys.exit(1)


if __name__ == '__main__':
    main()
