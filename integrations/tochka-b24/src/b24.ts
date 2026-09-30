// Битрикс24: счета (смарт-процесс), реквизиты, таймлайн, задачи, уведомления.
// Доступ — локальное приложение портала (OAuth, права crm/task/im), НЕ входящий вебхук с правами на всю CRM.
// Платёжные данные уходят только на портал владельца — в его же CRM.

import type { Invoice } from './matcher.ts'
import { normalizeInn, toKopecks } from './money.ts'
import { B24Error } from './log.ts'
import { readTokens, writeTokens, type Tokens } from './tokens.ts'

export { writeTokens }

export interface B24Rest {
  call(method: string, params: Record<string, unknown>): Promise<{ result: any; next?: number }>
}

// ─── Транспорт: локальное приложение (OAuth) ─────────────────────────────────

export const B24_OAUTH_URL = 'https://oauth.bitrix.info/oauth/token/'

export type OAuthConfig = {
  /** https://<портал>.bitrix24.ru */
  portal: string
  clientId: string
  clientSecret: string
  /** Файл с токенами { access_token?, refresh_token } (0600, не в git). */
  tokenFile: string
  fetchImpl?: typeof fetch
  oauthUrl?: string
}

/** Ответ сервера авторизации; endpoint — REST-адрес портала, которому выданы токены. */
export type Exchanged = { access_token: string; refresh_token: string; endpoint?: string }

/** Токены выданы именно порталу владельца (а не чужому, куда тоже поставили приложение). */
export function isOwnPortal(endpoint: string | undefined, portal: string): boolean {
  try {
    return !!endpoint && new URL(endpoint).host === new URL(portal).host
  } catch {
    return false
  }
}

async function postJson(f: typeof fetch, url: string, body: unknown): Promise<any> {
  let res: Response
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new B24Error('network')
  }
  const data: any = await res.json().catch(() => null)
  if (!res.ok || !data || data.error) throw new B24Error(String(data?.error ?? `http_${res.status}`))
  return data
}

/** Обмен OAuth-кода или refresh-токена на пару токенов (сервер авторизации Битрикс24; платёжных данных там нет). */
export async function exchangeToken(
  cfg: Pick<OAuthConfig, 'clientId' | 'clientSecret' | 'fetchImpl' | 'oauthUrl'>,
  grant: { code: string } | { refresh_token: string },
): Promise<Exchanged> {
  const u = new URL(cfg.oauthUrl ?? B24_OAUTH_URL)
  u.searchParams.set('grant_type', 'code' in grant ? 'authorization_code' : 'refresh_token')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('client_secret', cfg.clientSecret)
  if ('code' in grant) u.searchParams.set('code', grant.code)
  else u.searchParams.set('refresh_token', grant.refresh_token)
  let data: any
  try {
    const res = await (cfg.fetchImpl ?? fetch)(u, { signal: AbortSignal.timeout(20_000) })
    data = await res.json()
  } catch {
    throw new B24Error('oauth_network')
  }
  if (!data?.access_token || !data?.refresh_token) throw new B24Error('oauth_refresh_failed')
  return { access_token: data.access_token, refresh_token: data.refresh_token, endpoint: typeof data.client_endpoint === 'string' ? data.client_endpoint : undefined }
}

/**
 * REST с access-токеном; протух — обновляем refresh-токеном автоматически и сохраняем пару.
 * Файл токенов читается при первом вызове: его создаёт установка (/oauth/b24/*) или src/b24-auth.ts.
 */
export function oauthRest(cfg: OAuthConfig): B24Rest & { reload(): void } {
  let tokens: Tokens | null = null
  const f = cfg.fetchImpl ?? fetch
  const portal = cfg.portal.replace(/\/+$/, '')
  let refreshing: Promise<void> | null = null

  const load = (): Tokens => {
    tokens ??= readTokens(cfg.tokenFile)
    if (!tokens) throw new B24Error('not_installed')
    return tokens
  }

  const refresh = () =>
    (refreshing ??= exchangeToken(cfg, { refresh_token: load().refresh_token })
      .then((t) => {
        // Сервер авторизации может вернуть и чужой портал — такие токены не берём.
        if (t.endpoint !== undefined && !isOwnPortal(t.endpoint, portal)) throw new B24Error('oauth_foreign_portal')
        tokens = t
        writeTokens(cfg.tokenFile, t)
      })
      .finally(() => (refreshing = null)))

  const once = (method: string, params: Record<string, unknown>) =>
    postJson(f, `${portal}/rest/${method}.json`, { ...params, auth: load().access_token })

  return {
    /** Перечитать файл токенов (после переустановки приложения). */
    reload: () => void (tokens = null),
    async call(method, params) {
      if (!load().access_token) await refresh()
      try {
        return await once(method, params)
      } catch (e) {
        if (!(e instanceof B24Error) || !['expired_token', 'invalid_token', 'NO_AUTH_FOUND'].includes(e.code)) throw e
        await refresh()
        return once(method, params)
      }
    },
  }
}

// ─── Счета ───────────────────────────────────────────────────────────────────

/** Стадия счёта при перепроверке перед закрытием: всё ещё ждёт оплаты или уже нет (оплачен / решено человеком). */
export type Recheck = 'open' | 'left'

export interface InvoiceStore {
  /** Счета в стадиях поиска (и только в них). */
  listOpen(): Promise<Invoice[]>
  recheck(id: number): Promise<Recheck>
  markPaid(inv: Invoice, paidDate: string): Promise<void>
  comment(inv: Invoice, text: string): Promise<void>
  flagForReview(inv: Invoice, comment: string): Promise<void>
  /** Задача ответственному за счета, срок — сегодня. */
  reportUnresolved(title: string, description: string): Promise<void>
  /** Сообщение ответственному в чат Б24 (не наружу). */
  notify(text: string): Promise<void>
  /** Ссылка (BB-код Б24) на сделку счёта; сделки нет — на сам счёт. */
  link(inv: Invoice): string
}

/*
 * ВАЖНО: таблица стадий в ТЗ (§3а: «1 Новый … 8 Оплачен») — описание для читателя, НЕ конфиг.
 * Здесь нет и не должно быть ни номеров стадий, ни их названий. В конфиг идут только STATUS_ID,
 * снятые с портала через API (node src/stages.ts). Названия правят в интерфейсе, STATUS_ID стабилен;
 * привязка к названию сломала бы интеграцию молча.
 */
export type B24Config = {
  /** entityTypeId смарт-процесса счетов (31 — «Счета»; свой смарт-процесс — свой ID, см. src/stages.ts). */
  entityTypeId: number
  /** STATUS_ID стадии «Оплачен» — единственная стадия, которую ставит система. */
  paidStage: string
  /** STATUS_ID стадий «счёт отправлен, ждём деньги» — ищем ТОЛЬКО в них. */
  searchStages: string[]
  /** Опц.: воронка (categoryId); без неё — все воронки. */
  categoryId?: number
  /** Опц.: UF-поле-флаг «требует проверки» (да/нет). */
  reviewField?: string
  /** Опц.: поле «дата оплаты» (дата) — заполняется при закрытии. */
  paidDateField?: string
  /** Ответственный за счета: задачи и сообщения по уровням 2–3 и сбоям. */
  responsibleId: number
  /** ENTITY_TYPE счёта для crm.timeline.comment.add; по умолчанию выводится из entityTypeId. */
  timelineEntityType?: string
  /** Адрес портала для ссылок на сделку/счёт в сообщениях. */
  portal?: string
  /** Опц.: чат для сообщений (DIALOG_ID для im.message.add, напр. chat123); пусто — уведомление ответственному. */
  notifyDialogId?: string
  /** Кэш списка счетов, мс (ТЗ: минута). */
  listTtlMs?: number
  /** Кэш «компания/контакт → ИНН», мс (ТЗ: сутки). */
  innTtlMs?: number
  now?: () => number
}

const SMART_INVOICE = 31
const OWNER_CONTACT = 3
const OWNER_COMPANY = 4
const MAX_PAGES = 50

export function stageEntityId(entityTypeId: number, categoryId: number | string): string {
  return entityTypeId === SMART_INVOICE ? `SMART_INVOICE_STAGE_${categoryId}` : `DYNAMIC_${entityTypeId}_STAGE_${categoryId}`
}

/** Конец сегодняшнего дня в локальном поясе сервера, ISO с офсетом — для срока задачи. */
export function endOfDay(ms: number): string {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset()
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${ymd}T23:59:00${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`
}

export class B24InvoiceStore implements InvoiceStore {
  private rest: B24Rest
  private cfg: B24Config
  private now: () => number
  private listCache: { at: number; items: Invoice[] } | null = null
  private innCache = new Map<string, { at: number; inns: string[] }>()
  private stageNames = new Map<string, string>()

  constructor(rest: B24Rest, cfg: B24Config) {
    if (cfg.searchStages.length === 0) throw new Error('searchStages is empty')
    if (cfg.searchStages.includes(cfg.paidStage)) throw new Error('paidStage must not be in searchStages')
    if (!Number.isInteger(cfg.entityTypeId) || cfg.entityTypeId <= 0) throw new Error('entityTypeId is required')
    this.rest = rest
    this.cfg = cfg
    this.now = cfg.now ?? Date.now
  }

  private get timelineType(): string {
    return this.cfg.timelineEntityType ?? (this.cfg.entityTypeId === SMART_INVOICE ? 'smart_invoice' : `dynamic_${this.cfg.entityTypeId}`)
  }

  private async listAll(method: string, params: Record<string, unknown>, pick: (r: any) => any[]): Promise<any[]> {
    const out: any[] = []
    let start: number | undefined = 0
    for (let page = 0; start !== undefined; page++) {
      if (page >= MAX_PAGES) throw new B24Error('too_many_pages')
      const r = await this.rest.call(method, { ...params, start })
      out.push(...pick(r.result))
      start = r.next
    }
    return out
  }

  private async innsBy(ownerType: number, ids: number[]): Promise<Map<number, string[]>> {
    const ttl = this.cfg.innTtlMs ?? 86_400_000
    const map = new Map<number, string[]>()
    const missing: number[] = []
    for (const id of ids) {
      const c = this.innCache.get(`${ownerType}:${id}`)
      if (c && this.now() - c.at < ttl) map.set(id, c.inns)
      else missing.push(id)
    }
    if (missing.length === 0) return map
    const rows = await this.listAll(
      'crm.requisite.list',
      { filter: { ENTITY_TYPE_ID: ownerType, ENTITY_ID: missing }, select: ['ENTITY_ID', 'RQ_INN'] },
      (r) => r,
    )
    const fresh = new Map<number, string[]>(missing.map((id) => [id, []]))
    for (const row of rows) {
      const inn = normalizeInn(row.RQ_INN)
      const id = Number(row.ENTITY_ID)
      if (inn && fresh.has(id)) fresh.get(id)!.push(inn)
    }
    for (const [id, inns] of fresh) {
      this.innCache.set(`${ownerType}:${id}`, { at: this.now(), inns })
      map.set(id, inns)
    }
    return map
  }

  /** В поиске = STATUS_ID из белого списка. Неизвестная или новая стадия в поиск не попадает. */
  private inSearch(stageId: unknown): stageId is string {
    return typeof stageId === 'string' && this.cfg.searchStages.includes(stageId)
  }

  /** Названия стадий — только для текста карточки человеку. Сбой — не повод терять платёж: покажем ID. */
  private async resolveStageNames(stageIds: string[]): Promise<void> {
    const categories = new Set<string>()
    for (const id of stageIds) {
      const cat = /^DT\d+_(\d+):/.exec(id)?.[1]
      if (cat !== undefined && !this.stageNames.has(id)) categories.add(cat)
    }
    for (const cat of categories) {
      try {
        const r = await this.rest.call('crm.status.list', { filter: { ENTITY_ID: stageEntityId(this.cfg.entityTypeId, cat) } })
        for (const row of r.result ?? []) if (row.STATUS_ID && row.NAME) this.stageNames.set(String(row.STATUS_ID), String(row.NAME))
      } catch {
        // остаёмся с ID стадии
      }
    }
  }

  async listOpen(): Promise<Invoice[]> {
    const ttl = this.cfg.listTtlMs ?? 60_000
    if (this.listCache && this.now() - this.listCache.at < ttl) return this.listCache.items
    const filter: Record<string, unknown> = { '@stageId': this.cfg.searchStages }
    if (this.cfg.categoryId !== undefined) filter.categoryId = this.cfg.categoryId
    const items = await this.listAll(
      'crm.item.list',
      {
        entityTypeId: this.cfg.entityTypeId,
        filter,
        select: ['id', 'accountNumber', 'title', 'opportunity', 'currencyId', 'stageId', 'categoryId', 'begindate', 'companyId', 'contactId', 'parentId2', 'mycompanyId'],
      },
      (r) => r.items ?? [],
    )
    // Дублируем фильтр локально: при сбое фильтрации на стороне Б24 счёт вне стадий поиска не станет кандидатом.
    const rub = items.filter(
      (i) =>
        (i.currencyId ?? 'RUB') === 'RUB' &&
        this.inSearch(i.stageId) &&
        (this.cfg.categoryId === undefined || Number(i.categoryId) === this.cfg.categoryId),
    )
    const uniq = (xs: number[]) => [...new Set(xs.filter((x) => x > 0))]
    const companies = await this.innsBy(OWNER_COMPANY, uniq(rub.map((i) => Number(i.companyId))))
    const contacts = await this.innsBy(OWNER_CONTACT, uniq(rub.map((i) => Number(i.contactId))))
    await this.resolveStageNames([...new Set(rub.map((i) => String(i.stageId)))])

    const out: Invoice[] = []
    for (const i of rub) {
      const amountKop = toKopecks(i.opportunity)
      if (amountKop === null) continue
      out.push({
        id: Number(i.id),
        number: String(i.accountNumber || i.title || i.id),
        amountKop,
        issuedAt: i.begindate ? String(i.begindate).slice(0, 10) : null,
        stage: this.stageNames.get(String(i.stageId)) ?? String(i.stageId),
        inns: [...new Set([...(companies.get(Number(i.companyId)) ?? []), ...(contacts.get(Number(i.contactId)) ?? [])])],
        dealId: Number(i.parentId2) > 0 ? Number(i.parentId2) : null,
        entity: Number(i.mycompanyId) > 0 ? Number(i.mycompanyId) : null,
      })
    }
    this.listCache = { at: this.now(), items: out }
    return out
  }

  async recheck(id: number): Promise<Recheck> {
    const r = await this.rest.call('crm.item.get', { entityTypeId: this.cfg.entityTypeId, id })
    return this.inSearch(r.result?.item?.stageId) ? 'open' : 'left'
  }

  async comment(inv: Invoice, text: string): Promise<void> {
    await this.rest.call('crm.timeline.comment.add', {
      fields: { ENTITY_TYPE: this.timelineType, ENTITY_ID: inv.id, COMMENT: text },
    })
    if (inv.dealId) {
      await this.rest.call('crm.timeline.comment.add', { fields: { ENTITY_TYPE: 'deal', ENTITY_ID: inv.dealId, COMMENT: text } })
    }
  }

  async markPaid(inv: Invoice, paidDate: string): Promise<void> {
    const fields: Record<string, unknown> = { stageId: this.cfg.paidStage }
    if (this.cfg.paidDateField && paidDate) fields[this.cfg.paidDateField] = paidDate
    this.listCache = null
    await this.rest.call('crm.item.update', { entityTypeId: this.cfg.entityTypeId, id: inv.id, fields })
  }

  async flagForReview(inv: Invoice, comment: string): Promise<void> {
    if (this.cfg.reviewField) {
      await this.rest.call('crm.item.update', { entityTypeId: this.cfg.entityTypeId, id: inv.id, fields: { [this.cfg.reviewField]: 'Y' } })
    }
    await this.comment(inv, comment)
  }

  async reportUnresolved(title: string, description: string): Promise<void> {
    await this.rest.call('tasks.task.add', {
      fields: { TITLE: title, DESCRIPTION: description, RESPONSIBLE_ID: this.cfg.responsibleId, DEADLINE: endOfDay(this.now()) },
    })
  }

  async notify(text: string): Promise<void> {
    if (this.cfg.notifyDialogId) await this.rest.call('im.message.add', { DIALOG_ID: this.cfg.notifyDialogId, MESSAGE: text })
    else await this.rest.call('im.notify.system.add', { USER_ID: this.cfg.responsibleId, MESSAGE: text })
  }

  link(inv: Invoice): string {
    const base = (this.cfg.portal ?? '').replace(/\/+$/, '')
    return inv.dealId
      ? `[URL=${base}/crm/deal/details/${inv.dealId}/]сделка №${inv.dealId}[/URL]`
      : `[URL=${base}/crm/type/${this.cfg.entityTypeId}/details/${inv.id}/]счёт ${inv.number}[/URL] (сделка не привязана)`
  }
}
