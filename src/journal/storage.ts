import { initialJournal } from './initial'
import type { Journal } from './types'

export const STORAGE_KEY = 'orch-office-journal-v1'

/** Минимальный срез Web Storage, который нужен журналу. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createMemoryStorage(): KeyValueStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

/** localStorage, если он есть и доступен на запись; иначе — хранилище в памяти. */
export function defaultStorage(): KeyValueStorage {
  try {
    const ls = globalThis.localStorage
    if (ls) {
      const probe = `${STORAGE_KEY}:probe`
      ls.setItem(probe, '1')
      ls.removeItem(probe)
      return ls
    }
  } catch {
    // приватный режим, запрет cookies, file:// в некоторых браузерах
  }
  return createMemoryStorage()
}

function isJournalShape(value: unknown): value is Journal {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.workers) &&
    Array.isArray(v.queue) &&
    Array.isArray(v.log) &&
    typeof v.seq === 'number'
  )
}

export function loadJournal(storage: KeyValueStorage): Journal {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isJournalShape(parsed)) return parsed
    }
  } catch {
    // битый JSON — начинаем со стартового состава
  }
  return initialJournal()
}

export function saveJournal(storage: KeyValueStorage, journal: Journal): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(journal))
  } catch {
    // переполнение квоты — журнал остаётся в памяти до следующей удачной записи
  }
}
