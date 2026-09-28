// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, READ_ONLY_ERR, createJournalStore, resolveCatalogEntry, createMemoryStorage, type Journal } from '../journal'
import App from './App'

/** Ответ /journal в том виде, как его отдаёт оркестратор: без color, модели вне каталога, роль «рецензент». */
const REMOTE = {
  workers: [
    { id: 'w0', model: 'deepseek', name: 'Гермес', provider: 'DeepSeek', role: 'координатор', status: 'run', task: null, doneCount: 0, history: [] },
    { id: 'w1', model: 'claude-code', name: 'Claude Code', provider: 'Anthropic', role: 'исполнитель', status: 'run', task: 'T-1', doneCount: 2, history: ['этап 7'] },
    { id: 'w3', model: 'nemotron-120b', name: 'Nemotron', provider: 'NVIDIA/OpenRouter', role: 'рецензент', status: 'done', task: null, doneCount: 1, history: ['ревью ядра'] },
  ],
  queue: [
    { id: 'T-1', title: 'Этап B: монитор журнала', priority: 3, order: 1, assignedTo: 'w1', kind: null },
    { id: 'T-2', title: 'Этап C: запись в журнал', priority: 2, order: 2, assignedTo: null, kind: null },
  ],
  log: [{ op: 'addTask', args: { title: 'Этап B: монитор журнала', priority: 3 }, at: '09:51:21' }],
  seq: 3,
} satisfies Journal

function stubFetch(impl: (url: string) => Promise<Response>) {
  const fetch = vi.fn((url: string) => impl(url))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const room = (id: string) => document.querySelector(`[data-room="${id}"]`)
const cardHeading = () => within(screen.getByRole('complementary', { name: 'Карточка модели' })).getByRole('heading').textContent

describe('resolveCatalogEntry: модели оркестратора вне каталога', () => {
  it('точное совпадение → префикс → провайдер → стабильный выбор', () => {
    expect(resolveCatalogEntry('deepseek').model).toBe('deepseek')
    expect(resolveCatalogEntry('claude-code', 'Anthropic').model).toBe('claude')
    expect(resolveCatalogEntry('qwen-27b', 'OpenRouter').model).toBe('qwen')
    expect(resolveCatalogEntry('codex', 'OpenAI').model).toBe('gpt5')
    const n = resolveCatalogEntry('nemotron-120b', 'NVIDIA/OpenRouter')
    expect(CATALOG).toContain(n)
    expect(resolveCatalogEntry('nemotron-120b', 'NVIDIA/OpenRouter')).toBe(n)
  })
})

describe('App: журнал оркестратора (/journal)', () => {
  it('рендерит workers и tasks из ответа /journal, а не из initial.ts', async () => {
    const fetch = stubFetch(() => ok(REMOTE))
    render(<App journalUrl="/journal" pollMs={0} motion={false} store={createJournalStore({ storage: createMemoryStorage() })} />)

    await waitFor(() => expect(room('w2')).toBeNull())
    expect(fetch).toHaveBeenCalledWith('/journal', expect.anything())
    // комнаты — ровно реальные модели
    expect([...document.querySelectorAll('[data-room]')].map((e) => e.getAttribute('data-room')).sort()).toEqual(['w0', 'w1', 'w3'])
    expect(screen.getByText('Этап C: запись в журнал')).toBeTruthy()
    expect(screen.queryByText('починить смоук karkas')).toBeNull()

    // модель вне каталога тоже нарисована и открывается в карточке
    fireEvent.click(room('w3')!)
    expect(cardHeading()).toBe('Nemotron')
  })

  it('монитор: операции и сброс не меняют журнал', async () => {
    stubFetch(() => ok(REMOTE))
    const store = createJournalStore({ storage: createMemoryStorage() })
    render(<App journalUrl="/journal" pollMs={0} motion={false} store={store} />)
    await waitFor(() => expect(store.isReadOnly()).toBe(true))

    expect(store.run('unassign', { task: 'T-1' })).toEqual({ err: READ_ONLY_ERR })
    expect(store.check('assign', { task: 'T-2', worker: 'w3' })).toEqual({ err: READ_ONLY_ERR })
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    expect(screen.getByRole('status').textContent).toContain(READ_ONLY_ERR)
    expect(store.getJournal()).toEqual(REMOTE)
  })

  it('опрос подхватывает изменения журнала; одинаковый ответ не перерисовывает', async () => {
    vi.useFakeTimers()
    try {
      let current: Journal = REMOTE
      stubFetch(() => ok(current))
      const store = createJournalStore({ storage: createMemoryStorage() })
      const listener = vi.fn()
      store.subscribe(listener)
      render(<App journalUrl="/journal" pollMs={1000} motion={false} store={store} />)
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(listener).toHaveBeenCalledTimes(1)

      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(listener).toHaveBeenCalledTimes(1)

      current = { ...REMOTE, queue: [], seq: 4 }
      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(listener).toHaveBeenCalledTimes(2)
      expect(store.getJournal().queue).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['сеть недоступна', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['ответ 502', () => Promise.resolve(new Response('bad gateway', { status: 502 }))],
    ['не журнал', () => ok({ ok: true })],
  ])('fallback на initial.ts: %s', async (_, impl) => {
    const fetch = stubFetch(impl)
    const store = createJournalStore({ storage: createMemoryStorage() })
    render(<App journalUrl="/journal" pollMs={0} motion={false} store={store} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await act(() => Promise.resolve())

    expect(store.isReadOnly()).toBe(false)
    expect(room('w2')).toBeTruthy()
    fireEvent.click(room('w2')!)
    expect(cardHeading()).toBe('GPT-5')
    expect(screen.getByText('починить смоук karkas')).toBeTruthy()
    // локальный режим остаётся интерактивным
    expect('msg' in store.run('unassign', { task: 'T-08' })).toBe(true)
  })

  it('без journalUrl /journal не запрашивается', () => {
    const fetch = stubFetch(() => ok(REMOTE))
    render(<App journalUrl="" motion={false} store={createJournalStore({ storage: createMemoryStorage() })} />)
    expect(fetch).not.toHaveBeenCalled()
    expect(room('w2')).toBeTruthy()
  })
})
