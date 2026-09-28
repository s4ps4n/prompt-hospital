import { initialJournal } from './initial'
import { applyOp } from './ops'
import { defaultStorage, loadJournal, saveJournal, type KeyValueStorage } from './storage'
import type { Journal, LogEntry, OpArgs, OpName, OpResult } from './types'

export const LOG_LIMIT = 40

export interface JournalStoreOptions {
  storage?: KeyValueStorage
  /** Метка времени для записи в log; подменяется в тестах. */
  now?: () => string
}

export interface JournalStore {
  getJournal(): Journal
  /** Применяет операцию: при успехе пишет в log, сохраняет и оповещает подписчиков. */
  run<K extends OpName>(name: K, args: OpArgs[K]): OpResult
  /** Сухой прогон: что сделает операция. Журнал не меняется. */
  check<K extends OpName>(name: K, args: OpArgs[K]): OpResult
  reset(): void
  subscribe(listener: () => void): () => void
}

const defaultNow = () => new Date().toLocaleTimeString('ru-RU')

export function createJournalStore(options: JournalStoreOptions = {}): JournalStore {
  const storage = options.storage ?? defaultStorage()
  const now = options.now ?? defaultNow
  const listeners = new Set<() => void>()
  let journal = loadJournal(storage)

  function commit(next: Journal): void {
    journal = next
    saveJournal(storage, journal)
    listeners.forEach((l) => l())
  }

  return {
    getJournal: () => journal,

    run(name, args) {
      const r = applyOp(journal, name, args)
      if (!('msg' in r)) return r
      // Сужение generic-пары (name, args) до элемента union LogEntry TS не выводит сам.
      const entry = { op: name, args, at: now() } as LogEntry
      commit({ ...r.journal, log: [entry, ...r.journal.log].slice(0, LOG_LIMIT) })
      return { ...r, journal }
    },

    check: (name, args) => applyOp(journal, name, args),

    reset() {
      commit(initialJournal())
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
