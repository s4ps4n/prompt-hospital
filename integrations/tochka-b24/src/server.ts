// Локальный слушатель вебхуков Точки. Запуск: node --env-file=.env src/server.ts (Node ≥ 22.18).
// Слушает 127.0.0.1 — наружу публикуется через свой reverse-proxy с TLS (Traefik).
// Порядок: подпись → 401 или 200 сразу → обработка в очереди (Точка повторяет, если ответ медленный).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { B24InvoiceStore, oauthRest } from './b24.ts'
import { readBody } from './http.ts'
import { FileJournal } from './journal.ts'
import { errCode, makeLogger, type Logger } from './log.ts'
import { makeProcessor, makeQueue } from './processor.ts'
import type { Payment } from './matcher.ts'
import { oauthRoutes } from './oauth.ts'
import { msUntil, reconcile } from './reconcile.ts'
import { tochkaProfiles } from './config.ts'
import {
  fileKeys,
  jwksKeys,
  parseIncomingPayment,
  PayloadError,
  SignatureError,
  tochkaApi,
  tochkaOAuthTokens,
  verifyJwt,
  type JwtCheck,
  type KeySource,
  type OwnAccount,
} from './tochka.ts'

const MAX_BODY = 256 * 1024
/** Приём вебхуков Точки (тело — строка JWT, Content-Type: text/plain). */
export const DEFAULT_WEBHOOK_PATH = '/webhook/tochka'
/** Столько отказов подписи подряд — повод сообщить ответственному (ключ сменился или нас кто-то перебирает). */
export const SIGNATURE_ALERT_AFTER = 5

export type AppDeps = {
  keys: KeySource
  jwt: JwtCheck
  /** Р/с владельца (два юрлица — два счёта); поступления на другие счета игнорируются. */
  accounts?: OwnAccount[]
  path: string
  /** Постановка в очередь; не ждём — отвечаем Точке сразу. Нет — режим установки: 503, Точка повторит. */
  submit?: (p: Payment) => unknown
  log: Logger
  onSignatureAlert?: () => void
  /** Эндпоинты установки (/oauth/*); true — запрос обработан. */
  routes?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
}

export function createApp(d: AppDeps): Server {
  let rejectedInRow = 0
  return createServer(async (req, res) => {
    const reply = (code: number) => {
      res.writeHead(code, { 'content-type': 'text/plain' }).end(code < 300 ? 'ok' : 'error')
    }
    if (req.method === 'GET' && req.url === '/healthz') return reply(200)
    if (d.routes && (await d.routes(req, res))) return
    if (req.method !== 'POST' || req.url !== d.path) return reply(404)

    try {
      const body = await readBody(req, MAX_BODY)
      const claims = verifyJwt(body, await d.keys.keys(), d.jwt)
      rejectedInRow = 0
      const parsed = parseIncomingPayment(claims, d.accounts)
      if (parsed.kind === 'ignored') {
        d.log('webhook.ignored', { reason: parsed.reason })
        return reply(200)
      }
      if (!d.submit) {
        d.log('webhook.deferred', { reason: 'setup_mode' })
        return reply(503)
      }
      d.submit(parsed.payment)
      return reply(200)
    } catch (e) {
      if (e instanceof SignatureError) {
        d.log('webhook.rejected', { reason: 'signature' })
        if (++rejectedInRow === SIGNATURE_ALERT_AFTER) d.onSignatureAlert?.()
        return reply(401)
      }
      if (e instanceof PayloadError) {
        d.log('webhook.bad_payload', { reason: e.message })
        return reply(400)
      }
      // Ключи Точки недоступны и т. п. — 5xx, чтобы Точка повторила доставку.
      d.log('webhook.error', { error: errCode(e) })
      return reply(503)
    }
  })
}

function env(name: string, required = true): string {
  const v = process.env[name]?.trim() ?? ''
  if (required && !v) throw new Error(`env ${name} is required`)
  return v
}

const optNum = (name: string) => (env(name, false) ? Number(env(name)) : undefined)

async function main() {
  const log = makeLogger()
  const b24Auth = {
    portal: env('B24_PORTAL'),
    clientId: env('B24_CLIENT_ID'),
    clientSecret: env('B24_CLIENT_SECRET'),
    tokenFile: env('B24_TOKEN_FILE', false) || './data/b24-tokens.json',
  }
  const rest = oauthRest(b24Auth)

  // Юрлица (ООО, ИП): у каждого своё приложение Точки. Токен — JWT-ключ из интернет-банка (_API_TOKEN)
  // или OAuth через /oauth/tochka/start?org=… (файл токенов на юрлицо).
  const profiles = tochkaProfiles(process.env)
  const tochkaOAuth = Object.fromEntries(
    profiles.filter((p) => p.clientSecret).map((p) => [p.key, { clientId: p.clientId, clientSecret: p.clientSecret, tokenFile: p.tokenFile }]),
  )
  const tochkaTokens = Object.fromEntries(Object.entries(tochkaOAuth).map(([k, cfg]) => [k, tochkaOAuthTokens(cfg)]))

  const path = env('WEBHOOK_PATH', false) || DEFAULT_WEBHOOK_PATH
  const setupKey = env('OAUTH_SETUP_KEY', false)
  const routes = setupKey
    ? oauthRoutes({
        setupKey,
        publicBase: env('PUBLIC_BASE_URL'),
        b24: b24Auth,
        tochka: tochkaOAuth,
        tochkaRedirect: env('TOCHKA_REDIRECT_URL', false) || undefined,
        log,
        onInstalled: (kind, org) => (kind === 'b24' ? rest.reload() : org && tochkaTokens[org]?.reload()),
      })
    : undefined

  const accounts = profiles.flatMap((p) => p.accounts)
  // aud вебхука — client_id приложения; юрлиц два — подойдёт любой из наших. Явный TOCHKA_JWT_AUD (через запятую) главнее.
  const aud = env('TOCHKA_JWT_AUD', false) ? env('TOCHKA_JWT_AUD').split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const jwt: JwtCheck = { iss: env('TOCHKA_JWT_ISS', false) || undefined, aud, requireExp: env('TOCHKA_JWT_REQUIRE_EXP', false) === 'true' }
  if (!jwt.iss || !jwt.aud) log('config.warning', { reason: 'tochka_iss_aud_not_set' })

  // Режим установки: нет токенов Б24 или стадий (их снимают с портала уже после установки).
  // Работают только /oauth/* и /healthz; вебхук — 503 (Точка повторит), сверка не запускается.
  const ready = existsSync(b24Auth.tokenFile) && env('B24_SEARCH_STAGES', false) !== '' && env('B24_PAID_STAGE', false) !== ''
  if (!ready && !routes) throw new Error('B24 is not installed and B24 stages are not set; set OAUTH_SETUP_KEY for setup mode')

  let submit: ((p: Payment) => Promise<void>) | undefined
  let alert = async (_: string) => {}
  if (ready) {
    const store = new B24InvoiceStore(rest, {
      entityTypeId: Number(env('B24_ENTITY_TYPE_ID')),
      paidStage: env('B24_PAID_STAGE'),
      searchStages: env('B24_SEARCH_STAGES').split(',').map((s) => s.trim()).filter(Boolean),
      categoryId: optNum('B24_CATEGORY_ID'),
      reviewField: env('B24_REVIEW_FIELD', false) || undefined,
      paidDateField: env('B24_PAID_DATE_FIELD', false) || undefined,
      responsibleId: Number(env('B24_RESPONSIBLE_ID')),
      timelineEntityType: env('B24_TIMELINE_ENTITY_TYPE', false) || undefined,
      portal: b24Auth.portal,
      notifyDialogId: env('B24_NOTIFY_DIALOG_ID', false) || undefined,
    })
    const journal = new FileJournal({ path: env('JOURNAL_FILE', false) || './data/journal.json', secret: env('JOURNAL_SECRET') })
    const autoClose = env('AUTO_CLOSE', false) === 'true'
    if (!autoClose) log('config.warning', { reason: 'auto_close_off_marks_only' })
    submit = makeQueue(makeProcessor({ store, journal, log, autoClose })).push
    alert = (text: string) => store.notify(text).catch((e) => log('alert.failed', { error: errCode(e) }))
  } else log('config.warning', { reason: 'setup_mode' })

  // Публичный ключ Точки: сохранённый JWK/PEM (TOCHKA_JWK_FILE) или JWKS Точки с кэшем на час.
  const keyFile = env('TOCHKA_JWK_FILE', false) || env('TOCHKA_PUBLIC_KEY_FILE', false)
  const app = createApp({
    keys: keyFile ? fileKeys(keyFile) : jwksKeys(env('TOCHKA_JWKS_URL', false) || undefined),
    jwt,
    accounts,
    path,
    submit,
    log,
    onSignatureAlert: () => alert(`Интеграция Точка → Б24: ${SIGNATURE_ALERT_AFTER} вебхуков подряд с неверной подписью. Проверьте ключ Точки.`),
    routes,
  })
  const port = Number(env('PORT', false) || 8787)
  const host = env('HOST', false) || '127.0.0.1'
  app.listen(port, host, () => log('server.started', { status: `${host}:${port}` }))

  if (!submit) return
  const push = submit
  const sources = profiles.map((p) => ({
    key: p.key,
    name: p.name,
    clientId: p.clientId,
    accounts: p.accounts,
    api: tochkaApi({ token: p.apiToken || tochkaTokens[p.key] }),
  }))
  const webhookUrl = env('PUBLIC_WEBHOOK_URL', false) || `${env('PUBLIC_BASE_URL').replace(/\/+$/, '')}${path}`
  const hour = Number(env('RECONCILE_HOUR', false) || 7)
  const run = () =>
    reconcile({ sources, webhookUrl, submit: push, notify: alert, log })
      .catch((e) => log('reconcile.failed', { error: errCode(e) }))
      .finally(() => setTimeout(run, msUntil(hour)))
  setTimeout(run, msUntil(hour))
}

if (import.meta.url === `file://${process.argv[1]}`) main()
