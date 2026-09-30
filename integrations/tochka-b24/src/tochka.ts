// Точка — единственный внешний контур для платёжных данных.
// Вебхук: тело запроса — JWT (RS256), подписанный ключом Точки; ключи — JWKS Точки (кэш час) или локальный файл.
// API: выписка для ежедневной сверки и список/подписка вебхуков.

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { TochkaError } from './log.ts'
import { normalizeInn, toKopecks } from './money.ts'
import type { Payment } from './matcher.ts'
import { readTokens, writeTokens, type Tokens } from './tokens.ts'

export const TOCHKA_API = 'https://enter.tochka.com/uapi'
export const TOCHKA_JWKS = 'https://enter.tochka.com/doc/openapi/static/keys/public'

export class SignatureError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'SignatureError'
  }
}

export class PayloadError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'PayloadError'
  }
}

// ─── Ключи ───────────────────────────────────────────────────────────────────

export interface KeySource {
  keys(): Promise<KeyObject[]>
}

/** JWK, JWKS ({ keys: [...] }) или PEM. */
export function parseKeys(raw: string): KeyObject[] {
  const s = raw.trim()
  if (!s.startsWith('{')) return [createPublicKey(s)]
  const j = JSON.parse(s)
  const list: object[] = Array.isArray(j.keys) ? j.keys : [j]
  return list.map((k) => createPublicKey({ key: k as any, format: 'jwk' }))
}

/** Отпечаток публичного ключа: SHA-256 от SPKI DER, первые 16 hex. Одинаковый ключ — одинаковый отпечаток. */
export function keyFingerprint(k: KeyObject): string {
  return createHash('sha256').update(k.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16)
}

export function staticKeys(keys: KeyObject[]): KeySource {
  return { keys: async () => keys }
}

export function fileKeys(path: string): KeySource {
  return staticKeys(parseKeys(readFileSync(path, 'utf8')))
}

/** JWKS Точки с кэшем (по умолчанию час). Точка недоступна — работаем на последних известных ключах. */
export function jwksKeys(url = TOCHKA_JWKS, fetchImpl: typeof fetch = fetch, ttlMs = 3_600_000, now = Date.now): KeySource {
  let cache: { keys: KeyObject[]; at: number } | null = null
  return {
    async keys() {
      if (cache && now() - cache.at < ttlMs) return cache.keys
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error()
        cache = { keys: parseKeys(await res.text()), at: now() }
      } catch {
        if (!cache) throw new TochkaError('jwks_unavailable')
      }
      return cache.keys
    },
  }
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

export type JwtCheck = {
  /** Ожидаемый iss; задан — сверяется строго. */
  iss?: string
  /**
   * Ожидаемый aud; задан — сверяется строго (aud токена — строка или массив).
   * Список — любой из: у каждого юрлица своё приложение Точки, aud вебхука — client_id одного из них.
   */
  aud?: string | string[]
  /** Отказ, если в токене нет exp. */
  requireExp?: boolean
  nowSec?: number
}

function jsonPart(b64: string): Record<string, unknown> {
  try {
    const v = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {
    /* ниже */
  }
  throw new SignatureError('jwt_malformed')
}

/** Подпись RS256 одним из ключей + exp/iss/aud. Любые другие alg (в т.ч. none/HS*) — отказ. */
export function verifyJwt(token: string, keys: KeyObject[], check: JwtCheck = {}): Record<string, unknown> {
  const parts = token.trim().split('.')
  if (parts.length !== 3) throw new SignatureError('jwt_malformed')
  const header = jsonPart(parts[0])
  if (header.alg !== 'RS256') throw new SignatureError('jwt_alg')
  const data = Buffer.from(`${parts[0]}.${parts[1]}`)
  const sig = Buffer.from(parts[2], 'base64url')
  if (!keys.some((k) => verify('RSA-SHA256', data, k, sig))) throw new SignatureError('jwt_signature')
  const payload = jsonPart(parts[1])
  const now = check.nowSec ?? Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number') {
    if (payload.exp < now) throw new SignatureError('jwt_expired')
  } else if (check.requireExp) throw new SignatureError('jwt_no_exp')
  if (check.iss !== undefined && payload.iss !== check.iss) throw new SignatureError('jwt_iss')
  if (check.aud !== undefined) {
    const want = Array.isArray(check.aud) ? check.aud : [check.aud]
    const got = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!got.some((a) => typeof a === 'string' && want.includes(a))) throw new SignatureError('jwt_aud')
  }
  return payload
}

// ─── Разбор платежей (объекты живут в памяти до конца обработки, нигде не сохраняются) ──

type Side = { inn?: unknown; name?: unknown; account?: unknown; bankCode?: unknown; amount?: unknown; currency?: unknown }

function side(v: unknown): Side {
  return v && typeof v === 'object' ? (v as Side) : {}
}

/** Р/с владельца в Точке и юрлицо, которому он принадлежит. */
export type OwnAccount = {
  /** Формат Точки «р/с/БИК». */
  id: string
  /** mycompanyId юрлица в Б24; null — юрлицо одно, по нему не различаем. */
  entity: number | null
}

/**
 * TOCHKA_ACCOUNTS: «р/с/БИК=mycompanyId» через запятую (два юрлица — две записи).
 * Старый TOCHKA_ACCOUNT_ID («р/с/БИК» без юрлица) — одно юрлицо.
 * Два и больше счетов — юрлицо обязательно у каждого, иначе платёж не отличить.
 */
export function parseAccounts(accounts: string, legacyAccountId = ''): OwnAccount[] {
  const list = accounts
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, entity] = s.split('=').map((x) => x.trim())
      return ownAccount(id, entity, 'TOCHKA_ACCOUNTS')
    })
  if (list.length === 0 && legacyAccountId.trim()) list.push(ownAccount(legacyAccountId.trim(), '', 'TOCHKA_ACCOUNT_ID'))
  if (list.length === 0) throw new Error('TOCHKA_ACCOUNTS is required')
  return checkAccounts(list)
}

/** Р/с в формате Точки «р/с/БИК» + mycompanyId (пусто — не указан). В ошибке — только имя переменной, без номера счёта. */
export function ownAccount(id: string, entity: string | undefined, name: string): OwnAccount {
  if (!/^\d{20}\/\d{9}$/.test(id)) throw new Error(`${name}: expected «account/bic» (20 digits / 9 digits)`)
  const n = entity === undefined || entity === '' ? null : Number(entity)
  if (n !== null && !(Number.isInteger(n) && n > 0)) throw new Error(`${name}: mycompanyId must be a positive integer`)
  return { id, entity: n }
}

/** Счета не повторяются; при двух и больше — юрлицо у каждого, иначе платёж не отличить. */
export function checkAccounts(list: OwnAccount[]): OwnAccount[] {
  if (new Set(list.map((a) => a.id)).size !== list.length) throw new Error('TOCHKA_ACCOUNTS: duplicate account')
  if (list.length > 1 && list.some((a) => a.entity === null)) throw new Error('TOCHKA_ACCOUNTS: with several accounts each needs mycompanyId')
  return list
}

export type ParsedWebhook =
  | { kind: 'payment'; payment: Payment }
  | { kind: 'ignored'; reason: 'not_incoming_payment' | 'other_account' | 'not_rub' }

/**
 * Разбор incomingPayment.
 * @param accounts р/с владельца; если заданы — поступления на другие счета игнорируем, а юрлицо платежа — по р/с получателя.
 */
export function parseIncomingPayment(body: Record<string, unknown>, accounts: OwnAccount[] = []): ParsedWebhook {
  if (body.webhookType !== 'incomingPayment') return { kind: 'ignored', reason: 'not_incoming_payment' }

  const payer = side(body.SidePayer)
  const recipient = side(body.SideRecipient)

  let entity: number | null = null
  if (accounts.length > 0) {
    const own = accounts.find((a) => {
      const [acc, bic] = a.id.split('/')
      return String(recipient.account ?? '') === acc && (!bic || String(recipient.bankCode ?? '') === bic)
    })
    if (!own) return { kind: 'ignored', reason: 'other_account' }
    entity = own.entity
  }

  const currency = recipient.currency ?? payer.currency ?? 'RUB'
  if (currency !== 'RUB') return { kind: 'ignored', reason: 'not_rub' }

  const amountKop = toKopecks(body.amount ?? recipient.amount ?? payer.amount)
  if (amountKop === null) throw new PayloadError('amount')

  const key = String(body.operationId ?? body.paymentId ?? '')
  if (!key) throw new PayloadError('operation_id')

  return {
    kind: 'payment',
    payment: {
      key,
      entity,
      payerInn: normalizeInn(payer.inn),
      payerName: typeof payer.name === 'string' ? payer.name : '',
      amountKop,
      purpose: typeof body.purpose === 'string' ? body.purpose : '',
      date: typeof body.date === 'string' ? body.date.slice(0, 10) : '',
    },
  }
}

/** Операция из выписки → платёж (только поступления в рублях); иначе null. Юрлицо — того счёта, чья выписка. */
export function parseStatementTransaction(tx: Record<string, any>, entity: number | null = null): Payment | null {
  if (tx?.creditDebitIndicator !== 'Credit') return null
  const amount = tx.Amount ?? {}
  if ((amount.currency ?? 'RUB') !== 'RUB') return null
  const amountKop = toKopecks(amount.amount)
  // Ключ должен совпадать с ключом вебхука, иначе сверка обработает платёж повторно
  // (повторного закрытия не будет — счёт уже вне стадий поиска, но будет лишняя пометка).
  const key = String(tx.operationId ?? tx.paymentId ?? tx.transactionId ?? '')
  if (amountKop === null || !key) return null
  const payer = side(tx.DebtorParty)
  return {
    key,
    entity,
    payerInn: normalizeInn(payer.inn),
    payerName: typeof payer.name === 'string' ? payer.name : '',
    amountKop,
    purpose: typeof tx.description === 'string' ? tx.description : '',
    date: typeof tx.documentProcessDate === 'string' ? tx.documentProcessDate.slice(0, 10) : '',
  }
}

// ─── OAuth Точки (альтернатива JWT-ключу из интернет-банка) ───────────────────
// Гибридный поток: client_credentials → разрешение (consent) → вход владельца → code → токены.
// Адреса и набор прав — по документации Точки; проверить на песочнице.

export const TOCHKA_OAUTH = 'https://enter.tochka.com/connect'
export const TOCHKA_SCOPE = 'accounts balances customers statements'
export const TOCHKA_PERMISSIONS = [
  'ReadAccountsBasic',
  'ReadAccountsDetail',
  'ReadStatements',
  'ReadTransactionsBasic',
  'ReadTransactionsCredits',
  'ReadTransactionsDetail',
  'ManageWebhookData',
]

export type TochkaOAuthConfig = {
  clientId: string
  clientSecret: string
  /** Файл с токенами (0600, не в git). */
  tokenFile: string
  oauthBase?: string
  apiBase?: string
  scope?: string
  fetchImpl?: typeof fetch
}

async function tochkaGrant(cfg: TochkaOAuthConfig, form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  let data: any
  try {
    const res = await (cfg.fetchImpl ?? fetch)(`${cfg.oauthBase ?? TOCHKA_OAUTH}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...form }),
      signal: AbortSignal.timeout(20_000),
    })
    data = await res.json()
  } catch {
    throw new TochkaError('oauth_network')
  }
  if (typeof data?.access_token !== 'string') throw new TochkaError('oauth_failed')
  return { access_token: data.access_token, refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined }
}

/** Шаги 1–2: токен приложения → разрешение на чтение выписки и управление вебхуками → адрес входа владельца. */
export async function tochkaAuthorizeUrl(cfg: TochkaOAuthConfig, redirectUri: string, state: string): Promise<string> {
  const scope = cfg.scope ?? TOCHKA_SCOPE
  const app = await tochkaGrant(cfg, { grant_type: 'client_credentials', scope })
  let consentId: unknown
  try {
    const res = await (cfg.fetchImpl ?? fetch)(`${cfg.apiBase ?? TOCHKA_API}/v1.0/consents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${app.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ Data: { permissions: TOCHKA_PERMISSIONS } }),
      signal: AbortSignal.timeout(20_000),
    })
    consentId = (await res.json())?.Data?.consentId
  } catch {
    throw new TochkaError('consent_network')
  }
  if (typeof consentId !== 'string' || !consentId) throw new TochkaError('consent_failed')
  const u = new URL(`${cfg.oauthBase ?? TOCHKA_OAUTH}/authorize`)
  for (const [k, v] of Object.entries({ client_id: cfg.clientId, response_type: 'code', state, redirect_uri: redirectUri, scope, consent_id: consentId })) {
    u.searchParams.set(k, v)
  }
  return u.toString()
}

/** Шаг 3: code из /oauth/tochka/callback → пара токенов. */
export async function tochkaExchangeCode(cfg: TochkaOAuthConfig, code: string, redirectUri: string): Promise<Tokens> {
  const t = await tochkaGrant(cfg, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, scope: cfg.scope ?? TOCHKA_SCOPE })
  if (!t.refresh_token) throw new TochkaError('oauth_no_refresh')
  return { access_token: t.access_token, refresh_token: t.refresh_token }
}

export interface TokenSource {
  get(): Promise<string>
  refresh(): Promise<void>
}

/** Токены из файла; протух — обновляем refresh-токеном и сохраняем пару. Файл читается лениво (появится после установки). */
export function tochkaOAuthTokens(cfg: TochkaOAuthConfig): TokenSource & { reload(): void } {
  let tokens: Tokens | null = null
  let refreshing: Promise<void> | null = null
  const load = () => {
    tokens ??= readTokens(cfg.tokenFile)
    if (!tokens) throw new TochkaError('not_authorized')
    return tokens
  }
  const refresh = () =>
    (refreshing ??= tochkaGrant(cfg, { grant_type: 'refresh_token', refresh_token: load().refresh_token })
      .then((t) => {
        tokens = { access_token: t.access_token, refresh_token: t.refresh_token ?? load().refresh_token }
        writeTokens(cfg.tokenFile, tokens)
      })
      .finally(() => (refreshing = null)))
  return {
    reload: () => void (tokens = null),
    refresh,
    async get() {
      if (!load().access_token) await refresh()
      return load().access_token!
    },
  }
}

// ─── API Точки ───────────────────────────────────────────────────────────────

export interface TochkaApi {
  /** Операции выписки за период (YYYY-MM-DD). Выписка не сохраняется — только перебор в памяти. */
  statement(accountId: string, from: string, to: string): Promise<Record<string, any>[]>
  webhooks(clientId: string): Promise<{ list: string[]; url: string }>
  subscribe(clientId: string, url: string): Promise<void>
}

export function tochkaApi(opts: {
  /** JWT-ключ из интернет-банка или OAuth-токены с автообновлением. */
  token: string | TokenSource
  fetchImpl?: typeof fetch
  base?: string
  sleep?: (ms: number) => Promise<void>
  pollAttempts?: number
}): TochkaApi {
  const f = opts.fetchImpl ?? fetch
  const base = opts.base ?? TOCHKA_API
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const src = opts.token

  async function once(method: string, path: string, body?: unknown): Promise<Response> {
    const token = typeof src === 'string' ? src : await src.get()
    try {
      return await f(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new TochkaError('network')
    }
  }

  async function req(method: string, path: string, body?: unknown): Promise<any> {
    let res = await once(method, path, body)
    if (res.status === 401 && typeof src !== 'string') {
      await src.refresh()
      res = await once(method, path, body)
    }
    if (!res.ok) throw new TochkaError(`http_${res.status}`)
    return res.json().catch(() => ({}))
  }

  return {
    async statement(accountId, from, to) {
      const init = await req('POST', '/open-banking/v1.0/statements', {
        Data: { Statement: { accountId, startDateTime: from, endDateTime: to } },
      })
      const id = init?.Data?.Statement?.statementId
      if (!id) throw new TochkaError('statement_init')
      for (let i = 0; i < (opts.pollAttempts ?? 20); i++) {
        const r = await req('GET', `/open-banking/v1.0/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(id)}`)
        const st = r?.Data?.Statement?.[0]
        if (st?.status === 'Ready') return st.Transaction ?? []
        await sleep(3_000)
      }
      throw new TochkaError('statement_timeout')
    },
    async webhooks(clientId) {
      const r = await req('GET', `/webhook/v1.0/${encodeURIComponent(clientId)}`)
      return { list: r?.Data?.webhooksList ?? [], url: r?.Data?.url ?? '' }
    },
    async subscribe(clientId, url) {
      await req('PUT', `/webhook/v1.0/${encodeURIComponent(clientId)}`, { webhooksList: ['incomingPayment'], url })
    },
  }
}
