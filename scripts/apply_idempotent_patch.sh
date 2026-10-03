#!/usr/bin/env bash
# Применить патч идемпотентности декомпозиции к /root/orchestrator
# Запуск: sudo bash scripts/apply_idempotent_patch.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Применяю патч идемпотентности декомпозиции ==="
sudo python3 scripts/patch_idempotent_decompose.py

echo ""
echo "=== Финальная проверка ==="
echo "--- dispatch.py: setDecomposed перед decompose_request ---"
sudo grep -n 'setDecomposed\|decompose_request' /root/orchestrator/dispatch.py || true
echo ""
echo "--- journal.py: функция set_decomposed ---"
sudo grep -n 'def set_decomposed' /root/orchestrator/journal.py || true
echo ""
echo "--- journal.py: CLI-команда ---"
sudo grep -n "cmd == 'setDecomposed'" /root/orchestrator/journal.py || true
echo ""
echo "--- Синтаксис ---"
sudo python3 -c "import ast; ast.parse(open('/root/orchestrator/dispatch.py').read()); ast.parse(open('/root/orchestrator/journal.py').read())" && echo "OK" || echo "FAIL"
