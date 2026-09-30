// Временные файлы тестов (журналы, токены) и кэш vitest — в ./.tmp (в .gitignore), а не в системный /tmp:
// на сервере /tmp общий и упирается в квоту (EDQUOT), тесты тогда падают не по своей вине.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const tmp = fileURLToPath(new URL('./.tmp/', import.meta.url))
mkdirSync(tmp, { recursive: true })
process.env.TMPDIR = tmp

export default defineConfig({ test: {} })
