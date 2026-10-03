import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { fetchJournal, type Journal, type JournalStore } from '../journal'
import type { Message, MessageKind } from '../ui/MessageBar'

/** Текущий журнал из стора; перерисовка — по subscribe. */
export function useJournal(store: JournalStore): Journal {
  return useSyncExternalStore(store.subscribe, store.getJournal, store.getJournal)
}

/** Связь с /journal: `off` — адрес не задан, `connecting` — ждём первого ответа, `ok`/`down` — итог последнего опроса. */
export type LinkStatus = 'off' | 'connecting' | 'ok' | 'down'

/**
 * Режим монитора: грузит журнал оркестратора с `url` при старте и затем каждые `pollMs`
 * (0 — только при старте). Пока /journal не ответил — остаётся локальный журнал; статус связи — в ответе.
 */
export function useRemoteJournal(store: JournalStore, url: string | undefined, pollMs: number): LinkStatus {
  // Итог опроса помнит свой адрес: при смене url прежний итог не действует.
  const [polled, setPolled] = useState<{ url: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!url) return
    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      // Запись (POST /op), пришедшая пока шёл опрос, свежее ответа опроса.
      const since = store.epoch()
      const remote = await fetchJournal(url, ctl.signal)
      if (ctl.signal.aborted) return
      if (remote) {
        store.loadRemote(remote, since)
        // API ответило — монитор после сбоя записи (POST /op → 502) больше не нужен.
        store.setReadOnly(false)
      }
      setPolled({ url, ok: remote !== null })
      if (pollMs > 0) timer = setTimeout(tick, pollMs)
    }
    void tick()
    return () => {
      ctl.abort()
      clearTimeout(timer)
    }
  }, [store, url, pollMs])
  if (!url) return 'off'
  if (polled?.url !== url) return 'connecting'
  return polled.ok ? 'ok' : 'down'
}

export const MESSAGE_MS = 6000

/** Сообщение в нижней строке; гаснет через MESSAGE_MS. */
export function useMessage(timeout = MESSAGE_MS) {
  const [message, setMessage] = useState<Message | null>(null)
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), timeout)
    return () => clearTimeout(t)
  }, [message, timeout])
  const say = useCallback((text: string, kind: MessageKind) => setMessage({ text, kind }), [])
  return [message, say] as const
}
