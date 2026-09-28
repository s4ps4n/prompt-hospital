#!/usr/bin/env node
/**
 * Генератор словаря интерфейса: src/i18n/translations.csv → src/i18n/translations.ts.
 *
 * CSV ведут люди (Excel / Google Sheets): первая строка — `key,ru,en[,de…]`, дальше по строке на ключ.
 * Новый язык = новый столбец. Пустая ячейка — предупреждение и подстановка из первого языка.
 * Кавычки по RFC 4180: значение с запятой, кавычкой или переводом строки — в "…", кавычка — "".
 *
 *   npm run i18n                     — пересобрать translations.ts
 *   node scripts/i18n.mjs --check    — только проверить, что translations.ts совпадает с CSV
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CSV_PATH = resolve(ROOT, 'src/i18n/translations.csv')
export const TS_PATH = resolve(ROOT, 'src/i18n/translations.ts')

const KEY_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/

/** CSV → массив строк (массивов ячеек). BOM из Excel отбрасывается, пустые строки пропускаются. */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (quoted) throw new Error('CSV: незакрытая кавычка')
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Разбор и проверка таблицы: { langs, keys, dict: { lang: { key: value } }, warnings }. */
export function parseTranslations(text) {
  const [header, ...body] = parseCsv(text)
  if (!header || header[0].trim() !== 'key') throw new Error('CSV: первая строка должна начинаться с "key"')
  const langs = header.slice(1).map((l) => l.trim())
  if (langs.length === 0) throw new Error('CSV: нет ни одного столбца языка')
  for (const l of langs) if (!LANG_RE.test(l)) throw new Error(`CSV: неверный код языка "${l}"`)
  if (new Set(langs).size !== langs.length) throw new Error('CSV: языки в заголовке повторяются')

  const warnings = []
  const keys = []
  const dict = Object.fromEntries(langs.map((l) => [l, {}]))
  body.forEach((cells, i) => {
    const line = i + 2
    const key = cells[0].trim()
    if (!KEY_RE.test(key)) throw new Error(`CSV:${line}: неверный ключ "${key}"`)
    if (keys.includes(key)) throw new Error(`CSV:${line}: ключ "${key}" повторяется`)
    if (cells.length > langs.length + 1) throw new Error(`CSV:${line}: ячеек больше, чем языков в заголовке`)
    keys.push(key)
    const base = cells[1] ?? ''
    if (base === '') throw new Error(`CSV:${line}: нет значения для "${key}" в основном языке ${langs[0]}`)
    langs.forEach((l, j) => {
      const v = cells[j + 1] ?? ''
      if (v === '') warnings.push(`CSV:${line}: "${key}" без перевода на ${l} — взят ${langs[0]}`)
      dict[l][key] = v === '' ? base : v
    })
  })
  return { langs, keys, dict, warnings }
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/** Текст src/i18n/translations.ts. */
export function generate(text) {
  const { langs, keys, dict } = parseTranslations(text)
  const out = [
    '// Сгенерировано scripts/i18n.mjs из translations.csv — не править руками: правьте CSV и запустите `npm run i18n`.',
    '',
    `export const LANGS = [${langs.map(q).join(', ')}] as const`,
    'export type Lang = (typeof LANGS)[number]',
    '',
    'export type TKey =',
    ...keys.map((k) => `  | ${q(k)}`),
    '',
    'export const translations: Record<Lang, Record<TKey, string>> = {',
  ]
  for (const l of langs) {
    out.push(`  ${q(l)}: {`)
    for (const k of keys) out.push(`    ${q(k)}: ${q(dict[l][k])},`)
    out.push('  },')
  }
  out.push('}', '')
  return out.join('\n')
}

function main() {
  const text = readFileSync(CSV_PATH, 'utf8')
  const { warnings } = parseTranslations(text)
  for (const w of warnings) console.warn(`warning: ${w}`)
  const ts = generate(text)
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(TS_PATH, 'utf8')
    } catch {
      // файла ещё нет — значит, не совпадает
    }
    if (current !== ts) {
      console.error('translations.ts не совпадает с translations.csv — запустите `npm run i18n`')
      process.exit(1)
    }
    console.log('translations.ts актуален')
    return
  }
  writeFileSync(TS_PATH, ts)
  console.log(`translations.ts: ${ts.split('\n').filter((l) => l.startsWith('  | ')).length} ключей`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
