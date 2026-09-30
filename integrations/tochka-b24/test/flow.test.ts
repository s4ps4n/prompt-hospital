// Сквозной сценарий: подписанный вебхук Точки → HTTP-сервер (200 сразу) → очередь → матчинг → REST Б24 → журнал.
// Б24 и API Точки — фейки в памяти (реальные адаптеры B24InvoiceStore / processor / reconcile поверх них).

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B24InvoiceStore, endOfDay, oauthRest, type B24Config, type B24Rest } from '../src/b24.ts'
import { FileJournal, JOURNAL_TTL_DAYS } from '../src/journal.ts'
import { B24Error, makeLogger, TochkaError } from '../src/log.ts'
import { makeProcessor, makeQueue } from '../src/processor.ts'
import { reconcile } from '../src/reconcile.ts'
import { createApp, SIGNATURE_ALERT_AFTER } from '../src/server.ts'
import { jwksKeys, staticKeys, type TochkaApi } from '../src/tochka.ts'

const INN_A = '7707083893'
const INN_B = '7702070139'
const ACCOUNT = '40702810900000012345'
const BIC = '044525104'
// Второе юрлицо владельца (ИП) — свой р/с в Точке; в Б24 «Мои компании»: 1 — ООО, 2 — ИП.
const ACCOUNT_IP = '40802810500000054321'
const OOO = 1
const IP = 2
const PORTAL = 'https://owner.bitrix24.ru'
const ISS = 'tochka-test-iss'
const AUD = 'owner-client-id'
// Воронка счетов владельца. ID условные — на портале они свои; важно, что привязка по ID.
const NEW = 'DT31_1:N' // «Новый» — ещё не отправлен, не ищем
const AUTO_OOO = 'DT31_1:UC_AUTO_OOO' // «Авто ООО: отправка, счёт и акт»
const AUTO_IP = 'DT31_1:UC_AUTO_IP' // «Авто ИП»
const READ = 'DT31_1:UC_READ' // «Клиент прочитал ⚠️»
const OVERDUE = 'DT31_1:UC_OVERDUE' // «Платёж просрочен» — ставит робот Б24
const DOUBT = 'DT31_1:UC_DOUBT' // «Сомнения» — ставит человек, не ищем
const NOT_PAID = 'DT31_1:UC_NOTPAID' // «Не оплачен» — ставит человек вручную, не ищем
const PAID = 'DT31_1:P' // «Оплачен» — ставит система
const SEARCH = [AUTO_OOO, AUTO_IP, READ, OVERDUE]
const STAGE_NAMES: Record<string, string> = {
  [NEW]: 'Новый',
  [AUTO_OOO]: 'Авто ООО: отправка, счёт и акт',
  [AUTO_IP]: 'Авто ИП',
  [READ]: 'Клиент прочитал ⚠️',
  [OVERDUE]: 'Платёж просрочен',
  [DOUBT]: 'Сомнения',
  [NOT_PAID]: 'Не оплачен',
  [PAID]: 'Оплачен',
}
const PURPOSE = 'Оплата по счёту СЧ-0042 за консультационные услуги'

type Item = { id: number; accountNumber: string; opportunity: number; currencyId: string; stageId: string; begindate: string; companyId: number; contactId: number; parentId2: number; mycompanyId: number }

class FakeB24 implements B24Rest {
  items: Item[] = []
  requisites: { ENTITY_TYPE_ID: number; ENTITY_ID: number; RQ_INN: string }[] = []
  calls: { method: string; params: any }[] = []
  failOn: string | null = null
  /** Имитирует портал, проигнорировавший фильтр: проверяем, что локальный фильтр держит. */
  ignoreFilter = false

  async call(method: string, params: any) {
    if (this.failOn === method) throw new B24Error('QUERY_LIMIT_EXCEEDED')
    this.calls.push({ method, params })
    switch (method) {
      case 'crm.item.list': {
        const allowed: string[] = params.filter['@stageId']
        const items = this.ignoreFilter ? this.items : this.items.filter((i) => allowed.includes(i.stageId))
        return { result: { items: items.map((i) => ({ ...i })) } }
      }
      case 'crm.status.list':
        if (params.filter.ENTITY_ID !== 'SMART_INVOICE_STAGE_1') return { result: [] }
        return { result: Object.entries(STAGE_NAMES).map(([STATUS_ID, NAME]) => ({ STATUS_ID, NAME })) }
      case 'crm.item.get':
        return { result: { item: { ...this.items.find((i) => i.id === params.id) } } }
      case 'crm.requisite.list':
        return {
          result: this.requisites.filter((r) => r.ENTITY_TYPE_ID === params.filter.ENTITY_TYPE_ID && params.filter.ENTITY_ID.includes(r.ENTITY_ID)),
        }
      case 'crm.item.update': {
        const it = this.items.find((i) => i.id === params.id)!
        Object.assign(it, params.fields)
        return { result: { item: it } }
      }
      case 'crm.timeline.comment.add':
      case 'tasks.task.add':
      case 'im.notify.system.add':
      case 'im.message.add':
        return { result: 1 }
    }
    throw new B24Error('METHOD_NOT_FOUND')
  }

  of(method: string) {
    return this.calls.filter((c) => c.method === method)
  }
  updates() {
    return this.of('crm.item.update')
  }
  paidIds() {
    return this.updates().filter((c) => c.params.fields.stageId === PAID).map((c) => c.params.id)
  }
  comments() {
    return this.of('crm.timeline.comment.add').map((c) => c.params.fields)
  }
  tasks() {
    return this.of('tasks.task.add')
  }
  notes() {
    return this.of('im.notify.system.add').map((c) => c.params.MESSAGE as string)
  }
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })

function jwt(payload: object, key: KeyObject = privateKey, alg = 'RS256', claims: object = { iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 300 }): string {
  const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify({ ...claims, ...payload })).toString('base64url')
  const s = alg === 'none' ? '' : sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')
  return `${h}.${p}.${s}`
}

function payment(o: { id: string; inn?: string | null; amount: string; account?: string; purpose?: string }) {
  return {
    webhookType: 'incomingPayment',
    operationId: o.id,
    date: '2026-09-30',
    purpose: o.purpose ?? PURPOSE,
    SidePayer: { inn: o.inn === null ? '' : (o.inn ?? INN_A), name: 'ООО «Ромашка»', account: '40702810111111111111', bankCode: '044525225', amount: o.amount, currency: 'RUB' },
    SideRecipient: { inn: '500100732259', name: 'ИП Владелец', account: o.account ?? ACCOUNT, bankCode: BIC, amount: o.amount, currency: 'RUB' },
  }
}

let b24: FakeB24
let server: Server
let url: string
let logLines: string[]
let journalPath: string
let journal: FileJournal
let queue: ReturnType<typeof makeQueue>
let alerts: number

type Accounts = { id: string; entity: number | null }[]

async function start(extra: Partial<B24Config> = {}, autoClose = true, accounts: Accounts = [{ id: `${ACCOUNT}/${BIC}`, entity: null }]) {
  const log = makeLogger((l) => logLines.push(l))
  const store = new B24InvoiceStore(b24, {
    entityTypeId: 31,
    paidStage: PAID,
    searchStages: SEARCH,
    reviewField: 'ufCrm_NEEDS_REVIEW',
    paidDateField: 'ufCrm_PAID_DATE',
    responsibleId: 7,
    listTtlMs: 0,
    portal: PORTAL,
    ...extra,
  })
  journal = new FileJournal({ path: journalPath, secret: 'test-secret' })
  queue = makeQueue(makeProcessor({ store, journal, log, autoClose }))
  alerts = 0
  server = createApp({
    keys: staticKeys([publicKey]),
    jwt: { iss: ISS, aud: AUD },
    accounts,
    path: '/tochka/webhook',
    submit: queue.push,
    log,
    onSignatureAlert: () => alerts++,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tochka/webhook`
}

const stop = () => new Promise<void>((r) => server.close(() => r()))

beforeEach(async () => {
  b24 = new FakeB24()
  // Компания 10 — ИНН A, компания 20 — ИНН B.
  b24.requisites = [
    { ENTITY_TYPE_ID: 4, ENTITY_ID: 10, RQ_INN: INN_A },
    { ENTITY_TYPE_ID: 4, ENTITY_ID: 20, RQ_INN: INN_B },
  ]
  logLines = []
  journalPath = join(mkdtempSync(join(tmpdir(), 'tb24-')), 'journal.json')
  await start()
})

afterEach(stop)

/** POST и дождаться, пока очередь обработает платёж. */
const post = async (body: string) => {
  const status = await fetch(url, { method: 'POST', body }).then((r) => r.status)
  await queue.idle()
  return status
}

function item(id: number, amount: number, companyId: number, extra: Partial<Item> = {}): Item {
  return { id, accountNumber: `СЧ-00${id}`, opportunity: amount, currencyId: 'RUB', stageId: AUTO_OOO, begindate: `2026-09-${String((id % 28) + 1).padStart(2, '0')}T00:00:00+03:00`, companyId, contactId: 0, parentId2: 0, mycompanyId: 0, ...extra }
}

describe('Точка → Б24: приёмка', () => {
  it('уникальные ИНН+сумма → ровно один счёт «оплачен» с датой и комментарием, остальные не тронуты', async () => {
    b24.items = [item(42, 15000.5, 10, { parentId2: 900 }), item(43, 9000, 10), item(44, 15000.5, 20)]
    expect(await post(jwt(payment({ id: 'p1', amount: '15000.50' })))).toBe(200)

    expect(b24.paidIds()).toEqual([42])
    expect(b24.updates()).toHaveLength(1)
    expect(b24.updates()[0].params.fields).toEqual({ stageId: PAID, ufCrm_PAID_DATE: '2026-09-30' })
    expect(b24.items.map((i) => i.stageId)).toEqual([PAID, AUTO_OOO, AUTO_OOO])
    // комментарий в таймлайн счёта и сделки, с operationId
    expect(b24.comments().map((c) => `${c.ENTITY_TYPE}:${c.ENTITY_ID}`)).toEqual(['smart_invoice:42', 'deal:900'])
    expect(b24.comments()[0].COMMENT).toContain('Оплачен автоматически по платежу p1')
    // одно сообщение ответственному: факт оплаты + ссылка на сделку
    expect(b24.notes()).toHaveLength(1)
    expect(b24.notes()[0]).toContain('Поступила оплата 15 000,50 ₽ от ООО «Ромашка» — счёт СЧ-0042 переведён в «Оплачен»')
    expect(b24.notes()[0]).toContain(`[URL=${PORTAL}/crm/deal/details/900/]сделка №900[/URL]`)
  })

  it('уровень 1 без привязанной сделки → в сообщении ссылка на сам счёт', async () => {
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p1b', amount: '15000.50' })))).toBe(200)
    expect(b24.notes()[0]).toContain(`[URL=${PORTAL}/crm/type/31/details/42/]счёт СЧ-0042[/URL] (сделка не привязана)`)
  })

  it('задан чат для уведомлений → сообщение в чат (im.message.add), а не личное уведомление', async () => {
    await stop()
    await start({ notifyDialogId: 'chat55' })
    b24.items = [item(42, 15000.5, 10, { parentId2: 900 })]
    expect(await post(jwt(payment({ id: 'p1c', amount: '15000.50' })))).toBe(200)
    expect(b24.of('im.notify.system.add')).toEqual([])
    expect(b24.of('im.message.add').map((c) => c.params.DIALOG_ID)).toEqual(['chat55'])
    expect(b24.of('im.message.add')[0].params.MESSAGE).toContain('/crm/deal/details/900/')
  })

  it('два совпадения ИНН+сумма → ни один счёт не закрыт, оба помечены «несколько кандидатов»', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p2', amount: '15000.50' })))).toBe(200)

    expect(b24.paidIds()).toEqual([])
    expect(b24.items.every((i) => i.stageId === AUTO_OOO)).toBe(true)
    expect(b24.updates().map((u) => [u.params.id, u.params.fields])).toEqual([
      [42, { ufCrm_NEEDS_REVIEW: 'Y' }],
      [43, { ufCrm_NEEDS_REVIEW: 'Y' }],
    ])
    const c = b24.comments()
    expect(c.map((x) => x.ENTITY_ID)).toEqual([42, 43])
    for (const x of c) {
      expect(x.COMMENT).toContain('Требует проверки')
      expect(x.COMMENT).toContain('Случай: несколько кандидатов')
      expect(x.COMMENT).toContain('СЧ-0042')
      expect(x.COMMENT).toContain('СЧ-0043')
    }
    expect(b24.notes()).toHaveLength(1) // одно сообщение ответственному
    expect(b24.notes()[0]).toContain('/crm/type/31/details/42/')
    expect(b24.notes()[0]).toContain('/crm/type/31/details/43/')
  })

  it('сумма = сумме двух счетов контрагента → уровень 2 с пометкой «сумма двух»', async () => {
    b24.items = [item(42, 10000, 10), item(43, 5000.5, 10)]
    expect(await post(jwt(payment({ id: 'p2c', amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    expect(b24.comments()[0].COMMENT).toContain('Случай: сумма двух и более счетов')
    expect(b24.comments()[0].COMMENT).toContain('⊕ счёт СЧ-0042')
    expect(b24.comments()[0].COMMENT).toContain('⊕ счёт СЧ-0043')
  })

  it.each([
    ['частичная оплата', '5000.00'],
    ['переплата', '20000.00'],
  ])('ИНН есть, сумма не совпала → уровень 2, случай «%s»', async (label, amount) => {
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: `p2-${label}`, amount })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    expect(b24.comments()[0].COMMENT).toContain(`Случай: ${label}`)
  })

  it('сумма без ИНН совпала с одним счётом → уровень 2, не закрыт', async () => {
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p3', inn: null, amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    expect(b24.comments()[0].COMMENT).toContain('Случай: нет ИНН')
  })

  it('платёж без ИНН и без совпадений → задача ответственному со сроком «сегодня» и данными платежа', async () => {
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p4', inn: null, amount: '1.00' })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    expect(b24.updates()).toEqual([])
    expect(b24.tasks()).toHaveLength(1)
    const f = b24.tasks()[0].params.fields
    expect(f.RESPONSIBLE_ID).toBe(7)
    expect(f.DEADLINE).toBe(endOfDay(Date.now()))
    expect(f.DESCRIPTION).toContain('1,00 ₽')
    expect(f.DESCRIPTION).toContain('Операция в Точке: p4')
    expect(f.DESCRIPTION).toContain(PURPOSE)
    expect(b24.notes()).toHaveLength(1)
  })

  it('повторный вебхук по тому же operationId → ничего не происходит', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 15000.5, 20)]
    const body = jwt(payment({ id: 'p5', amount: '15000.50' }))
    expect(await post(body)).toBe(200)
    const callsAfterFirst = b24.calls.length
    expect(await post(body)).toBe(200)
    expect(b24.calls.length).toBe(callsAfterFirst)
    expect(b24.paidIds()).toEqual([42])
  })

  it('одновременные дубли (гонка доставки) → закрытие одно', async () => {
    b24.items = [item(42, 15000.5, 10)]
    const body = jwt(payment({ id: 'p6', amount: '15000.50' }))
    await Promise.all([post(body), post(body), post(body)])
    await queue.idle()
    expect(b24.paidIds()).toEqual([42])
  })

  it('ответ 200 уходит до обработки: медленный Б24 не задерживает Точку', async () => {
    b24.items = [item(42, 15000.5, 10)]
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const orig = b24.call.bind(b24)
    b24.call = async (m, p) => {
      await gate
      return orig(m, p)
    }
    const status = await fetch(url, { method: 'POST', body: jwt(payment({ id: 'p6b', amount: '15000.50' })) }).then((r) => r.status)
    expect(status).toBe(200)
    expect(b24.calls).toEqual([]) // обработка ещё не началась
    release()
    await queue.idle()
    expect(b24.paidIds()).toEqual([42])
  })

  it('режим «только пометки»: уровень 1 пишет в таймлайн, но не закрывает', async () => {
    await stop()
    await start({}, false)
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p6c', amount: '15000.50' })))).toBe(200)
    expect(b24.updates()).toEqual([])
    expect(b24.comments()[0].COMMENT).toContain('только пометки')
    expect(b24.notes()).toHaveLength(1)
    expect(b24.notes()[0]).toContain('закройте вручную')
    expect(Object.values(JSON.parse(readFileSync(journalPath, 'utf8')))).toMatchObject([{ result: 'observed', invoiceId: 42 }])
  })

  it('счёт сменил статус руками между выборкой и закрытием → не закрываем, на проверку', async () => {
    b24.items = [item(42, 15000.5, 10)]
    const origCall = b24.call.bind(b24)
    b24.call = async (m, p) => {
      if (m === 'crm.item.get') b24.items[0].stageId = PAID
      return origCall(m, p)
    }
    expect(await post(jwt(payment({ id: 'p7', amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    expect(b24.comments()[0].COMMENT).toContain('Требует проверки')
  })

  it('сбой Б24 → платёж не записан в журнал; повторная доставка доводит дело', async () => {
    b24.items = [item(42, 15000.5, 10)]
    const body = jwt(payment({ id: 'p8', amount: '15000.50' }))
    b24.failOn = 'crm.item.update'
    expect(await post(body)).toBe(200)
    expect(journal.size()).toBe(0)
    expect(logLines.some((l) => l.includes('payment.failed'))).toBe(true)
    b24.failOn = null
    expect(await post(body)).toBe(200)
    expect(b24.paidIds()).toEqual([42])
  })

  it('чужая подпись, alg=none и мусор → 401, в Б24 ничего не уходит, в логе «отклонён, подпись»', async () => {
    b24.items = [item(42, 15000.5, 10)]
    const p = payment({ id: 'p9', amount: '15000.50' })
    expect(await post(jwt(p, other.privateKey))).toBe(401)
    expect(await post(jwt(p, privateKey, 'none'))).toBe(401)
    expect(await post('not a jwt')).toBe(401)
    expect(b24.calls).toEqual([])
    expect(logLines.filter((l) => l.includes('"event":"webhook.rejected","reason":"signature"'))).toHaveLength(3)
  })

  it.each([
    ['чужой iss', { iss: 'evil', aud: AUD, exp: Math.floor(Date.now() / 1000) + 300 }],
    ['чужой aud', { iss: ISS, aud: 'evil', exp: Math.floor(Date.now() / 1000) + 300 }],
    ['просрочен exp', { iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) - 10 }],
  ])('валидная подпись, но %s → 401', async (_, claims) => {
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p9b', amount: '15000.50' }), privateKey, 'RS256', claims))).toBe(401)
    expect(b24.calls).toEqual([])
  })

  it(`${SIGNATURE_ALERT_AFTER} отказов подписи подряд → одно уведомление; успешный вебхук сбрасывает счётчик`, async () => {
    const bad = jwt(payment({ id: 'x', amount: '1.00' }), other.privateKey)
    for (let i = 0; i < SIGNATURE_ALERT_AFTER - 1; i++) await post(bad)
    await post(jwt({ webhookType: 'outgoingPayment' }))
    for (let i = 0; i < SIGNATURE_ALERT_AFTER - 1; i++) await post(bad)
    expect(alerts).toBe(0)
    for (let i = 0; i < SIGNATURE_ALERT_AFTER + 2; i++) await post(bad)
    expect(alerts).toBe(1)
  })

  it('поступление на чужой р/с и не-incomingPayment → игнор', async () => {
    b24.items = [item(42, 15000.5, 10)]
    expect(await post(jwt(payment({ id: 'p10', amount: '15000.50', account: '40702810000000099999' })))).toBe(200)
    expect(await post(jwt({ webhookType: 'outgoingPayment', operationId: 'p11' }))).toBe(200)
    expect(b24.calls).toEqual([])
  })

  describe('два юрлица: матчинг по тому, на чей р/с пришли деньги', () => {
    const TWO: Accounts = [
      { id: `${ACCOUNT}/${BIC}`, entity: OOO },
      { id: `${ACCOUNT_IP}/${BIC}`, entity: IP },
    ]
    beforeEach(async () => {
      await stop()
      await start({}, true, TWO)
    })

    it('клиент с открытыми счетами у обоих юрлиц на одну сумму → закрывается счёт юрлица-получателя', async () => {
      b24.items = [item(42, 15000.5, 10, { mycompanyId: OOO }), item(43, 15000.5, 10, { mycompanyId: IP, stageId: AUTO_IP })]
      expect(await post(jwt(payment({ id: 'e1', amount: '15000.50', account: ACCOUNT_IP })))).toBe(200)
      expect(b24.paidIds()).toEqual([43])
      expect(b24.of('crm.item.list')[0].params.select).toContain('mycompanyId')
    })

    it('деньги пришли ИП, а счёт выставлен от ООО → не закрываем, уровень 2 «другое юрлицо»', async () => {
      b24.items = [item(42, 15000.5, 10, { mycompanyId: OOO })]
      expect(await post(jwt(payment({ id: 'e2', amount: '15000.50', account: ACCOUNT_IP })))).toBe(200)
      expect(b24.paidIds()).toEqual([])
      expect(b24.comments()[0].COMMENT).toContain('Случай: другое юрлицо')
      expect(b24.notes()).toHaveLength(1)
    })

    it('счёт без «Моей компании» не закрывается автоматически, а уходит на проверку', async () => {
      b24.items = [item(42, 15000.5, 10)]
      expect(await post(jwt(payment({ id: 'e3', amount: '15000.50' })))).toBe(200)
      expect(b24.paidIds()).toEqual([])
      expect(b24.comments()[0].COMMENT).toContain('Случай: другое юрлицо')
    })

    it('поступление на третий, не наш р/с → игнор', async () => {
      b24.items = [item(42, 15000.5, 10, { mycompanyId: OOO })]
      expect(await post(jwt(payment({ id: 'e4', amount: '15000.50', account: '40702810000000099999' })))).toBe(200)
      expect(b24.calls).toEqual([])
    })
  })

  it.each([
    ['Авто ООО', AUTO_OOO],
    ['Авто ИП', AUTO_IP],
    ['Клиент прочитал', READ],
    ['Платёж просрочен', OVERDUE],
  ])('«%s» — в поиске: ИНН+сумма → закрываем', async (_, stageId) => {
    b24.items = [item(42, 15000.5, 10, { stageId })]
    expect(await post(jwt(payment({ id: `p20-${stageId}`, amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([42])
  })

  it('в Б24 уходит фильтр по STATUS_ID четырёх стадий, а не по названиям', async () => {
    b24.items = [item(42, 15000.5, 10)]
    await post(jwt(payment({ id: 'p21', amount: '15000.50' })))
    expect(b24.of('crm.item.list')[0].params).toMatchObject({ entityTypeId: 31, filter: { '@stageId': SEARCH } })
  })

  it.each([
    ['Новый', NEW],
    ['Сомнения', DOUBT],
    ['Не оплачен', NOT_PAID],
    ['Оплачен', PAID],
  ])('совпадение только со счётом в «%s» → не найден, уровень 3; счёт не тронут', async (_, stageId) => {
    b24.items = [item(42, 15000.5, 10, { stageId })]
    expect(await post(jwt(payment({ id: `p24-${stageId}`, amount: '15000.50' })))).toBe(200)
    expect(b24.updates()).toEqual([])
    expect(b24.comments()).toEqual([])
    expect(b24.tasks()).toHaveLength(1)
  })

  it('счета вне поиска не создают неоднозначности: закрывается единственный в стадиях ожидания', async () => {
    b24.items = [
      item(40, 15000.5, 10, { stageId: PAID }),
      item(41, 15000.5, 10, { stageId: NOT_PAID }),
      item(43, 15000.5, 10, { stageId: DOUBT }),
      item(44, 15000.5, 10, { stageId: NEW }),
      item(42, 15000.5, 10, { stageId: READ }),
    ]
    expect(await post(jwt(payment({ id: 'p25', amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([42])
    expect(b24.updates()).toHaveLength(1)
  })

  it('портал проигнорировал фильтр → локальный фильтр по STATUS_ID всё равно отсекает чужие стадии', async () => {
    b24.ignoreFilter = true
    b24.items = [item(41, 15000.5, 10, { stageId: NOT_PAID }), item(42, 15000.5, 10, { stageId: AUTO_IP })]
    expect(await post(jwt(payment({ id: 'p29', amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([42])
  })

  it('переименование стадии в интерфейсе Б24 ничего не ломает — важен только ID', async () => {
    STAGE_NAMES[OVERDUE] = 'Просрочка (переименовано)'
    try {
      b24.items = [item(42, 15000.5, 10, { stageId: OVERDUE })]
      expect(await post(jwt(payment({ id: 'p30', amount: '15000.50' })))).toBe(200)
      expect(b24.paidIds()).toEqual([42])
    } finally {
      STAGE_NAMES[OVERDUE] = 'Платёж просрочен'
    }
  })

  it('конфиг: пустой список стадий, «Оплачен» среди стадий поиска или нет entityTypeId → отказ при старте', () => {
    const base = { entityTypeId: 31, paidStage: PAID, responsibleId: 7 }
    expect(() => new B24InvoiceStore(b24, { ...base, searchStages: [] })).toThrow()
    expect(() => new B24InvoiceStore(b24, { ...base, searchStages: [...SEARCH, PAID] })).toThrow()
    expect(() => new B24InvoiceStore(b24, { ...base, entityTypeId: NaN, searchStages: SEARCH })).toThrow()
  })

  it('уровень 2: в карточке даты выставления и текущие стадии кандидатов, дата платежа', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 15000.5, 10, { stageId: OVERDUE })]
    expect(await post(jwt(payment({ id: 'p22', amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    const text = b24.comments()[0].COMMENT
    expect(text).toContain('СЧ-0042 (id 42) от 2026-09-15, стадия «Авто ООО: отправка, счёт и акт»')
    expect(text).toContain('СЧ-0043 (id 43) от 2026-09-16, стадия «Платёж просрочен»')
    expect(text).toContain('Дата платежа: 2026-09-30')
  })

  it('названия стадий не получены → в карточке ID стадии, платёж не теряется', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 15000.5, 10, { stageId: OVERDUE })]
    b24.failOn = 'crm.status.list'
    expect(await post(jwt(payment({ id: 'p26', amount: '15000.50' })))).toBe(200)
    expect(b24.comments()[0].COMMENT).toContain(`стадия «${OVERDUE}»`)
  })

  it.each([
    ['Сомнения', DOUBT],
    ['Не оплачен', NOT_PAID],
  ])('человек перевёл счёт в «%s» между выборкой и закрытием → не закрываем, на проверку', async (_, stageId) => {
    b24.items = [item(42, 15000.5, 10)]
    const origCall = b24.call.bind(b24)
    b24.call = async (m, p) => {
      if (m === 'crm.item.get') b24.items[0].stageId = stageId
      return origCall(m, p)
    }
    expect(await post(jwt(payment({ id: `p27-${stageId}`, amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([])
    expect(b24.comments()[0].COMMENT).toContain('Случай: стадия сменилась')
  })

  it('робот перевёл счёт в «Просрочен» между выборкой и закрытием → всё равно закрываем', async () => {
    b24.items = [item(42, 15000.5, 10)]
    const origCall = b24.call.bind(b24)
    b24.call = async (m, p) => {
      if (m === 'crm.item.get') b24.items[0].stageId = OVERDUE
      return origCall(m, p)
    }
    expect(await post(jwt(payment({ id: 'p23', amount: '15000.50' })))).toBe(200)
    expect(b24.paidIds()).toEqual([42])
  })

  it('кэш «компания → ИНН» — реквизиты не запрашиваются на каждый платёж', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 9000, 10)]
    await post(jwt(payment({ id: 'p31', amount: '15000.50' })))
    await post(jwt(payment({ id: 'p32', amount: '9000.00' })))
    expect(b24.paidIds()).toEqual([42, 43])
    expect(b24.of('crm.requisite.list')).toHaveLength(1)
  })

  it('в логах и в журнале нет сумм, номеров счетов, назначений, ИНН и р/с', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 15000.5, 20), item(44, 777, 20)]
    await post(jwt(payment({ id: 'p12', amount: '15000.50' })))                // уровень 1
    await post(jwt(payment({ id: 'p13', inn: INN_B, amount: '15000.50' })))    // уровень 1 (другой ИНН)
    b24.items.push(item(45, 777, 20))
    await post(jwt(payment({ id: 'p14', inn: INN_B, amount: '7.77' })))        // уровень 2 (частичная)
    await post(jwt(payment({ id: 'p15', inn: null, amount: '3.33' })))         // уровень 3
    b24.failOn = 'crm.item.list'
    await post(jwt(payment({ id: 'p16', amount: '15000.50' })))                // ошибка Б24

    expect(logLines.length).toBeGreaterThan(0)
    const journalRaw = readFileSync(journalPath, 'utf8')
    const haystack = logLines.join('\n') + journalRaw
    const forbidden = ['15000', '1500050', '15 000', '7.77', '7,77', '3.33', 'СЧ-00', 'консультац', PURPOSE, INN_A, INN_B, ACCOUNT, '40702810111111111111', 'Ромашка', 'p12', 'p13', 'p14', 'p15', 'p16']
    for (const f of forbidden) expect(haystack, `утечка «${f}»`).not.toContain(f)
    // журнал — поля §6 + fp (HMAC-отпечаток; у платежа без ИНН его нет)
    for (const e of Object.values(JSON.parse(journalRaw)) as Record<string, unknown>[]) {
      expect(Object.keys(e).filter((k) => k !== 'fp').sort()).toEqual(['at', 'invoiceId', 'result'])
      if ('fp' in e) expect(e.fp).toMatch(/^[0-9a-f]{64}$/)
    }
    // но уровни в лог попали — лог полезен
    expect(logLines.some((l) => l.includes('"level":1'))).toBe(true)
    expect(logLines.some((l) => l.includes('"level":3'))).toBe(true)
  })
})

describe('журнал идемпотентности', () => {
  it(`записи старше ${JOURNAL_TTL_DAYS} дней удаляются`, () => {
    let now = Date.parse('2026-01-01T00:00:00Z')
    const j = new FileJournal({ path: journalPath, secret: 's', now: () => now })
    j.record('old', 'closed', 1)
    now += (JOURNAL_TTL_DAYS - 1) * 86_400_000
    j.record('fresh', 'review', null)
    expect(j.has('old')).toBe(true)
    now += 2 * 86_400_000
    const reopened = new FileJournal({ path: journalPath, secret: 's', now: () => now })
    expect(reopened.has('old')).toBe(false)
    expect(reopened.has('fresh')).toBe(true)
    expect(reopened.size()).toBe(1)
  })

  it('отпечаток: «видели» только в пределах окна и только тот же отпечаток', () => {
    let now = Date.parse('2026-01-01T00:00:00Z')
    const j = new FileJournal({ path: journalPath, secret: 's', now: () => now })
    j.record('op', 'closed', 1, '|7707083893|1500050')
    expect(j.seen('|7707083893|1500050', 3 * 86_400_000)).toBe(true)
    expect(j.seen('|7707083893|1500051', 3 * 86_400_000)).toBe(false)
    now += 4 * 86_400_000
    expect(j.seen('|7707083893|1500050', 3 * 86_400_000)).toBe(false)
  })
})

describe('сверка раз в сутки', () => {
  class FakeTochka implements TochkaApi {
    txs: Record<string, any>[] = []
    hooks = { list: ['incomingPayment'], url: 'https://owner.example/tochka/webhook' }
    subscribed: string[] = []
    fail = false
    async statement(_accountId: string) {
      if (this.fail) throw new TochkaError('http_503')
      return this.txs
    }
    async webhooks(_clientId: string) {
      return this.hooks
    }
    async subscribe(_: string, url: string) {
      this.subscribed.push(url)
      this.hooks = { list: ['incomingPayment'], url }
    }
  }

  const tx = (id: string, amount: string, inn = INN_A) => ({
    transactionId: id,
    creditDebitIndicator: 'Credit',
    Amount: { amount, currency: 'RUB' },
    DebtorParty: { inn, name: 'ООО «Ромашка»' },
    description: PURPOSE,
    documentProcessDate: '2026-09-30',
  })

  const run = (api: FakeTochka, accounts: { id: string; entity: number | null }[] = [{ id: `${ACCOUNT}/${BIC}`, entity: null }]) =>
    reconcile({
      sources: [{ key: 'main', name: 'Точка', api, clientId: 'cid', accounts }],
      webhookUrl: 'https://owner.example/tochka/webhook',
      submit: queue.push,
      notify: (t) => b24.call('im.notify.system.add', { USER_ID: 7, MESSAGE: t }).then(() => undefined),
      log: makeLogger((l) => logLines.push(l)),
    })

  it('пропущенный вебхук → сверка закрывает счёт (уровень 1); уже обработанное пропускается', async () => {
    b24.items = [item(42, 15000.5, 10), item(43, 9000, 10)]
    await post(jwt(payment({ id: 'op-1', amount: '9000.00' }))) // этот дошёл вебхуком
    const api = new FakeTochka()
    api.txs = [tx('op-1', '9000.00'), tx('op-2', '15000.50'), { ...tx('op-3', '500.00'), creditDebitIndicator: 'Debit' }]
    await run(api)
    expect(b24.paidIds()).toEqual([43, 42])
    // только сообщения об оплате (вебхук + сверка), сбоев нет
    expect(b24.notes()).toHaveLength(2)
    expect(b24.notes().every((n) => n.includes('Поступила оплата'))).toBe(true)
    expect(api.subscribed).toEqual([])
  })

  it('ключ операции в выписке не совпал с ключом вебхука → второй счёт того же ИНН на ту же сумму НЕ закрывается', async () => {
    b24.items = [item(42, 15000.5, 10)]
    await post(jwt(payment({ id: 'webhook-key', amount: '15000.50' }))) // закрыл 42
    b24.items.push(item(43, 15000.5, 10)) // клиенту выставили следующий счёт на ту же сумму
    const api = new FakeTochka()
    api.txs = [tx('statement-key', '15000.50')] // тот же платёж, но под другим ключом
    await run(api)
    expect(b24.paidIds()).toEqual([42])
    expect(b24.items.find((i) => i.id === 43)!.stageId).toBe(AUTO_OOO)
    const c = b24.comments().filter((x) => x.ENTITY_ID === 43)
    expect(c).toHaveLength(1)
    expect(c[0].COMMENT).toContain('Случай: возможный повтор')
  })

  it('два юрлица: выписка по каждому р/с, платёж матчится среди счетов своего юрлица; сбой одного счёта не мешает другому', async () => {
    b24.items = [item(42, 15000.5, 10, { mycompanyId: OOO }), item(43, 15000.5, 10, { mycompanyId: IP })]
    const api = new FakeTochka()
    const asked: string[] = []
    api.statement = async (accountId: string) => {
      asked.push(accountId)
      if (accountId.startsWith(ACCOUNT)) throw new TochkaError('http_503')
      return [tx('op-ip', '15000.50')]
    }
    await run(api, [
      { id: `${ACCOUNT}/${BIC}`, entity: OOO },
      { id: `${ACCOUNT_IP}/${BIC}`, entity: IP },
    ])
    expect(asked).toEqual([`${ACCOUNT}/${BIC}`, `${ACCOUNT_IP}/${BIC}`])
    expect(b24.paidIds()).toEqual([43])
    expect(b24.notes().filter((n) => n.includes('сверка не выполнена'))).toHaveLength(1)
  })

  it('отозванная подписка → переподписались и уведомили', async () => {
    const api = new FakeTochka()
    api.hooks = { list: [], url: '' }
    await run(api)
    expect(api.subscribed).toEqual(['https://owner.example/tochka/webhook'])
    expect(b24.notes().some((n) => n.includes('переподписались'))).toBe(true)
  })

  it('два приложения Точки (ООО и ИП): выписка и подписка — каждым своим токеном и client_id', async () => {
    b24.items = [item(42, 15000.5, 10, { mycompanyId: OOO }), item(43, 15000.5, 10, { mycompanyId: IP })]
    const ooo = new FakeTochka()
    const ip = new FakeTochka()
    ooo.txs = [tx('op-ooo', '15000.50')]
    ip.hooks = { list: [], url: '' } // у ИП подписку отозвали
    const clients: string[] = []
    ip.webhooks = async (clientId: string) => (clients.push(clientId), ip.hooks)
    await reconcile({
      sources: [
        { key: 'ooo', name: 'ООО', api: ooo, clientId: 'c-ooo', accounts: [{ id: `${ACCOUNT}/${BIC}`, entity: OOO }] },
        { key: 'ip', name: 'ИП', api: ip, clientId: 'c-ip', accounts: [{ id: `${ACCOUNT_IP}/${BIC}`, entity: IP }] },
      ],
      webhookUrl: 'https://owner.example/tochka/webhook',
      submit: queue.push,
      notify: (t) => b24.call('im.notify.system.add', { USER_ID: 7, MESSAGE: t }).then(() => undefined),
      log: makeLogger((l) => logLines.push(l)),
    })
    expect(b24.paidIds()).toEqual([42]) // платёж на р/с ООО закрыл счёт ООО, счёт ИП не тронут
    expect(clients).toEqual(['c-ip'])
    expect(ooo.subscribed).toEqual([])
    expect(ip.subscribed).toEqual(['https://owner.example/tochka/webhook'])
    expect(b24.notes().filter((n) => n.includes('(ИП): подписка'))).toHaveLength(1)
  })

  it('Точка недоступна → уведомление ответственному, в логе без данных платежей', async () => {
    const api = new FakeTochka()
    api.fail = true
    await run(api)
    expect(b24.notes().some((n) => n.includes('сверка не выполнена'))).toBe(true)
    expect(logLines.some((l) => l.includes('"error":"tochka:http_503"'))).toBe(true)
  })
})

describe('ключи Точки (JWKS)', () => {
  it('кэшируются на час; при недоступности Точки — последние известные', async () => {
    let now = 0
    let calls = 0
    let up = true
    const jwks = JSON.stringify({ keys: [publicKey.export({ format: 'jwk' })] })
    const f = (async () => {
      calls++
      if (!up) throw new Error('down')
      return new Response(jwks)
    }) as unknown as typeof fetch
    const src = jwksKeys('https://jwks.test', f, 3_600_000, () => now)
    expect(await src.keys()).toHaveLength(1)
    now += 59 * 60_000
    await src.keys()
    expect(calls).toBe(1)
    now += 2 * 60_000
    up = false
    expect(await src.keys()).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it('JWKS недоступен и кэша нет → 503 (Точка повторит), а не 401', async () => {
    await stop()
    const failing = jwksKeys('https://jwks.test', (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch)
    server = createApp({ keys: failing, jwt: {}, path: '/tochka/webhook', submit: queue.push, log: makeLogger(() => {}) })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tochka/webhook`
    expect(await post(jwt(payment({ id: 'k1', amount: '1.00' })))).toBe(503)
  })
})

describe('Б24: локальное приложение (OAuth)', () => {
  it('протухший access-токен обновляется refresh-токеном и сохраняется', async () => {
    const tokenFile = join(mkdtempSync(join(tmpdir(), 'tb24-')), 'tokens.json')
    writeFileSync(tokenFile, JSON.stringify({ access_token: 'old', refresh_token: 'r1' }))
    const seen: string[] = []
    const f = (async (input: any, init?: any) => {
      const u = String(input)
      if (u.startsWith('https://oauth.test')) {
        const q = new URL(u).searchParams
        expect(q.get('grant_type')).toBe('refresh_token')
        expect(q.get('refresh_token')).toBe('r1')
        return Response.json({ access_token: 'new', refresh_token: 'r2' })
      }
      const auth = JSON.parse(init.body).auth
      seen.push(`${u}#${auth}`)
      if (auth === 'old') return Response.json({ error: 'expired_token' }, { status: 401 })
      return Response.json({ result: { ok: true } })
    }) as unknown as typeof fetch
    const rest = oauthRest({ portal: 'https://owner.bitrix24.ru/', clientId: 'c', clientSecret: 's', tokenFile, fetchImpl: f, oauthUrl: 'https://oauth.test/token/' })
    expect((await rest.call('crm.item.get', { id: 1 })).result).toEqual({ ok: true })
    expect(seen).toEqual(['https://owner.bitrix24.ru/rest/crm.item.get.json#old', 'https://owner.bitrix24.ru/rest/crm.item.get.json#new'])
    expect(JSON.parse(readFileSync(tokenFile, 'utf8'))).toEqual({ access_token: 'new', refresh_token: 'r2' })
  })
})
