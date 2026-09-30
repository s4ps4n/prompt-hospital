// Ежедневная сверка (ТЗ v3 §7): вебхуки теряются. Операции по счёту за вчера и сегодня — через
// тот же матчинг и журнал: обработанное пропускается, пропущенное обрабатывается. Выписка не сохраняется.
// Плюс проверка, что подписка на вебхук активна; нет — переподписываемся и уведомляем.

import { errCode, type Logger } from './log.ts'
import type { Payment } from './matcher.ts'
import { parseStatementTransaction, type OwnAccount, type TochkaApi } from './tochka.ts'

/** Приложение Точки одного юрлица: свой токен, свои р/с, своя подписка на вебхук. */
export type ReconcileSource = {
  /** Ключ юрлица (ooo/ip) — для лога. */
  key: string
  /** Название юрлица — для сообщения ответственному. */
  name: string
  api: TochkaApi
  clientId: string
  accounts: OwnAccount[]
}

export type ReconcileDeps = {
  sources: ReconcileSource[]
  webhookUrl: string
  /** Постановка в общую очередь; промис — после обработки. */
  submit: (p: Payment) => Promise<void>
  notify: (text: string) => Promise<void>
  log: Logger
  now?: () => number
}

const ymd = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function reconcile(d: ReconcileDeps): Promise<void> {
  const now = (d.now ?? Date.now)()
  const safeNotify = (text: string) => d.notify(text).catch((e) => d.log('reconcile.notify_failed', { error: errCode(e) }))

  // Юрлица и счета независимы: сбой по одному не отменяет сверку другого.
  for (const src of d.sources) {
    for (const acc of src.accounts) {
      try {
        const txs = await src.api.statement(acc.id, ymd(now - 86_400_000), ymd(now))
        let submitted = 0
        for (const tx of txs) {
          const p = parseStatementTransaction(tx, acc.entity)
          if (!p) continue
          await d.submit(p)
          submitted++
        }
        d.log('reconcile.statement', { status: src.key, candidates: submitted })
      } catch (e) {
        d.log('reconcile.failed', { reason: 'statement', status: src.key, error: errCode(e) })
        await safeNotify(`Интеграция Точка → Б24 (${src.name}): ежедневная сверка не выполнена (Точка недоступна или токен недействителен). Пропущенные платежи могут остаться необработанными.`)
      }
    }

    try {
      const w = await src.api.webhooks(src.clientId)
      if (!w.list.includes('incomingPayment') || w.url !== d.webhookUrl) {
        await src.api.subscribe(src.clientId, d.webhookUrl)
        d.log('reconcile.resubscribed', { status: src.key })
        await safeNotify(`Интеграция Точка → Б24 (${src.name}): подписка на вебхук поступлений была неактивна — переподписались. Платежи за период простоя подберёт сверка.`)
      }
    } catch (e) {
      d.log('reconcile.failed', { reason: 'webhook', status: src.key, error: errCode(e) })
      await safeNotify(`Интеграция Точка → Б24 (${src.name}): не удалось проверить подписку на вебхук Точки.`)
    }
  }
}

/** Мс до ближайшего часа `hour` (локальное время сервера). */
export function msUntil(hour: number, now = Date.now()): number {
  const next = new Date(now)
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 1)
  return next.getTime() - now
}
