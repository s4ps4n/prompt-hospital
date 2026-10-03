import { findCatalogEntry } from './catalog'
import { isJournalShape } from './storage'
import type { Journal, OpArgs, OpName } from './types'

/** Период опроса /journal в режиме монитора. */
export const JOURNAL_POLL_MS = 5000

/**
 * Журнал оркестратора (`GET /journal`). JSON совпадает с `Journal` и принимается как есть.
 * Сеть недоступна, не 2xx, битый JSON или чужая форма — null (вызывающий остаётся на локальном журнале).
 */
export async function fetchJournal(url: string, signal?: AbortSignal): Promise<Journal | null> {
  try {
    const res = await globalThis.fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data: unknown = await res.json()
    return isJournalShape(data) ? data : null
  } catch {
    return null
  }
}

/** URL записи операций рядом с журналом: `…/journal` → `…/op`. */
export function opUrlFor(journalUrl: string): string {
  return journalUrl.replace(/\/journal\/?(?=$|[?#])/, '/op')
}

/**
 * Аргументы операции позиционно, в порядке сигнатур `journal.py`.
 * addWorker: имя и провайдер берутся из каталога (фронтенд выбирает только модель и роль).
 */
export function opArgList<K extends OpName>(name: K, args: OpArgs[K]): unknown[] {
  const a = args as OpArgs[OpName] & Record<string, unknown>
  switch (name) {
    case 'assign':
      return [a.task, a.worker]
    case 'reassign':
      return [a.task, a.from, a.to]
    case 'unassign':
      return [a.task]
    case 'setRole':
      return [a.worker, a.role]
    case 'setPriority':
      return [a.task, a.priority]
    case 'reorder':
      return [a.task, a.before]
    case 'complete':
    case 'block':
    case 'removeWorker':
      return [a.worker]
    case 'addWorker': {
      const c = findCatalogEntry(a.model as string)
      return [a.model, c?.name ?? a.model, c?.provider ?? '', a.role]
    }
    case 'addTask':
      return [a.title, a.priority, a.kind ?? null]
  }
  return []
}

/** POST /op отклонён прокси (Basic Auth): сервер жив, браузер не прислал или потерял логин. */
export const authErr = (status: number) => `Нет доступа к API записи (${status}): обновите страницу и войдите заново`

/**
 * Ответ `POST /op`: применённый журнал, отказ сервера или `offline` —
 * API недоступен (сеть, 5xx без JSON-ответа сервера, не JSON) и офис переходит в монитор.
 * 500 с `{err}` — server.py жив, упала операция (journal.py): это отказ, а не недоступность.
 */
export type PostOpResult = { ok: true; journal: Journal; out?: unknown } | { ok: false; err: string } | { ok: false; offline: true }

export async function postOp(url: string, name: OpName, args: unknown[]): Promise<PostOpResult> {
  let res: Response
  let data: unknown
  try {
    res = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, args }),
    })
  } catch {
    return { ok: false, offline: true }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, err: authErr(res.status) }
  try {
    data = await res.json()
  } catch {
    return { ok: false, offline: true }
  }
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  if (d.ok === true && isJournalShape(d.journal)) return { ok: true, journal: d.journal, out: d.out }
  if (d.ok !== true && typeof d.err === 'string') return { ok: false, err: d.err }
  if (res.status >= 500) return { ok: false, offline: true }
  return { ok: false, err: `Неожиданный ответ API (${res.status})` }
}
