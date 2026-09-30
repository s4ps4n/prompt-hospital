// Платёж → решение → действие в Б24 → запись в журнал. Сам платёж после обработки не хранится.
// Всё идёт через одну последовательную очередь: вебхуки и сверка не обгоняют друг друга.

import type { InvoiceStore } from './b24.ts'
import type { Journal, JournalResult } from './journal.ts'
import { errCode, type Logger } from './log.ts'
import { matchPayment, type Invoice, type Level2Reason, type Level3Reason, type MatchResult, type Payment } from './matcher.ts'

export type Outcome =
  | { status: 'duplicate' }
  | { status: 'closed'; invoiceId: number }
  | { status: 'observed'; invoiceId: number }
  | { status: 'review'; invoiceIds: number[] }
  | { status: 'unresolved' }

type ReviewReason = Level2Reason | 'race' | 'repeat'

/**
 * Окно поиска повтора по отпечатку. Сверка берёт выписку за вчера–сегодня, так что тот же платёж под другим
 * ключом придёт не позже чем через ~2 суток; ежемесячные платежи на ту же сумму окно не задевает.
 */
export const REPEAT_WINDOW_MS = 3 * 86_400_000

/** Юрлицо|ИНН|сумма; без ИНН уровня 1 не бывает — отпечаток не нужен. */
const fingerprint = (p: Payment) => (p.payerInn ? `${p.entity ?? ''}|${p.payerInn}|${p.amountKop}` : null)

/** «Какой именно случай» (ТЗ v3 §4) — короткая метка и пояснение. */
const REVIEW: Record<ReviewReason, [string, string]> = {
  multiple: ['несколько кандидатов', 'ИНН и сумма совпали с несколькими счетами — какой закрыть, решает человек (сверьте даты выставления с датой платежа)'],
  combined: ['сумма двух и более счетов', 'сумма платежа равна сумме нескольких счетов этого ИНН (отмечены ⊕) — возможно, оплачены разом'],
  partial: ['частичная оплата', 'сумма платежа меньше счёта этого ИНН и не совпала ни с одним счётом'],
  overpayment: ['переплата', 'сумма платежа больше любого открытого счёта этого ИНН'],
  no_inn: ['нет ИНН', 'в платеже нет ИНН плательщика (физлицо/самозанятый/СБП?) — совпадение только по сумме, этого недостаточно'],
  other_entity: ['другое юрлицо', 'деньги пришли на р/с одного нашего юрлица, а ИНН и сумма совпали со счётом другого (или счётом без указанной «Моей компании») — возможно, клиент оплатил не на тот счёт'],
  race: ['стадия сменилась', 'счёт совпал однозначно, но к моменту закрытия его стадию уже сменили (оплачен или решение принял человек)'],
  repeat: ['возможный повтор', 'за последние дни уже обработан платёж от этого ИНН на ту же сумму под другим номером операции — возможно, это тот же платёж (вебхук и выписка). Если это новая оплата — закройте счёт вручную'],
}

const UNRESOLVED: Record<Level3Reason, string> = {
  no_match: 'в платеже нет ИНН, и сумма не совпала ни с одним счётом, ожидающим оплаты',
  inn_no_open: 'у плательщика с этим ИНН нет счетов, ожидающих оплаты',
  too_many: 'ИНН нет, а по сумме совпало слишком много счетов',
}

export function rub(kop: number): string {
  const r = Math.floor(kop / 100).toLocaleString('ru-RU').replace(/\s/g, ' ')
  return `${r},${String(kop % 100).padStart(2, '0')} ₽`
}

/** Данные платежа для человека — пишутся только в CRM владельца, не в лог. */
function describe(p: Payment): string {
  return [
    `Сумма: ${rub(p.amountKop)}`,
    `Дата платежа: ${p.date || '—'}`,
    `Плательщик: ${p.payerName || '—'}`,
    `ИНН плательщика: ${p.payerInn ?? 'нет'}`,
    `Назначение: ${p.purpose ? p.purpose.slice(0, 500) : '—'}`,
    `Операция в Точке: ${p.key}`,
  ].join('\n')
}

export type ProcessorDeps = {
  store: InvoiceStore
  journal: Journal
  log: Logger
  /**
   * false — режим «только пометки» (первая неделя на бою): уровень 1 пишет в таймлайн, но не закрывает.
   * Включать true только после недели наблюдения.
   */
  autoClose: boolean
}

export function makeProcessor({ store, journal, log, autoClose }: ProcessorDeps) {
  async function notify(p: Payment, text: string) {
    // Сообщение — вспомогательное: сбой не должен вести к повторной обработке (и дублям пометок).
    try {
      await store.notify(text)
    } catch (e) {
      log('payment.notify_failed', { ref: journal.ref(p.key), error: errCode(e) })
    }
  }

  async function review(p: Payment, reason: ReviewReason, candidates: Invoice[], mentioned: number[], combo: number[]): Promise<Outcome> {
    const [label, why] = REVIEW[reason]
    const list = candidates
      .map(
        (c) =>
          `• ${combo.includes(c.id) ? '⊕ ' : ''}счёт ${c.number} (id ${c.id}) от ${c.issuedAt ?? 'дата не указана'}, стадия «${c.stage}», ${rub(c.amountKop)}` +
          (mentioned.includes(c.id) ? ' — упомянут в назначении' : ''),
      )
      .join('\n')
    const text = `⚠ Требует проверки: поступил платёж, счёт НЕ закрыт автоматически.\nСлучай: ${label}.\nПричина: ${why}.\n\nПлатёж:\n${describe(p)}\n\nСчета-кандидаты:\n${list}`
    for (const c of candidates) await store.flagForReview(c, text)
    // Пометки уже стоят: сбой задачи не должен вести к повторной обработке (и дублям пометок).
    try {
      await store.addTask(`Платёж требует проверки (Точка): ${label}`, `${text}\n\n${candidates.map((c) => `• ${store.link(c)}`).join('\n')}`)
    } catch (e) {
      log('payment.task_failed', { ref: journal.ref(p.key), error: errCode(e) })
    }
    await notify(p,`Платёж ${rub(p.amountKop)} требует проверки (${label}): кандидатов — ${candidates.length}, подробности в таймлайне счетов.\n${candidates.map((c) => `• ${store.link(c)}`).join('\n')}`)
    return { status: 'review', invoiceIds: candidates.map((c) => c.id) }
  }

  async function act(p: Payment, m: MatchResult): Promise<Outcome> {
    if (m.level === 1) {
      const fp = fingerprint(p)
      if (fp && journal.seen(fp, REPEAT_WINDOW_MS)) return review(p, 'repeat', [m.invoice], [], [])
      if (!autoClose) {
        await store.comment(m.invoice, `🔎 Режим «только пометки»: платёж однозначно совпал с этим счётом по ИНН и сумме. Автозакрытие выключено — закройте вручную, если всё верно.\n\n${describe(p)}`)
        await notify(p, `🔎 Поступила оплата ${rub(p.amountKop)} от ${p.payerName || 'плательщика'} — однозначно совпала со счётом ${m.invoice.number}. Режим «только пометки»: закройте вручную, если всё верно.\n${store.link(m.invoice)}`)
        return { status: 'observed', invoiceId: m.invoice.id }
      }
      // Перепроверяем непосредственно перед закрытием: стадию могли сменить руками.
      if ((await store.recheck(m.invoice.id)) === 'left') return review(p, 'race', [m.invoice], [], [])
      await store.markPaid(m.invoice, p.date)
      // Счёт уже закрыт: сбой комментария не должен вести к повторной обработке.
      try {
        await store.comment(m.invoice, `✅ Оплачен автоматически по платежу ${p.key}: ИНН и сумма однозначно совпали с этим счётом.\n\n${describe(p)}`)
      } catch (e) {
        log('payment.comment_failed', { ref: journal.ref(p.key), error: errCode(e) })
      }
      await notify(p, `✅ Поступила оплата ${rub(p.amountKop)} от ${p.payerName || 'плательщика'} — счёт ${m.invoice.number} переведён в «Оплачен».\n${store.link(m.invoice)}`)
      return { status: 'closed', invoiceId: m.invoice.id }
    }
    if (m.level === 2) return review(p, m.reason, m.candidates, m.mentioned, m.combo)
    await store.addTask('Неразобранный платёж (Точка)', `Платёж не сопоставлен со счётом: ${UNRESOLVED[m.reason]}.\n\n${describe(p)}`)
    await notify(p, 'Неразобранный платёж из Точки — поставлена задача на ручной разбор.')
    return { status: 'unresolved' }
  }

  const RESULT: Record<Exclude<Outcome['status'], 'duplicate'>, JournalResult> = {
    closed: 'closed',
    observed: 'observed',
    review: 'review',
    unresolved: 'unresolved',
  }

  return async function process(p: Payment): Promise<Outcome> {
    const ref = journal.ref(p.key)
    if (journal.has(p.key)) {
      log('payment.duplicate', { ref })
      return { status: 'duplicate' }
    }
    try {
      const m = matchPayment(p, await store.listOpen())
      const outcome = await act(p, m)
      if (outcome.status !== 'duplicate') {
        const invoiceId = outcome.status === 'closed' || outcome.status === 'observed' ? outcome.invoiceId : null
        journal.record(p.key, RESULT[outcome.status], invoiceId, fingerprint(p))
      }
      log('payment.processed', {
        ref,
        level: m.level,
        reason: m.level === 1 ? undefined : m.reason,
        candidates: m.level === 2 ? m.candidates.length : undefined,
        status: outcome.status,
      })
      return outcome
    } catch (e) {
      // Не пишем в журнал — повторный вебхук или сверка (§7) доделают.
      log('payment.failed', { ref, error: errCode(e) })
      throw e
    }
  }
}

/** Последовательная in-process очередь: ответ Точке уходит сразу, обработка — после. Упал процесс — подберёт сверка. */
export function makeQueue(process: (p: Payment) => Promise<unknown>) {
  let tail: Promise<void> = Promise.resolve()
  return {
    /** Промис завершается после обработки платежа; ошибки уже залогированы процессором. */
    push(p: Payment): Promise<void> {
      tail = tail.then(() => process(p)).then(
        () => undefined,
        () => undefined,
      )
      return tail
    },
    idle: () => tail,
  }
}
