// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CSV_PATH, TS_PATH, generate, parseCsv, parseTranslations } from '../../scripts/i18n.mjs'
import App from '../app/App'
import { createJournalStore, createMemoryStorage } from '../journal'
import { ROLES } from '../journal/catalog'
import { LANG_STORAGE_KEY, LANGS, createTranslate, nextLang, translations } from '.'

const renderApp = () => render(<App store={createJournalStore({ storage: createMemoryStorage() })} motion={false} />)
const card = (name: string) => screen.getByRole('complementary', { name })
const openCard = (dom: ReturnType<typeof render>, id: string) => {
  const room = dom.container.querySelector(`[data-room="${id}"]`)
  if (!room) throw new Error(`нет комнаты ${id}`)
  fireEvent.click(room)
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('переключатель языка', () => {
  it('по умолчанию русский; RU ↔ EN меняет видимый текст', () => {
    const dom = renderApp()
    openCard(dom, 'w1')
    expect(within(card('Карточка модели')).getByRole('button', { name: '✓ Завершить' })).toBeTruthy()
    expect(within(card('Карточка модели')).getByText('в работе')).toBeTruthy()
    expect(document.documentElement.lang).toBe('ru')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }))
    const en = card('Model card')
    expect(within(en).getByRole('button', { name: '✓ Complete' })).toBeTruthy()
    expect(within(en).getByText('running')).toBeTruthy()
    expect(within(en).getByLabelText<HTMLSelectElement>('Role').selectedOptions[0].textContent).toBe('executor')
    expect(screen.getByRole('button', { name: 'Journal' })).toBeTruthy()
    expect(screen.getByRole('region', { name: "Hermes' tray" })).toBeTruthy()
    expect(screen.queryByText('✓ Завершить')).toBeNull()
    expect(document.documentElement.lang).toBe('en')

    fireEvent.click(screen.getByRole('button', { name: 'Переключить на русский' }))
    expect(within(card('Карточка модели')).getByRole('button', { name: '✓ Завершить' })).toBeTruthy()
  })

  it('роль остаётся русской в данных — переводится только подпись', () => {
    const dom = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }))
    const kind = screen.getByLabelText<HTMLSelectElement>('Task role')
    const executor = [...kind.options].find((o) => o.textContent === 'executor')
    expect(executor?.value).toBe('исполнитель')
    expect(dom.container.querySelector('[data-sign="w1"]')?.textContent).toContain('executor')
  })

  it('выбор сохраняется в localStorage и восстанавливается при следующем запуске', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }))
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en')
    cleanup()

    renderApp()
    expect(screen.getByRole('button', { name: 'Journal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Переключить на русский' }).textContent).toBe('RU')
  })

  it('мусор в localStorage — русский по умолчанию', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'xx')
    renderApp()
    expect(screen.getByRole('button', { name: 'Журнал' })).toBeTruthy()
  })
})

describe('t()', () => {
  it('подстановки и множественное число по языку', () => {
    const ru = createTranslate('ru')
    const en = createTranslate('en')
    expect([1, 2, 5, 11, 21, 0].map((n) => ru.plural('tasks', n))).toEqual(['1 задача', '2 задачи', '5 задач', '11 задач', '21 задача', '0 задач'])
    expect([1, 2, 0].map((n) => en.plural('tasks', n))).toEqual(['1 task', '2 tasks', '0 tasks'])
    expect(en('card.done', { n: 3 })).toBe('Done: 3')
    expect(ru('status.blocked')).toBe('заблокирован')
  })

  it('все роли переводятся; незнакомая роль из внешнего журнала — как есть', () => {
    const en = createTranslate('en')
    for (const r of ROLES) expect(en.role(r)).toMatch(/^[\x20-\x7e]+$/)
    expect(en.role('координатор')).toBe('coordinator')
    expect(en.role('тестировщик' as never)).toBe('тестировщик')
  })

  it('nextLang ходит по кругу', () => {
    expect(nextLang('ru')).toBe('en')
    expect(nextLang(LANGS[LANGS.length - 1])).toBe(LANGS[0])
  })
})

describe('translations.csv → translations.ts', () => {
  it('translations.ts сгенерирован из текущего CSV (иначе — npm run i18n)', () => {
    expect(readFileSync(TS_PATH, 'utf8')).toBe(generate(readFileSync(CSV_PATH, 'utf8')))
  })

  it('в CSV нет пропусков перевода', () => {
    expect(parseTranslations(readFileSync(CSV_PATH, 'utf8')).warnings).toEqual([])
    for (const l of LANGS) for (const v of Object.values(translations[l])) expect(v).not.toBe('')
  })

  it('кавычки RFC 4180, BOM и CRLF из Excel', () => {
    expect(parseCsv('﻿key,ru\r\na,"x, ""y""\nz"\r\n\r\n')).toEqual([
      ['key', 'ru'],
      ['a', 'x, "y"\nz'],
    ])
  })

  it('новый столбец — новый язык; пустая ячейка берётся из первого языка', () => {
    const ts = generate('key,ru,en,de\na.b,да,yes,ja\nc,нет,no,\n')
    expect(ts).toContain("export const LANGS = ['ru', 'en', 'de'] as const")
    expect(ts).toContain("  'de': {\n    'a.b': 'ja',\n    'c': 'нет',\n  },")
    expect(parseTranslations('key,ru,de\nc,нет,\n').warnings).toHaveLength(1)
  })

  it('битая таблица — ошибка', () => {
    expect(() => generate('id,ru\na,б\n')).toThrow(/key/)
    expect(() => generate('key,ru\na,б\na,в\n')).toThrow(/повторяется/)
    expect(() => generate('key,ru\na,\n')).toThrow(/основном языке/)
    expect(() => generate('key,ru\na,"б\n')).toThrow(/кавычка/)
  })
})
