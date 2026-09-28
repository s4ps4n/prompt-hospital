import { describe, expect, it, vi } from 'vitest'
import { initialJournal } from './initial'
import { findWorker } from './selectors'
import { STORAGE_KEY, createMemoryStorage, defaultStorage, loadJournal, type KeyValueStorage } from './storage'
import { LOG_LIMIT, createJournalStore } from './store'
import type { Journal } from './types'

function makeStore(storage: KeyValueStorage = createMemoryStorage()) {
  return createJournalStore({ storage, now: () => '12:00:00' })
}

function stored(storage: KeyValueStorage): Journal {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) throw new Error('журнал не сохранён')
  return JSON.parse(raw) as Journal
}

describe('run', () => {
  it('применяет операцию, пишет в log и сохраняет', () => {
    const storage = createMemoryStorage()
    const store = makeStore(storage)
    const r = store.run('assign', { task: 'T-12', worker: 'w2' })
    expect('msg' in r).toBe(true)
    const j = store.getJournal()
    expect(findWorker(j, 'w2')?.task).toBe('T-12')
    expect(j.log[0]).toEqual({ op: 'assign', args: { task: 'T-12', worker: 'w2' }, at: '12:00:00' })
    expect(stored(storage)).toEqual(j)
  })

  it('возвращает журнал уже с записью в log', () => {
    const store = makeStore()
    const r = store.run('addTask', { title: 'x', priority: 2 })
    expect('msg' in r && r.journal).toBe(store.getJournal())
  })

  it('новые записи log — сверху, не больше LOG_LIMIT', () => {
    const store = makeStore()
    for (let i = 0; i < LOG_LIMIT + 5; i++) store.run('addTask', { title: `t${i}`, priority: 1 })
    const { log } = store.getJournal()
    expect(log).toHaveLength(LOG_LIMIT)
    expect(log[0]).toMatchObject({ op: 'addTask', args: { title: `t${LOG_LIMIT + 4}` } })
  })

  it('err и noop не меняют журнал, не пишут в log и не сохраняют', () => {
    const storage = createMemoryStorage()
    const store = makeStore(storage)
    const before = store.getJournal()
    const listener = vi.fn()
    store.subscribe(listener)
    expect('err' in store.run('setRole', { worker: 'w1', role: 'архитектор' })).toBe(true)
    expect(store.run('unassign', { task: 'T-12' })).toEqual({ noop: true })
    expect(store.getJournal()).toBe(before)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(listener).not.toHaveBeenCalled()
  })

  it('оповещает подписчиков; отписка работает', () => {
    const store = makeStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.run('block', { worker: 'w1' })
    off()
    store.run('block', { worker: 'w1' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('предыдущий снимок журнала остаётся нетронутым', () => {
    const store = makeStore()
    const before = store.getJournal()
    const snapshot = structuredClone(before)
    store.run('complete', { worker: 'w1' })
    expect(before).toEqual(snapshot)
  })
})

describe('check', () => {
  it('сухой прогон: возвращает результат, журнал и хранилище не меняются', () => {
    const storage = createMemoryStorage()
    const store = makeStore(storage)
    const before = store.getJournal()
    const r = store.check('assign', { task: 'T-12', worker: 'w2' })
    expect('msg' in r && findWorker(r.journal, 'w2')?.task).toBe('T-12')
    expect(store.getJournal()).toBe(before)
    expect(findWorker(before, 'w2')?.task).toBeNull()
    expect(before.log).toEqual([])
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('возвращает err для недопустимой операции', () => {
    const r = makeStore().check('assign', { task: 'T-13', worker: 'w3' })
    expect('err' in r).toBe(true)
  })
})

describe('хранилище', () => {
  it('журнал переживает «перезагрузку» — новый стор читает сохранённое', () => {
    const storage = createMemoryStorage()
    makeStore(storage).run('addTask', { title: 'переживу', priority: 3 })
    const reloaded = makeStore(storage).getJournal()
    expect(reloaded.queue.some((t) => t.title === 'переживу')).toBe(true)
    expect(reloaded.log).toHaveLength(1)
  })

  it('битый или чужой JSON — стартовый журнал', () => {
    const storage = createMemoryStorage()
    storage.setItem(STORAGE_KEY, '{oops')
    expect(loadJournal(storage)).toEqual(initialJournal())
    storage.setItem(STORAGE_KEY, JSON.stringify({ workers: 'nope' }))
    expect(loadJournal(storage)).toEqual(initialJournal())
  })

  it('reset возвращает стартовый состав и сохраняет его', () => {
    const storage = createMemoryStorage()
    const store = makeStore(storage)
    store.run('removeWorker', { worker: 'w2' })
    store.reset()
    expect(store.getJournal()).toEqual(initialJournal())
    expect(stored(storage)).toEqual(initialJournal())
  })

  it('без localStorage (node) — работает in-memory fallback', () => {
    expect(globalThis.localStorage).toBeUndefined()
    const s = defaultStorage()
    s.setItem('k', 'v')
    expect(s.getItem('k')).toBe('v')
    const store = createJournalStore()
    store.run('addTask', { title: 'x', priority: 1 })
    expect(store.getJournal().log).toHaveLength(1)
  })

  it('localStorage, падающий на записи, — fallback в память', () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    vi.stubGlobal('localStorage', broken)
    try {
      const s = defaultStorage()
      expect(s).not.toBe(broken)
      s.setItem('k', 'v')
      expect(s.getItem('k')).toBe('v')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ошибка записи при run не роняет операцию', () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    const store = makeStore(storage)
    expect('msg' in store.run('addTask', { title: 'x', priority: 1 })).toBe(true)
    expect(store.getJournal().log).toHaveLength(1)
  })
})
