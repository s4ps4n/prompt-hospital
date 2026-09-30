import { describe, expect, it } from 'vitest'
import { matchPayment, MAX_AMOUNT_ONLY_CANDIDATES, type Invoice, type Payment } from '../src/matcher.ts'
import { normalizeInn, toKopecks } from '../src/money.ts'
import { parseAccounts } from '../src/tochka.ts'

const A = '7707083893'
const B = '7702070139'

const inv = (id: number, amountKop: number, inns: string[], number = `INV-${id}`, entity: number | null = null): Invoice => ({ id, number, amountKop, issuedAt: null, stage: 'Новый', inns, dealId: null, entity })
const pay = (payerInn: string | null, amountKop: number, purpose = '', entity: number | null = null): Payment => ({
  key: 'k',
  entity,
  payerInn,
  payerName: 'ООО Ромашка',
  amountKop,
  purpose,
  date: '2026-09-30',
})

describe('matchPayment', () => {
  it('уровень 1: ИНН + сумма → ровно один счёт', () => {
    const r = matchPayment(pay(A, 150000), [inv(1, 150000, [A]), inv(2, 90000, [A]), inv(3, 150000, [B])])
    expect(r).toEqual({ level: 1, invoice: inv(1, 150000, [A]) })
  })

  it('уровень 2: ИНН + сумма совпали с двумя счетами — не гадаем', () => {
    const r = matchPayment(pay(A, 150000), [inv(1, 150000, [A]), inv(2, 150000, [A])])
    expect(r.level).toBe(2)
    if (r.level === 2) {
      expect(r.reason).toBe('multiple')
      expect(r.candidates.map((c) => c.id)).toEqual([1, 2])
    }
  })

  it('уровень 2: назначение с номером счёта НЕ превращает неоднозначность в автозакрытие', () => {
    const r = matchPayment(pay(A, 150000, 'Оплата по счёту INV-2 от 01.09'), [inv(1, 150000, [A]), inv(2, 150000, [A])])
    expect(r.level).toBe(2)
    if (r.level === 2) expect(r.mentioned).toEqual([2])
  })

  it('номер в назначении ищется целым словом (INV-1 ≠ INV-12)', () => {
    const r = matchPayment(pay(A, 150000, 'по счёту INV-12'), [inv(1, 150000, [A]), inv(12, 150000, [A])])
    if (r.level === 2) expect(r.mentioned).toEqual([12])
  })

  it('уровень 2, частичная оплата: сумма меньше счёта этого ИНН', () => {
    const r = matchPayment(pay(A, 149999), [inv(1, 150000, [A])])
    expect(r).toMatchObject({ level: 2, reason: 'partial' })
  })

  it('уровень 2, переплата: сумма больше любого счёта этого ИНН', () => {
    const r = matchPayment(pay(A, 300001), [inv(1, 150000, [A]), inv(2, 90000, [A])])
    expect(r).toMatchObject({ level: 2, reason: 'overpayment' })
  })

  it('уровень 2, сумма двух счетов: помечены оба слагаемых, кандидаты — все счета ИНН', () => {
    const r = matchPayment(pay(A, 240000), [inv(1, 150000, [A]), inv(2, 90000, [A]), inv(3, 500000, [A]), inv(4, 90000, [B])])
    expect(r).toMatchObject({ level: 2, reason: 'combined', combo: [1, 2] })
    if (r.level === 2) expect(r.candidates.map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('уровень 2, сумма трёх счетов тоже распознаётся', () => {
    const r = matchPayment(pay(A, 60000), [inv(1, 10000, [A]), inv(2, 20000, [A]), inv(3, 30000, [A]), inv(4, 70000, [A])])
    expect(r).toMatchObject({ level: 2, reason: 'combined' })
  })

  it('уровень 2: без ИНН, но сумма совпала с одним счётом — всё равно не закрываем', () => {
    const r = matchPayment(pay(null, 150000), [inv(1, 150000, [A])])
    expect(r).toMatchObject({ level: 2, reason: 'no_inn' })
  })

  it('уровень 3: ИНН есть, но у него нет счетов, ждущих оплаты (даже если сумма чужого счёта совпала)', () => {
    expect(matchPayment(pay(B, 150000), [inv(1, 150000, [A])])).toEqual({ level: 3, reason: 'inn_no_open' })
  })

  it('уровень 3: нет ни ИНН, ни совпадения по сумме', () => {
    expect(matchPayment(pay(null, 777), [inv(1, 150000, [A])])).toEqual({ level: 3, reason: 'no_match' })
    expect(matchPayment(pay(B, 777), [inv(1, 150000, [A])])).toEqual({ level: 3, reason: 'inn_no_open' })
  })

  it('уровень 3: слишком много совпадений только по сумме', () => {
    const many = Array.from({ length: MAX_AMOUNT_ONLY_CANDIDATES + 1 }, (_, i) => inv(i + 1, 500, []))
    expect(matchPayment(pay(null, 500), many)).toEqual({ level: 3, reason: 'too_many' })
  })

  it('счёт без ИНН в реквизитах не закрывается автоматически', () => {
    expect(matchPayment(pay(A, 500), [inv(1, 500, [])]).level).not.toBe(1)
  })
})

describe('matchPayment: два юрлица', () => {
  const OOO = 1
  const IP = 2

  it('ищем только среди счетов юрлица-получателя: одинаковые счета у двух юрлиц — не неоднозначность', () => {
    const r = matchPayment(pay(A, 150000, '', IP), [inv(1, 150000, [A], 'INV-1', OOO), inv(2, 150000, [A], 'INV-2', IP)])
    expect(r).toMatchObject({ level: 1, invoice: { id: 2 } })
  })

  it('неоднозначность внутри своего юрлица остаётся неоднозначностью', () => {
    const r = matchPayment(pay(A, 150000, '', OOO), [inv(1, 150000, [A], 'INV-1', OOO), inv(2, 150000, [A], 'INV-2', OOO), inv(3, 150000, [A], 'INV-3', IP)])
    expect(r).toMatchObject({ level: 2, reason: 'multiple' })
    if (r.level === 2) expect(r.candidates.map((c) => c.id)).toEqual([1, 2])
  })

  it('у получателя счетов нет, ИНН+сумма совпали со счётом другого юрлица → уровень 2 other_entity, не закрываем', () => {
    const r = matchPayment(pay(A, 150000, 'по счёту INV-1', IP), [inv(1, 150000, [A], 'INV-1', OOO)])
    expect(r).toEqual({ level: 2, reason: 'other_entity', candidates: [inv(1, 150000, [A], 'INV-1', OOO)], mentioned: [1], combo: [] })
  })

  it('счёт без юрлица при двух юрлицах автоматически не закрывается', () => {
    expect(matchPayment(pay(A, 150000, '', OOO), [inv(1, 150000, [A])])).toMatchObject({ level: 2, reason: 'other_entity' })
  })

  it('у получателя есть счета ИНН (частичная оплата) — чужие юрлица не подмешиваются', () => {
    const r = matchPayment(pay(A, 100000, '', OOO), [inv(1, 150000, [A], 'INV-1', OOO), inv(2, 100000, [A], 'INV-2', IP)])
    expect(r).toMatchObject({ level: 2, reason: 'partial' })
    if (r.level === 2) expect(r.candidates.map((c) => c.id)).toEqual([1])
  })

  it('без ИНН сумма у другого юрлица — не сигнал: уровень 3', () => {
    expect(matchPayment(pay(null, 150000, '', IP), [inv(1, 150000, [A], 'INV-1', OOO)])).toEqual({ level: 3, reason: 'no_match' })
  })

  it('ИНН+сумма не совпали ни у кого → уровень 3 как раньше', () => {
    expect(matchPayment(pay(B, 150000, '', IP), [inv(1, 150000, [A], 'INV-1', OOO)])).toEqual({ level: 3, reason: 'inn_no_open' })
  })
})

describe('parseAccounts', () => {
  const ACC1 = '40702810900000012345/044525104'
  const ACC2 = '40802810500000054321/044525104'

  it('два юрлица: «р/с/БИК=mycompanyId» через запятую', () => {
    expect(parseAccounts(`${ACC1}=1, ${ACC2}=2`)).toEqual([
      { id: ACC1, entity: 1 },
      { id: ACC2, entity: 2 },
    ])
  })

  it('старый TOCHKA_ACCOUNT_ID — одно юрлицо без различения', () => {
    expect(parseAccounts('', ACC1)).toEqual([{ id: ACC1, entity: null }])
  })

  it('два счёта без юрлица, дубли, мусор, пусто → отказ при старте', () => {
    expect(() => parseAccounts(`${ACC1},${ACC2}`)).toThrow()
    expect(() => parseAccounts(`${ACC1}=1,${ACC1}=2`)).toThrow()
    expect(() => parseAccounts('123/456=1')).toThrow()
    expect(() => parseAccounts(`${ACC1}=abc`)).toThrow()
    expect(() => parseAccounts('')).toThrow()
  })
})

describe('money', () => {
  it('toKopecks без плавающей точки', () => {
    expect(toKopecks('1500.5')).toBe(150050)
    expect(toKopecks('1 500,05')).toBe(150005)
    expect(toKopecks(0.1 + 0.2)).toBe(30)
    expect(toKopecks('1.234')).toBeNull()
    expect(toKopecks('-5')).toBeNull()
    expect(toKopecks('0')).toBeNull()
  })

  it('normalizeInn проверяет контрольную сумму, нули и мусор → null', () => {
    expect(normalizeInn(' 7707083893 ')).toBe(A)
    expect(normalizeInn('500100732259')).toBe('500100732259')
    expect(normalizeInn('7707083894')).toBeNull()
    expect(normalizeInn('0000000000')).toBeNull()
    expect(normalizeInn('')).toBeNull()
    expect(normalizeInn(undefined)).toBeNull()
  })
})
