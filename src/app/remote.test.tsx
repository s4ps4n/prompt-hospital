// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLIGHT_MS } from '../animations'
import {
  CATALOG,
  OFFLINE_ERR,
  READ_ONLY_ERR,
  createJournalStore,
  createMemoryStorage,
  opArgList,
  opUrlFor,
  resolveCatalogEntry,
  type Journal,
  type JournalStore,
} from '../journal'
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

  it('журнал оркестратора: локально стор не пишет, сброс не трогает журнал, «только для чтения» не показывается', async () => {
    stubFetch(() => ok(REMOTE))
    const store = createJournalStore({ storage: createMemoryStorage() })
    render(<App journalUrl="/journal" pollMs={0} motion={false} store={store} />)
    await waitFor(() => expect(store.isRemote()).toBe(true))

    expect(store.isReadOnly()).toBe(false)
    expect(store.run('unassign', { task: 'T-1' })).toEqual({ err: READ_ONLY_ERR })
    expect('msg' in store.check('assign', { task: 'T-2', worker: 'w3' })).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    expect(screen.getByRole('status').textContent).not.toContain(READ_ONLY_ERR)
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

describe('opArgList / opUrlFor: формат POST /op', () => {
  it('аргументы позиционно, как в journal.py', () => {
    expect(opArgList('assign', { task: 'T-1', worker: 'w2' })).toEqual(['T-1', 'w2'])
    expect(opArgList('reassign', { task: 'T-1', from: 'w1', to: 'w2' })).toEqual(['T-1', 'w1', 'w2'])
    expect(opArgList('unassign', { task: 'T-1' })).toEqual(['T-1'])
    expect(opArgList('setRole', { worker: 'w1', role: 'сисадмин' })).toEqual(['w1', 'сисадмин'])
    expect(opArgList('setPriority', { task: 'T-1', priority: 3 })).toEqual(['T-1', 3])
    expect(opArgList('reorder', { task: 'T-1', before: 'T-2' })).toEqual(['T-1', 'T-2'])
    expect(opArgList('complete', { worker: 'w1' })).toEqual(['w1'])
    expect(opArgList('block', { worker: 'w1' })).toEqual(['w1'])
    expect(opArgList('removeWorker', { worker: 'w1' })).toEqual(['w1'])
    expect(opArgList('addWorker', { model: 'gpt5', role: 'фулстак' })).toEqual(['gpt5', 'GPT-5', 'OpenAI', 'фулстак'])
    expect(opArgList('addTask', { title: 'x', priority: 2 })).toEqual(['x', 2, null])
    expect(opArgList('addTask', { title: 'x', priority: 1, kind: 'дизайнер' })).toEqual(['x', 1, 'дизайнер'])
  })

  it('URL записи — рядом с журналом', () => {
    expect(opUrlFor('/journal')).toBe('/op')
    expect(opUrlFor('http://127.0.0.1:8090/journal')).toBe('http://127.0.0.1:8090/op')
  })
})

describe('App: запись в журнал оркестратора (check → POST /op → journal)', () => {
  /** Журнал с задачей только для архитектора — её нельзя отдать рецензенту (отказ check()). */
  const WRITE: Journal = {
    ...REMOTE,
    queue: [...REMOTE.queue, { id: 'T-3', title: 'Схема стора', priority: 1, order: 3, assignedTo: null, kind: 'архитектор' }],
  }
  /** Что вернул сервер после операции — заведомо отличимо от локального прогона. */
  const AFTER: Journal = {
    ...WRITE,
    workers: WRITE.workers.map((w) => (w.id === 'w3' ? { ...w, status: 'run', task: 'T-2' } : w)),
    queue: WRITE.queue.map((t) => (t.id === 'T-2' ? { ...t, assignedTo: 'w3' } : t)),
    log: [{ op: 'assign', args: { task: 'T-2', worker: 'w3' }, at: 'server' }, ...WRITE.log],
  }

  type OpReply = (body: { name: string; args: unknown[] }) => Promise<Response>
  let store: JournalStore

  /** GET /journal → WRITE; POST /op → reply. Возвращает мок fetch. */
  async function mount(reply: OpReply, motion = true) {
    const fetch = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? reply(JSON.parse(String(init.body))) : ok(WRITE),
    )
    vi.stubGlobal('fetch', fetch)
    store = createJournalStore({ storage: createMemoryStorage() })
    const dom = render(<App journalUrl="/journal" pollMs={0} motion={motion} store={store} />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(store.isRemote()).toBe(true)
    return { fetch, dom }
  }
  const posts = (fetch: ReturnType<typeof vi.fn>) =>
    fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))])

  function release(source: Element, target: Element | null) {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
    fireEvent.pointerDown(source, { clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40 })
    fireEvent.pointerUp(window, { clientX: 60, clientY: 40 })
  }
  const slot = (id: string) => document.querySelector(`[data-task-slot="${id}"]`)!
  const status = () => screen.getByRole('status')

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('drag-and-drop: конверт летит, по приземлении POST /op {assign}, журнал — из ответа', async () => {
    const { fetch } = await mount(() => ok({ ok: true, out: 'ok', journal: AFTER }))
    release(slot('T-2'), room('w3'))
    expect(document.querySelector('[data-flight="T-2"]')).toBeTruthy()
    expect(posts(fetch)).toEqual([])

    await act(() => vi.advanceTimersByTimeAsync(FLIGHT_MS))
    expect(posts(fetch)).toEqual([['/op', { name: 'assign', args: ['T-2', 'w3'] }]])
    expect(store.getJournal()).toEqual(AFTER)
    expect(status().getAttribute('data-kind')).toBe('ok')
    expect(status().textContent).toContain('T-2 → Nemotron')
  })

  it('complete из карточки → POST /op {complete, [worker]}', async () => {
    const done: Journal = { ...WRITE, workers: WRITE.workers.map((w) => (w.id === 'w1' ? { ...w, status: 'done', task: null } : w)) }
    const { fetch } = await mount(() => ok({ ok: true, journal: done }))
    fireEvent.click(room('w1')!)
    fireEvent.click(screen.getByRole('button', { name: '✓ Завершить' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(posts(fetch)).toEqual([['/op', { name: 'complete', args: ['w1'] }]])
    expect(store.getJournal()).toEqual(done)
  })

  it('check() с ошибкой — POST не уходит, err в MessageBar', async () => {
    const { fetch } = await mount(() => ok({ ok: true, journal: AFTER }))
    release(slot('T-3'), room('w3'))
    await act(() => vi.advanceTimersByTimeAsync(FLIGHT_MS))
    expect(document.querySelector('[data-flight]')).toBeNull()
    expect(status().getAttribute('data-kind')).toBe('err')
    expect(status().textContent).toContain('архитектор')
    expect(posts(fetch)).toEqual([])
    expect(store.getJournal()).toEqual(WRITE)
  })

  it('отказ сервера {ok:false, err} — в MessageBar, журнал не меняется, запись остаётся доступной', async () => {
    const { fetch } = await mount(() => ok({ ok: false, err: 'сервер: модель занята' }), false)
    release(slot('T-2'), room('w3'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(posts(fetch)).toHaveLength(1)
    expect(status().getAttribute('data-kind')).toBe('err')
    expect(status().textContent).toContain('сервер: модель занята')
    expect(store.getJournal()).toEqual(WRITE)
    expect(store.isReadOnly()).toBe(false)
  })

  it.each([
    ['сеть недоступна', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['ответ 502', () => Promise.resolve(new Response('bad gateway', { status: 502 }))],
  ])('fallback (%s): монитор, read-only — как в B', async (_, reply) => {
    const { fetch } = await mount(reply, false)
    release(slot('T-2'), room('w3'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(store.isReadOnly()).toBe(true)
    expect(status().textContent).toContain(OFFLINE_ERR)
    expect(store.getJournal()).toEqual(WRITE)

    // дальше — монитор: операции отказывают локально, на сервер ничего не уходит
    release(slot('T-2'), room('w3'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(status().textContent).toContain(READ_ONLY_ERR)
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }))
    expect(status().textContent).toContain(READ_ONLY_ERR)
    expect(posts(fetch)).toHaveLength(1)
  })
})
