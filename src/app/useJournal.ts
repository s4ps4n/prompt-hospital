import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Journal, JournalStore } from '../journal'
import type { Message, MessageKind } from '../ui/MessageBar'

/** Текущий журнал из стора; перерисовка — по subscribe. */
export function useJournal(store: JournalStore): Journal {
  return useSyncExternalStore(store.subscribe, store.getJournal, store.getJournal)
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
