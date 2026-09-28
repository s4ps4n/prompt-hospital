import { isJournalShape } from './storage'
import type { Journal } from './types'

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
