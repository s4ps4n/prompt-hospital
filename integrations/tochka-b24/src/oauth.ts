// Эндпоинты установки (публикуются вместе с вебхуком через Traefik, HTTPS):
//   GET  /oauth/b24/start?key=…       → авторизация локального приложения на портале владельца
//   GET  /handler?code&state           → обмен кода на токены Б24 (путь обработчика в настройках приложения;
//                                        /oauth/b24/handler — то же самое)
//   POST /handler                      → страница приложения внутри Б24 (только статус, без данных)
//   POST /oauth/b24/install?key=…      → установка приложения порталом (URL установки с ?key= в настройках приложения)
//   GET  /oauth/tochka/start?key=…&org=ooo|ip → разрешение Точки и вход владельца (у каждого юрлица своё приложение)
//   GET  /oauth/tochka/callback?code&state[&client_id] → обмен кода на токены Точки (юрлицо — из state;
//                                        client_id, если передан, должен быть приложением этого юрлица)
// Не задан ключ установки (OAUTH_SETUP_KEY) — маршрутов нет (404). Колбэки принимают только
// одноразовый state, выданный стартом (10 минут). Токены пишутся в файл 0600 и нигде больше не показываются.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { exchangeToken, isOwnPortal, type OAuthConfig } from './b24.ts'
import { page, readBody } from './http.ts'
import { errCode, type Logger } from './log.ts'
import { tochkaAuthorizeUrl, tochkaExchangeCode, type TochkaOAuthConfig } from './tochka.ts'
import { writeTokens } from './tokens.ts'

export const OAUTH_PATHS = {
  b24Start: '/oauth/b24/start',
  b24Handler: '/oauth/b24/handler',
  handler: '/handler',
  b24Install: '/oauth/b24/install',
  tochkaStart: '/oauth/tochka/start',
  tochkaCallback: '/oauth/tochka/callback',
} as const

const STATE_TTL_MS = 10 * 60_000
const MAX_FORM = 64 * 1024

type Kind = 'b24' | 'tochka'

export type OAuthDeps = {
  /** Ключ установки; пустой — эндпоинты выключены. */
  setupKey: string
  /** Внешний адрес сервиса, напр. https://it-uu.ru — для redirect_uri. */
  publicBase: string
  b24?: OAuthConfig
  /** Приложения Точки по юрлицам (ключ — ooo/ip/main). */
  tochka?: Record<string, TochkaOAuthConfig>
  /** redirect_uri Точки, как зарегистрирован в приложении; по умолчанию publicBase + /oauth/tochka/callback. */
  tochkaRedirect?: string
  log: Logger
  /** Токены записаны — перечитать их в работающем сервисе. org — юрлицо (для Точки). */
  onInstalled?: (kind: Kind, org?: string) => void
  now?: () => number
}

const digest = (s: string) => createHash('sha256').update(s).digest()

export function oauthRoutes(d: OAuthDeps): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const now = d.now ?? Date.now
  const states = new Map<string, { kind: Kind; org?: string; exp: number }>()
  const base = d.publicBase.replace(/\/+$/, '')
  const tochkaRedirect = d.tochkaRedirect || `${base}${OAUTH_PATHS.tochkaCallback}`
  const orgs = Object.keys(d.tochka ?? {})

  const keyOk = (u: URL) => {
    const k = u.searchParams.get('key') ?? ''
    return d.setupKey !== '' && timingSafeEqual(digest(k), digest(d.setupKey))
  }

  const issueState = (kind: Kind, org?: string) => {
    for (const [s, v] of states) if (v.exp <= now()) states.delete(s)
    const s = randomBytes(24).toString('base64url')
    states.set(s, { kind, org, exp: now() + STATE_TTL_MS })
    return s
  }

  /** Одноразовый: повтор того же state — отказ. Возвращает запись state или null. */
  const takeState = (s: string | null, kind: Kind) => {
    const v = s ? states.get(s) : undefined
    if (!v) return null
    states.delete(s!)
    return v.kind === kind && v.exp > now() ? v : null
  }

  const done = (res: ServerResponse, kind: Kind, t: { access_token?: string; refresh_token: string }, file: string, org?: string) => {
    try {
      writeTokens(file, t)
    } catch (e) {
      // Диск полон / нет прав — ответить ошибкой, а не оставить запрос висеть.
      return fail(res, kind, 'store', e)
    }
    d.log('oauth.installed', { status: org ? `${kind}:${org}` : kind })
    d.onInstalled?.(kind, org)
    page(res, 200, kind === 'b24' ? 'Битрикс24 подключён. Окно можно закрыть.' : 'Точка подключена. Окно можно закрыть.')
  }

  const fail = (res: ServerResponse, kind: Kind, reason: string, e?: unknown) => {
    d.log('oauth.failed', { status: kind, reason, error: e === undefined ? undefined : errCode(e) })
    const status = reason === 'denied' || reason === 'no_code' ? 400 : ['state', 'foreign_portal', 'foreign_client'].includes(reason) ? 403 : 502
    page(res, status, 'Подключение не выполнено. Подробности — в логе сервиса; начните заново.')
  }

  /** Токены Б24 принимаем, только если они выданы нашему приложению (обмен шёл с нашим секретом) для портала владельца. */
  async function b24Exchange(res: ServerResponse, grant: { code: string } | { refresh_token: string }) {
    const b = d.b24!
    let t
    try {
      t = await exchangeToken(b, grant)
    } catch (e) {
      return fail(res, 'b24', 'exchange', e)
    }
    if (!isOwnPortal(t.endpoint, b.portal)) return fail(res, 'b24', 'foreign_portal')
    done(res, 'b24', t, b.tokenFile)
  }

  return async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://local')
    const path = u.pathname
    if (!d.setupKey || !(Object.values(OAUTH_PATHS) as string[]).includes(path)) return false
    const is = (m: string, p: string) => req.method === m && path === p

    if (d.b24 && is('GET', OAUTH_PATHS.b24Start)) {
      if (!keyOk(u)) {
        page(res, 404, 'Не найдено')
        return true
      }
      const a = new URL(`${d.b24.portal.replace(/\/+$/, '')}/oauth/authorize/`)
      a.searchParams.set('client_id', d.b24.clientId)
      a.searchParams.set('state', issueState('b24'))
      res.writeHead(302, { location: a.toString(), 'cache-control': 'no-store' }).end()
      return true
    }

    const isHandler = path === OAUTH_PATHS.b24Handler || path === OAUTH_PATHS.handler
    if (d.b24 && req.method === 'GET' && isHandler && u.searchParams.has('code')) {
      if (!takeState(u.searchParams.get('state'), 'b24')) {
        fail(res, 'b24', 'state')
        return true
      }
      await b24Exchange(res, { code: u.searchParams.get('code')! })
      return true
    }

    if (d.b24 && is('POST', OAUTH_PATHS.b24Install)) {
      if (!keyOk(u)) {
        page(res, 404, 'Не найдено')
        return true
      }
      let form: URLSearchParams
      try {
        form = new URLSearchParams(await readBody(req, MAX_FORM))
      } catch (e) {
        fail(res, 'b24', 'body', e)
        return true
      }
      // Установка UI-приложения (REFRESH_ID) или событие ONAPPINSTALL (auth[refresh_token]).
      const refresh = form.get('REFRESH_ID') ?? form.get('auth[refresh_token]')
      if (!refresh) {
        fail(res, 'b24', 'no_refresh')
        return true
      }
      await b24Exchange(res, { refresh_token: refresh })
      return true
    }

    if ((req.method === 'POST' || req.method === 'GET') && isHandler) {
      // Приложение открыли внутри Б24: переданные в форме токены не используем, данных не показываем.
      page(res, 200, 'Интеграция Точка → Битрикс24 работает на сервере владельца. Настроек здесь нет.')
      return true
    }

    if (d.tochka && orgs.length > 0 && is('GET', OAUTH_PATHS.tochkaStart)) {
      // Юрлицо одно — org можно не указывать; два — обязателен (?org=ooo|ip).
      const org = u.searchParams.get('org') ?? (orgs.length === 1 ? orgs[0] : '')
      if (!keyOk(u) || !orgs.includes(org)) {
        page(res, 404, orgs.length > 1 && keyOk(u) ? `Укажите юрлицо: ${orgs.map((o) => `?org=${o}`).join(' или ')}` : 'Не найдено')
        return true
      }
      try {
        const to = await tochkaAuthorizeUrl(d.tochka[org], tochkaRedirect, issueState('tochka', org))
        res.writeHead(302, { location: to, 'cache-control': 'no-store' }).end()
      } catch (e) {
        fail(res, 'tochka', 'consent', e)
      }
      return true
    }

    if (d.tochka && orgs.length > 0 && is('GET', OAUTH_PATHS.tochkaCallback)) {
      const st = takeState(u.searchParams.get('state'), 'tochka')
      const cfg = st?.org ? d.tochka[st.org] : undefined
      if (!st || !cfg) {
        fail(res, 'tochka', 'state')
        return true
      }
      // Юрлицо — из state; client_id в запросе (если Точка его передала) обязан быть приложением этого юрлица.
      // Чужой client_id — отказ до обмена кода: токены одного юрлица не лягут в файл другого.
      const clientId = u.searchParams.get('client_id')
      if (clientId !== null && clientId !== cfg.clientId) {
        fail(res, 'tochka', 'foreign_client')
        return true
      }
      // Владелец отказал или Точка вернула ошибку: текст ошибки от провайдера в лог не пишем.
      if (u.searchParams.has('error')) {
        fail(res, 'tochka', 'denied')
        return true
      }
      const code = u.searchParams.get('code')
      if (!code) {
        fail(res, 'tochka', 'no_code')
        return true
      }
      try {
        done(res, 'tochka', await tochkaExchangeCode(cfg, code, tochkaRedirect), cfg.tokenFile, st.org)
      } catch (e) {
        fail(res, 'tochka', 'exchange', e)
      }
      return true
    }

    page(res, 404, 'Не найдено')
    return true
  }
}
