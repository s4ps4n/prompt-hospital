// Сопоставление платежа со счетами. Чистая локальная арифметика: без сети, без LLM.
// Автозакрытие — только уровень 1: ИНН + сумма (до копейки) → ровно один счёт из стадий поиска
// (фильтр по STATUS_ID — в b24.ts). Любая неоднозначность — человеку.

export type Invoice = {
  id: number
  number: string
  amountKop: number
  /** Дата выставления (YYYY-MM-DD) — подсказка человеку на уровне 2, не решатель. */
  issuedAt: string | null
  /** Текущая стадия (название; ID, если название не получено) — подсказка человеку на уровне 2. */
  stage: string
  /** ИНН из реквизитов компании/контакта счёта (нормализованные). */
  inns: string[]
  dealId: number | null
  /** Наше юрлицо-продавец (mycompanyId в Б24); null — не указано. */
  entity: number | null
}

export type Payment = {
  /** operationId Точки — ключ идемпотентности. */
  key: string
  /** Наше юрлицо, на чей р/с пришёл платёж (mycompanyId в Б24); null — юрлицо одно, не различаем. */
  entity: number | null
  payerInn: string | null
  payerName: string
  amountKop: number
  purpose: string
  date: string
}

/**
 * Случаи уровня 2 (ТЗ v3 §4):
 * multiple — несколько счетов с этим ИНН и суммой; combined — сумма равна сумме двух+ счетов ИНН;
 * partial — меньше счёта ИНН (частичная оплата); overpayment — больше любого счёта ИНН (переплата);
 * no_inn — ИНН в платеже нет, совпала только сумма;
 * other_entity — у нашего юрлица-получателя совпадений нет, а ИНН+сумма совпали со счётом другого юрлица
 * (или счётом без указанного юрлица) — клиент мог заплатить не на тот р/с.
 */
export type Level2Reason = 'multiple' | 'combined' | 'partial' | 'overpayment' | 'no_inn' | 'other_entity'
/** no_match — нет ИНН и нет совпадения по сумме; inn_no_open — у ИНН нет счетов, ждущих оплаты; too_many — шум. */
export type Level3Reason = 'no_match' | 'inn_no_open' | 'too_many'

export type MatchResult =
  | { level: 1; invoice: Invoice }
  | { level: 2; reason: Level2Reason; candidates: Invoice[]; mentioned: number[]; combo: number[] }
  | { level: 3; reason: Level3Reason }

/** Больше кандидатов только по сумме — это уже не «проверка», а шум: в ручной разбор. */
export const MAX_AMOUNT_ONLY_CANDIDATES = 5
/** Перебор подмножеств для «суммы нескольких счетов» — до 2^16; больше счетов у одного ИНН — только пары. */
const MAX_SUBSET_SEARCH = 16

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Назначение — только подсказка человеку, уровень оно не повышает. */
function mentionedIn(purpose: string, invoices: Invoice[]): number[] {
  return invoices
    .filter((i) => i.number && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(i.number)}($|[^\\p{L}\\p{N}])`, 'iu').test(purpose))
    .map((i) => i.id)
}

/** id счетов, входящих хотя бы в одно подмножество из 2+ счетов с суммой ровно target. */
function combinedIds(invoices: Invoice[], target: number): number[] {
  const hit = new Set<number>()
  const n = invoices.length
  if (n <= MAX_SUBSET_SEARCH) {
    for (let mask = 1; mask < 1 << n; mask++) {
      let sum = 0
      let count = 0
      for (let i = 0; i < n; i++) if (mask & (1 << i)) (sum += invoices[i].amountKop), count++
      if (count >= 2 && sum === target) for (let i = 0; i < n; i++) if (mask & (1 << i)) hit.add(invoices[i].id)
    }
  } else {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (invoices[i].amountKop + invoices[j].amountKop === target) hit.add(invoices[i].id).add(invoices[j].id)
  }
  return [...hit]
}

/**
 * Два юрлица: ищем только среди счетов того юрлица, на чей р/с пришли деньги.
 * Счёт другого юрлица (или без юрлица) с тем же ИНН и суммой — не закрываем, а показываем человеку.
 */
export function matchPayment(p: Payment, open: Invoice[]): MatchResult {
  if (p.entity === null) return matchWithin(p, open)
  const own = matchWithin(p, open.filter((i) => i.entity === p.entity))
  if (own.level !== 3 || !p.payerInn) return own
  const elsewhere = open.filter((i) => i.entity !== p.entity && i.inns.includes(p.payerInn!) && i.amountKop === p.amountKop)
  if (elsewhere.length === 0) return own
  return { level: 2, reason: 'other_entity', candidates: elsewhere, mentioned: mentionedIn(p.purpose, elsewhere), combo: [] }
}

function matchWithin(p: Payment, open: Invoice[]): MatchResult {
  const l2 = (reason: Level2Reason, candidates: Invoice[], combo: number[] = []): MatchResult => ({
    level: 2,
    reason,
    candidates,
    mentioned: mentionedIn(p.purpose, candidates),
    combo,
  })

  if (p.payerInn) {
    const byInn = open.filter((i) => i.inns.includes(p.payerInn!))
    if (byInn.length === 0) return { level: 3, reason: 'inn_no_open' }
    const exact = byInn.filter((i) => i.amountKop === p.amountKop)
    // Проверка уникальности — ядро защиты от закрытия не того счёта.
    if (exact.length === 1) return { level: 1, invoice: exact[0] }
    if (exact.length > 1) return l2('multiple', exact)
    const combo = combinedIds(byInn, p.amountKop)
    if (combo.length > 0) return l2('combined', byInn, combo)
    if (byInn.some((i) => i.amountKop > p.amountKop)) return l2('partial', byInn)
    return l2('overpayment', byInn)
  }

  // ИНН нет (физлицо, самозанятый, СБП): сумма без ИНН — недостаточный сигнал, максимум уровень 2.
  const byAmount = open.filter((i) => i.amountKop === p.amountKop)
  if (byAmount.length === 0) return { level: 3, reason: 'no_match' }
  if (byAmount.length > MAX_AMOUNT_ONLY_CANDIDATES) return { level: 3, reason: 'too_many' }
  return l2('no_inn', byAmount)
}
