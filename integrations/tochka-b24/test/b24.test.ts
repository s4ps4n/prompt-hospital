// Клиент Б24 на уровне HTTP: настоящий oauthRest + B24InvoiceStore против подставного портала (локальный HTTP-сервер).
// Каждый вызов REST проверяется по адресу метода и телу запроса; STATUS_ID и прочее — только из конфига.

import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B24InvoiceStore, endOfDay, oauthRest, writeTokens, type B24Config } from '../src/b24.ts'
import { FileJournal } from '../src/journal.ts'
import { B24Error, makeLogger } from '../src/log.ts'
import type { Invoice, Payment } from '../src/matcher.ts'
import { makeProcessor } from '../src/processor.ts'

const INN_CO = '7707083893'
const INN_CO2 = '7702070139'
const INN_PERSON = '500100732259'
// Нарочно необычные ID: если бы код где-то подставлял свои стадии, тесты бы это поймали.
const WAIT_A = 'DT31_7:UC_X1'
const WAIT_B = 'DT31_7:UC_X2'
const HUMAN = 'DT31_7:UC_X3'
const PAID = 'DT31_7:UC_X9'

type Call = { method: string; body: any }
type Handler = (body: any) => { status?: number; json: unknown }

let server: Server
let portal: string
let calls: Call[]
let routes: Record<string, Handler>

beforeEach(async () => {
  calls = []
  routes = {}
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const method = /^\/rest\/(.+)\.json$/.exec(req.url ?? '')?.[1] ?? ''
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      calls.push({ method, body })
      const h = routes[method]
      const r = h ? h(body) : { status: 400, json: { error: 'ERROR_METHOD_NOT_FOUND' } }
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(r.json))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  portal = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => new Promise<void>((r) => server.close(() => r())))

function rest() {
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'tb24-http-')), 'b24.json')
  writeTokens(tokenFile, { access_token: 'acc-1', refresh_token: 'ref-1' })
  return oauthRest({ portal, clientId: 'c', clientSecret: 's', tokenFile, oauthUrl: 'http://127.0.0.1:1/never' })
}

const CFG: B24Config = {
  entityTypeId: 31,
  categoryId: 7,
  paidStage: PAID,
  searchStages: [WAIT_A, WAIT_B],
  paidDateField: 'ufCrm_PAID_AT',
  reviewField: 'ufCrm_REVIEW',
  responsibleId: 15,
  portal: 'https://owner.bitrix24.ru',
  listTtlMs: 0,
}

const store = (extra: Partial<B24Config> = {}) => new B24InvoiceStore(rest(), { ...CFG, ...extra })

const of = (method: string) => calls.filter((c) => c.method === method)

const inv = (o: Partial<Invoice> = {}): Invoice => ({ id: 42, number: 'СЧ-42', amountKop: 1_500_050, issuedAt: '2026-09-20', stage: 'x', inns: [INN_CO], dealId: null, entity: null, ...o })

const raw = (id: number, o: Record<string, unknown> = {}) => ({
  id,
  accountNumber: `СЧ-${id}`,
  opportunity: 15000.5,
  currencyId: 'RUB',
  stageId: WAIT_A,
  categoryId: 7,
  begindate: '2026-09-20T00:00:00+03:00',
  companyId: 0,
  contactId: 0,
  parentId2: 0,
  mycompanyId: 0,
  ...o,
})

describe('список счетов: crm.item.list по STATUS_ID из конфига', () => {
  beforeEach(() => {
    routes['crm.requisite.list'] = () => ({ json: { result: [] } })
    routes['crm.status.list'] = () => ({ json: { result: [] } })
  })

  it('запрос: смарт-процесс из конфига, фильтр @stageId = searchStages и categoryId, access-токен в auth', async () => {
    routes['crm.item.list'] = () => ({ json: { result: { items: [raw(1)] } } })
    await store().listOpen()
    expect(of('crm.item.list')).toHaveLength(1)
    const b = of('crm.item.list')[0].body
    expect(b.auth).toBe('acc-1')
    expect(b.entityTypeId).toBe(31)
    expect(b.filter).toEqual({ '@stageId': [WAIT_A, WAIT_B], categoryId: 7 })
    expect(b.select).toEqual(expect.arrayContaining(['id', 'stageId', 'opportunity', 'companyId', 'contactId', 'mycompanyId', 'parentId2']))
    // Ни названий стадий, ни «Оплачен» в запросе нет.
    expect(JSON.stringify(b)).not.toContain(PAID)
    expect(JSON.stringify(b)).not.toMatch(/[А-Яа-я]/)
  })

  it('другой конфиг — другие STATUS_ID и entityTypeId в запросе (ничего не зашито)', async () => {
    routes['crm.item.list'] = () => ({ json: { result: { items: [] } } })
    await store({ entityTypeId: 1040, categoryId: undefined, searchStages: ['DT1040_3:NEW_WAIT'], paidStage: 'DT1040_3:SUCCESS' }).listOpen()
    const b = of('crm.item.list')[0].body
    expect(b.entityTypeId).toBe(1040)
    expect(b.filter).toEqual({ '@stageId': ['DT1040_3:NEW_WAIT'] })
  })

  it('постранично по next; портал вернул счёт чужой стадии — локальный фильтр его отбрасывает', async () => {
    routes['crm.item.list'] = (b) =>
      b.start === 0
        ? { json: { result: { items: [raw(1), raw(2, { stageId: HUMAN })] }, next: 50 } }
        : { json: { result: { items: [raw(3, { stageId: WAIT_B }), raw(4, { stageId: PAID })] } } }
    const list = await store().listOpen()
    expect(of('crm.item.list').map((c) => c.body.start)).toEqual([0, 50])
    expect(list.map((i) => i.id)).toEqual([1, 3])
  })

  it('валюта не RUB и мусорная сумма — не кандидаты', async () => {
    routes['crm.item.list'] = () => ({ json: { result: { items: [raw(1, { currencyId: 'USD' }), raw(2, { opportunity: 0 }), raw(3)] } } })
    expect((await store().listOpen()).map((i) => i.id)).toEqual([3])
  })

  it('названия стадий — crm.status.list по ENTITY_ID воронки, только для текста человеку', async () => {
    routes['crm.item.list'] = () => ({ json: { result: { items: [raw(1)] } } })
    routes['crm.status.list'] = () => ({ json: { result: [{ STATUS_ID: WAIT_A, NAME: 'Ждём оплату' }] } })
    const [i] = await store().listOpen()
    expect(of('crm.status.list')[0].body.filter).toEqual({ ENTITY_ID: 'SMART_INVOICE_STAGE_7' })
    expect(i.stage).toBe('Ждём оплату')
  })
})

describe('цепочка ИНН: счёт → компания/контакт → crm.requisite.list (RQ_INN)', () => {
  it('ИНН компании и контакта собираются в счёт; реквизиты — одним запросом на тип владельца', async () => {
    routes['crm.item.list'] = () => ({
      json: { result: { items: [raw(1, { companyId: 10 }), raw(2, { companyId: 20, contactId: 5 }), raw(3, { companyId: 10 })] } },
    })
    routes['crm.status.list'] = () => ({ json: { result: [] } })
    routes['crm.requisite.list'] = (b) => ({
      json: {
        result:
          b.filter.ENTITY_TYPE_ID === 4
            ? [
                { ENTITY_ID: '10', RQ_INN: INN_CO },
                { ENTITY_ID: '20', RQ_INN: ` ${INN_CO2} ` },
                { ENTITY_ID: '20', RQ_INN: '1234567890' }, // битая контрольная сумма — отбрасывается
              ]
            : [{ ENTITY_ID: '5', RQ_INN: INN_PERSON }],
      },
    })
    const list = await store().listOpen()

    const req = of('crm.requisite.list').map((c) => c.body)
    expect(req).toHaveLength(2)
    expect(req[0]).toMatchObject({ filter: { ENTITY_TYPE_ID: 4, ENTITY_ID: [10, 20] }, select: ['ENTITY_ID', 'RQ_INN'] })
    expect(req[1]).toMatchObject({ filter: { ENTITY_TYPE_ID: 3, ENTITY_ID: [5] } })
    expect(list.map((i) => i.inns)).toEqual([[INN_CO], [INN_CO2, INN_PERSON], [INN_CO]])
  })

  it('счёт без компании и контакта — реквизиты не запрашиваются, ИНН пуст', async () => {
    routes['crm.item.list'] = () => ({ json: { result: { items: [raw(1)] } } })
    routes['crm.status.list'] = () => ({ json: { result: [] } })
    const [i] = await store().listOpen()
    expect(of('crm.requisite.list')).toEqual([])
    expect(i.inns).toEqual([])
  })
})

describe('запись в Б24', () => {
  it('«Оплачен»: crm.item.update со stageId из конфига и датой оплаты', async () => {
    routes['crm.item.update'] = () => ({ json: { result: { item: {} } } })
    await store().markPaid(inv(), '2026-09-30')
    expect(of('crm.item.update').map((c) => c.body)).toEqual([
      { entityTypeId: 31, id: 42, fields: { stageId: PAID, ufCrm_PAID_AT: '2026-09-30' }, auth: 'acc-1' },
    ])
  })

  it('«Оплачен» без поля даты в конфиге — меняется только стадия', async () => {
    routes['crm.item.update'] = () => ({ json: { result: { item: {} } } })
    await store({ paidDateField: undefined, paidStage: 'DT31_7:OTHER_PAID' }).markPaid(inv(), '2026-09-30')
    expect(of('crm.item.update')[0].body.fields).toEqual({ stageId: 'DT31_7:OTHER_PAID' })
  })

  it('перепроверка стадии: crm.item.get; в поиске → open, иначе → left', async () => {
    let stage = WAIT_B
    routes['crm.item.get'] = () => ({ json: { result: { item: { id: 42, stageId: stage } } } })
    const s = store()
    expect(await s.recheck(42)).toBe('open')
    stage = HUMAN
    expect(await s.recheck(42)).toBe('left')
    expect(of('crm.item.get')[0].body).toMatchObject({ entityTypeId: 31, id: 42 })
  })

  it('комментарий: crm.timeline.comment.add в счёт (smart_invoice) и в сделку, если она есть', async () => {
    routes['crm.timeline.comment.add'] = () => ({ json: { result: 1 } })
    await store().comment(inv({ dealId: 900 }), 'текст')
    expect(of('crm.timeline.comment.add').map((c) => c.body.fields)).toEqual([
      { ENTITY_TYPE: 'smart_invoice', ENTITY_ID: 42, COMMENT: 'текст' },
      { ENTITY_TYPE: 'deal', ENTITY_ID: 900, COMMENT: 'текст' },
    ])
  })

  it('пометка «проверить»: UF-флаг из конфига + комментарий', async () => {
    routes['crm.item.update'] = () => ({ json: { result: { item: {} } } })
    routes['crm.timeline.comment.add'] = () => ({ json: { result: 1 } })
    await store().flagForReview(inv(), 'почему')
    expect(of('crm.item.update')[0].body).toMatchObject({ id: 42, fields: { ufCrm_REVIEW: 'Y' } })
    expect(of('crm.item.update')[0].body.fields).not.toHaveProperty('stageId')
    expect(of('crm.timeline.comment.add')[0].body.fields.COMMENT).toBe('почему')
  })

  it('задача: tasks.task.add на ответственного из конфига, срок — конец сегодняшнего дня', async () => {
    routes['tasks.task.add'] = () => ({ json: { result: { task: { id: 1 } } } })
    const now = Date.parse('2026-09-30T10:00:00Z')
    await store({ now: () => now }).addTask('Заголовок', 'Описание')
    expect(of('tasks.task.add')[0].body.fields).toEqual({ TITLE: 'Заголовок', DESCRIPTION: 'Описание', RESPONSIBLE_ID: 15, DEADLINE: endOfDay(now) })
  })

  it('сообщение: im.notify.system.add ответственному; с notifyDialogId — im.message.add в чат', async () => {
    routes['im.notify.system.add'] = () => ({ json: { result: 1 } })
    routes['im.message.add'] = () => ({ json: { result: 1 } })
    await store().notify('a')
    await store({ notifyDialogId: 'chat77' }).notify('b')
    expect(of('im.notify.system.add')[0].body).toMatchObject({ USER_ID: 15, MESSAGE: 'a' })
    expect(of('im.message.add')[0].body).toMatchObject({ DIALOG_ID: 'chat77', MESSAGE: 'b' })
  })

  it('ошибка Б24 → B24Error с кодом портала; HTTP 500 без тела → http_500', async () => {
    routes['crm.item.update'] = () => ({ status: 503, json: { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' } })
    await expect(store().markPaid(inv(), '2026-09-30')).rejects.toMatchObject({ code: 'QUERY_LIMIT_EXCEEDED' })
    routes['tasks.task.add'] = () => ({ status: 500, json: null })
    const e = await store().addTask('t', 'd').catch((x) => x)
    expect(e).toBeInstanceOf(B24Error)
    expect(e.code).toBe('http_500')
  })
})

describe('платёж → REST Б24 (процессор поверх HTTP)', () => {
  const pay = (o: Partial<Payment> = {}): Payment => ({ key: 'op-777', entity: null, payerInn: INN_CO, payerName: 'ООО «Ромашка»', amountKop: 1_500_050, purpose: 'оплата', date: '2026-09-30', ...o })

  let items: ReturnType<typeof raw>[]
  const run = (p: Payment) => {
    const journal = new FileJournal({ path: null, secret: 's' })
    return makeProcessor({ store: store(), journal, log: makeLogger(() => {}), autoClose: true })(p)
  }

  beforeEach(() => {
    items = [raw(42, { companyId: 10 })]
    routes['crm.item.list'] = () => ({ json: { result: { items } } })
    routes['crm.status.list'] = () => ({ json: { result: [] } })
    routes['crm.requisite.list'] = () => ({ json: { result: [{ ENTITY_ID: 10, RQ_INN: INN_CO }] } })
    routes['crm.item.get'] = (b) => ({ json: { result: { item: items.find((i) => i.id === b.id) } } })
    routes['crm.item.update'] = () => ({ json: { result: { item: {} } } })
    for (const m of ['crm.timeline.comment.add', 'tasks.task.add', 'im.notify.system.add']) routes[m] = () => ({ json: { result: 1 } })
  })

  it('уровень 1: список → реквизиты → перепроверка → «Оплачен» → комментарий «оплачен автоматически по платежу <operationId>»', async () => {
    expect(await run(pay())).toEqual({ status: 'closed', invoiceId: 42 })
    expect(calls.map((c) => c.method)).toEqual([
      'crm.item.list',
      'crm.requisite.list',
      'crm.status.list',
      'crm.item.get',
      'crm.item.update',
      'crm.timeline.comment.add',
      'im.notify.system.add',
    ])
    expect(of('crm.item.update')[0].body.fields.stageId).toBe(PAID)
    expect(of('crm.timeline.comment.add')[0].body.fields.COMMENT.toLowerCase()).toContain('оплачен автоматически по платежу op-777')
    expect(of('tasks.task.add')).toEqual([])
  })

  it('уровень 2 (несколько кандидатов): стадия не меняется, задача ответственному с кандидатами', async () => {
    items = [raw(42, { companyId: 10 }), raw(43, { companyId: 10 })]
    expect(await run(pay())).toEqual({ status: 'review', invoiceIds: [42, 43] })
    expect(of('crm.item.update').every((c) => !('stageId' in c.body.fields))).toBe(true)
    expect(of('tasks.task.add')).toHaveLength(1)
    const f = of('tasks.task.add')[0].body.fields
    expect(f.RESPONSIBLE_ID).toBe(15)
    expect(f.TITLE).toContain('несколько кандидатов')
    expect(f.DESCRIPTION).toContain('Операция в Точке: op-777')
    expect(f.DESCRIPTION).toContain('/crm/type/31/details/42/')
    expect(f.DESCRIPTION).toContain('/crm/type/31/details/43/')
  })

  it('уровень 2: сбой создания задачи не ведёт к повторной обработке (пометки уже стоят)', async () => {
    items = [raw(42, { companyId: 10 }), raw(43, { companyId: 10 })]
    routes['tasks.task.add'] = () => ({ status: 500, json: { error: 'ACCESS_DENIED' } })
    expect(await run(pay())).toEqual({ status: 'review', invoiceIds: [42, 43] })
    expect(of('crm.timeline.comment.add')).toHaveLength(2)
  })

  it('уровень 3 (у ИНН нет счетов в стадиях поиска): задача ответственному, счёт не тронут', async () => {
    expect(await run(pay({ payerInn: INN_CO2 }))).toEqual({ status: 'unresolved' })
    expect(of('crm.item.update')).toEqual([])
    expect(of('tasks.task.add')).toHaveLength(1)
    expect(of('tasks.task.add')[0].body.fields.DESCRIPTION).toContain('Операция в Точке: op-777')
  })
})
