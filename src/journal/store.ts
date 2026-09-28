import { initialJournal } from './initial'
import { applyOp } from './ops'
import { defaultStorage, loadJournal, saveJournal, type KeyValueStorage } from './storage'
import type { Journal, LogEntry, OpArgs, OpName, OpResult } from './types'

export const LOG_LIMIT = 40

export const READ_ONLY_ERR = 'Монитор: журнал оркестратора только для чтения'
/** Fallback: API записи (/op) недоступен — офис остаётся монитором. */
export const OFFLINE_ERR = `API недоступно. ${READ_ONLY_ERR}`

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
  /**
   * Показывает журнал оркестратора (/journal или ответ POST /op). С первого вызова стор — удалённый:
   * локально run отвечает READ_ONLY_ERR (запись идёт через сервер), check — сухой прогон,
   * reset ничего не делает, в storage ничего не пишется. Повтор с тем же содержимым подписчиков не будит.
   * Без `ifEpoch` — результат записи (POST /op), сдвигает эпоху; с `ifEpoch` — ответ опроса,
   * применяется, только если с этой эпохи записей не было (иначе он старше записи).
   */
  loadRemote(journal: Journal, ifEpoch?: number): void
  /** Счётчик записей в удалённый журнал (для отбрасывания устаревших ответов опроса). */
  epoch(): number
  isRemote(): boolean
  /** Fallback на монитор: запись недоступна, check тоже отвечает READ_ONLY_ERR. */
  setReadOnly(): void
  isReadOnly(): boolean
}

const defaultNow = () => new Date().toLocaleTimeString('ru-RU')

export function createJournalStore(options: JournalStoreOptions = {}): JournalStore {
  const storage = options.storage ?? defaultStorage()
  const now = options.now ?? defaultNow
  const listeners = new Set<() => void>()
  let journal = loadJournal(storage)
  let remote: string | null = null
  let epoch = 0
  let readOnly = false

  const notify = () => listeners.forEach((l) => l())

  function commit(next: Journal): void {
    journal = next
    saveJournal(storage, journal)
    notify()
  }

  return {
    getJournal: () => journal,

    run(name, args) {
      if (remote !== null) return { err: READ_ONLY_ERR }
      const r = applyOp(journal, name, args)
      if (!('msg' in r)) return r
      // Сужение generic-пары (name, args) до элемента union LogEntry TS не выводит сам.
      const entry = { op: name, args, at: now() } as LogEntry
      commit({ ...r.journal, log: [entry, ...r.journal.log].slice(0, LOG_LIMIT) })
      return { ...r, journal }
    },

    check: (name, args) => (readOnly ? { err: READ_ONLY_ERR } : applyOp(journal, name, args)),

    reset() {
      if (remote !== null) return
      commit(initialJournal())
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    loadRemote(next, ifEpoch) {
      if (ifEpoch === undefined) epoch++
      else if (ifEpoch !== epoch) return
      const raw = JSON.stringify(next)
      if (raw === remote) return
      remote = raw
      journal = next
      notify()
    },

    epoch: () => epoch,
    isRemote: () => remote !== null,

    setReadOnly() {
      readOnly = true
    },

    isReadOnly: () => readOnly,
  }
}
