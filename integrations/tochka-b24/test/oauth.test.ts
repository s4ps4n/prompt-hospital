// Эндпоинты установки /oauth/* и режим установки. Серверы авторизации Б24 и Точки — фейковый fetch.

import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeLogger } from '../src/log.ts'
import { OAUTH_PATHS, oauthRoutes, type OAuthDeps } from '../src/oauth.ts'
import { createApp } from '../src/server.ts'
import { staticKeys, tochkaApi, tochkaOAuthTokens } from '../src/tochka.ts'

const KEY = 'setup-key-123'
const PORTAL = 'https://owner.bitrix24.ru'
const BASE = 'https://it-uu.ru'

let dir: string
let server: Server
let origin: string
let logLines: string[]
let installed: string[]
let fetchCalls: { url: string; body?: string }[]

/** Фейковые сервера авторизации: Б24 (oauth.test) и Точка (tochka.test). */
const fakeFetch = (overrides: { b24Endpoint?: string } = {}) =>
  (async (input: any, init?: any) => {
    const url = String(input)
    const body = init?.body === undefined ? undefined : String(init.body)
    fetchCalls.push({ url, body })
    if (url.startsWith('https://oauth.test/')) {
      const q = new URL(url).searchParams
      if (q.get('client_secret') !== 'b24-secret') return Response.json({ error: 'invalid_client' }, { status: 401 })
      const good = q.get('grant_type') === 'authorization_code' ? q.get('code') === 'good-code' : q.get('refresh_token') === 'install-refresh'
      if (!good) return Response.json({ error: 'invalid_grant' }, { status: 400 })
      return Response.json({ access_token: 'b24-access', refresh_token: 'b24-refresh', client_endpoint: overrides.b24Endpoint ?? `${PORTAL}/rest/` })
    }
    if (url === 'https://tochka.test/connect/token') {
      const f = new URLSearchParams(body)
      if (f.get('grant_type') === 'client_credentials') return Response.json({ access_token: 'app-token' })
      if (f.get('grant_type') === 'authorization_code' && f.get('code') === 't-code' && f.get('redirect_uri') === `${BASE}${OAUTH_PATHS.tochkaCallback}`)
        return Response.json({ access_token: 't-access', refresh_token: 't-refresh' })
      if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === 't-refresh') return Response.json({ access_token: 't-access-2', refresh_token: 't-refresh-2' })
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    if (url === 'https://tochka.test/uapi/v1.0/consents') {
      expect(init.headers.authorization).toBe('Bearer app-token')
      expect(JSON.parse(body!).Data.permissions).toContain('ManageWebhookData')
      return Response.json({ Data: { consentId: 'consent-1' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch

const tochkaCfg = (clientId: string, file: string, f: typeof fetch) => ({
  clientId,
  clientSecret: 't-secret',
  tokenFile: join(dir, file),
  oauthBase: 'https://tochka.test/connect',
  apiBase: 'https://tochka.test/uapi',
  fetchImpl: f,
})

async function start(over: Partial<OAuthDeps> = {}, f = fakeFetch()) {
  const log = makeLogger((l) => logLines.push(l))
  const routes = oauthRoutes({
    setupKey: KEY,
    publicBase: BASE,
    b24: { portal: PORTAL, clientId: 'b24-app', clientSecret: 'b24-secret', tokenFile: join(dir, 'b24.json'), oauthUrl: 'https://oauth.test/token/', fetchImpl: f },
    tochka: { main: tochkaCfg('t-app', 'tochka.json', f) },
    log,
    onInstalled: (k, org) => installed.push(org ? `${k}:${org}` : k),
    ...over,
  })
  // Режим установки: конвейера нет (submit не задан).
  server = createApp({ keys: staticKeys([keys.publicKey]), jwt: {}, path: '/tochka/webhook', log, routes })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const get = (path: string) => fetch(`${origin}${path}`, { redirect: 'manual' })
const form = (path: string, fields: Record<string, string>) => fetch(`${origin}${path}`, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tb24-oauth-'))
  logLines = []
  installed = []
  fetchCalls = []
  await start()
})

afterEach(() => new Promise<void>((r) => server.close(() => r())))

async function b24State(): Promise<string> {
  const r = await get(`${OAUTH_PATHS.b24Start}?key=${KEY}`)
  expect(r.status).toBe(302)
  const to = new URL(r.headers.get('location')!)
  expect(`${to.origin}${to.pathname}`).toBe(`${PORTAL}/oauth/authorize/`)
  expect(to.searchParams.get('client_id')).toBe('b24-app')
  return to.searchParams.get('state')!
}

describe('Б24: /oauth/b24/*', () => {
  it('старт без ключа или с чужим ключом → 404, на портал не уводим', async () => {
    expect((await get(OAUTH_PATHS.b24Start)).status).toBe(404)
    expect((await get(`${OAUTH_PATHS.b24Start}?key=wrong`)).status).toBe(404)
  })

  it('старт → портал → handler с code и state → токены в файле 0600, сервис перечитал их', async () => {
    const state = await b24State()
    const r = await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}&domain=owner.bitrix24.ru`)
    expect(r.status).toBe(200)
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    const file = join(dir, 'b24.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ access_token: 'b24-access', refresh_token: 'b24-refresh' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(installed).toEqual(['b24'])
  })

  it('чужой или повторно использованный state → 403, токены не пишутся', async () => {
    expect((await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=forged`)).status).toBe(403)
    const state = await b24State()
    expect((await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}`)).status).toBe(200)
    expect((await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}`)).status).toBe(403)
    expect(installed).toEqual(['b24'])
  })

  it('state протух (10 минут) → 403', async () => {
    let now = 0
    await new Promise<void>((r) => server.close(() => r()))
    await start({ now: () => now })
    const state = await b24State()
    now += 11 * 60_000
    expect((await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}`)).status).toBe(403)
    expect(existsSync(join(dir, 'b24.json'))).toBe(false)
  })

  it('токены выданы другому порталу → 403, не сохраняем', async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await start({}, fakeFetch({ b24Endpoint: 'https://evil.bitrix24.ru/rest/' }))
    const state = await b24State()
    expect((await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}`)).status).toBe(403)
    expect(existsSync(join(dir, 'b24.json'))).toBe(false)
  })

  it('токены не записались (диск/права) → 502 сразу, запрос не висит, в логе reason=store', async () => {
    await new Promise<void>((r) => server.close(() => r()))
    writeFileSync(join(dir, 'blocker'), '')
    const f = fakeFetch()
    await start({ b24: { portal: PORTAL, clientId: 'b24-app', clientSecret: 'b24-secret', tokenFile: join(dir, 'blocker', 'b24.json'), oauthUrl: 'https://oauth.test/token/', fetchImpl: f } }, f)
    const state = await b24State()
    expect((await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}`)).status).toBe(502)
    expect(installed).toEqual([])
    expect(logLines.some((l) => l.includes('"reason":"store"'))).toBe(true)
  })

  it('установка порталом (POST install с ключом) → refresh проверен нашим секретом → токены сохранены', async () => {
    const r = await form(`${OAUTH_PATHS.b24Install}?key=${KEY}&DOMAIN=owner.bitrix24.ru`, { AUTH_ID: 'x', REFRESH_ID: 'install-refresh', member_id: 'm' })
    expect(r.status).toBe(200)
    expect(JSON.parse(readFileSync(join(dir, 'b24.json'), 'utf8')).refresh_token).toBe('b24-refresh')
  })

  it('поддельная установка: без ключа → 404; с чужим refresh → 502; токены не пишутся', async () => {
    expect((await form(OAUTH_PATHS.b24Install, { REFRESH_ID: 'install-refresh' })).status).toBe(404)
    expect((await form(`${OAUTH_PATHS.b24Install}?key=${KEY}`, { REFRESH_ID: 'forged' })).status).toBe(502)
    expect((await form(`${OAUTH_PATHS.b24Install}?key=${KEY}`, {})).status).toBe(502)
    expect(existsSync(join(dir, 'b24.json'))).toBe(false)
  })

  it('/handler (путь обработчика приложения) = /oauth/b24/handler: код обменивается, POST — только статус', async () => {
    const state = await b24State()
    expect((await get(`${OAUTH_PATHS.handler}?code=good-code&state=${state}`)).status).toBe(200)
    expect(installed).toEqual(['b24'])
    const r = await form(OAUTH_PATHS.handler, { AUTH_ID: 'x' })
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('работает на сервере владельца')
  })

  it('приложение открыли внутри Б24 (POST handler) → статус без данных, присланные токены не используются', async () => {
    const r = await form(OAUTH_PATHS.b24Handler, { AUTH_ID: 'x', REFRESH_ID: 'install-refresh' })
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('работает на сервере владельца')
    expect(fetchCalls).toEqual([])
    expect(existsSync(join(dir, 'b24.json'))).toBe(false)
  })
})

describe('Точка: /oauth/tochka/*', () => {
  it('старт → разрешение (consent) → вход владельца; callback с state → токены в файле 0600', async () => {
    expect((await get(OAUTH_PATHS.tochkaStart)).status).toBe(404)
    const r = await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}`)
    expect(r.status).toBe(302)
    const to = new URL(r.headers.get('location')!)
    expect(`${to.origin}${to.pathname}`).toBe('https://tochka.test/connect/authorize')
    expect(to.searchParams.get('consent_id')).toBe('consent-1')
    expect(to.searchParams.get('redirect_uri')).toBe(`${BASE}${OAUTH_PATHS.tochkaCallback}`)
    const state = to.searchParams.get('state')!

    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=forged`)).status).toBe(403)
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}`)).status).toBe(200)
    const file = join(dir, 'tochka.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ access_token: 't-access', refresh_token: 't-refresh' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(installed).toEqual(['tochka:main'])
  })

  it('два юрлица: без org → 404 с подсказкой; start?org=ip → callback пишет токены ИП, ООО не тронуто', async () => {
    await new Promise<void>((r) => server.close(() => r()))
    const f = fakeFetch()
    await start({ tochka: { ooo: tochkaCfg('t-ooo', 'tochka-ooo.json', f), ip: tochkaCfg('t-ip', 'tochka-ip.json', f) } }, f)
    const bare = await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}`)
    expect(bare.status).toBe(404)
    expect(await bare.text()).toContain('?org=ooo')
    expect((await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}&org=evil`)).status).toBe(404)

    const r = await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}&org=ip`)
    expect(r.status).toBe(302)
    const to = new URL(r.headers.get('location')!)
    expect(to.searchParams.get('client_id')).toBe('t-ip')
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${to.searchParams.get('state')}`)).status).toBe(200)
    expect(JSON.parse(readFileSync(join(dir, 'tochka-ip.json'), 'utf8')).refresh_token).toBe('t-refresh')
    expect(existsSync(join(dir, 'tochka-ooo.json'))).toBe(false)
    expect(installed).toEqual(['tochka:ip'])
  })

  it('TOCHKA_REDIRECT_URL: redirect_uri берётся как зарегистрирован в приложении', async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await start({ tochkaRedirect: 'https://it-uu.ru/oauth/tochka/callback' })
    const to = new URL((await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}`)).headers.get('location')!)
    expect(to.searchParams.get('redirect_uri')).toBe('https://it-uu.ru/oauth/tochka/callback')
  })

  it('state от Б24 не подходит для Точки', async () => {
    const state = await b24State()
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}`)).status).toBe(403)
  })

  it('API Точки на OAuth-токенах: 401 → обновили refresh-токеном, повторили, сохранили пару', async () => {
    const tokenFile = join(dir, 'tochka.json')
    writeFileSync(tokenFile, JSON.stringify({ access_token: 'stale', refresh_token: 't-refresh' }))
    const seen: string[] = []
    const base = fakeFetch()
    const f = (async (input: any, init?: any) => {
      if (String(input).startsWith('https://api.test/')) {
        seen.push(init.headers.authorization)
        return init.headers.authorization === 'Bearer stale' ? new Response('', { status: 401 }) : Response.json({ Data: { webhooksList: ['incomingPayment'], url: 'u' } })
      }
      return base(input, init)
    }) as unknown as typeof fetch
    const src = tochkaOAuthTokens({ clientId: 't-app', clientSecret: 't-secret', tokenFile, oauthBase: 'https://tochka.test/connect', fetchImpl: f })
    const api = tochkaApi({ token: src, base: 'https://api.test', fetchImpl: f })
    expect(await api.webhooks('t-app')).toEqual({ list: ['incomingPayment'], url: 'u' })
    expect(seen).toEqual(['Bearer stale', 'Bearer t-access-2'])
    expect(JSON.parse(readFileSync(tokenFile, 'utf8'))).toEqual({ access_token: 't-access-2', refresh_token: 't-refresh-2' })
  })
})

describe('разбор callback Точки: успех / ошибка / чужой client_id', () => {
  /** Два юрлица; state выдан стартом для org. */
  async function twoOrgs() {
    await new Promise<void>((r) => server.close(() => r()))
    const f = fakeFetch()
    await start({ tochka: { ooo: tochkaCfg('t-ooo', 'tochka-ooo.json', f), ip: tochkaCfg('t-ip', 'tochka-ip.json', f) } }, f)
  }
  const tochkaState = async (org: string) =>
    new URL((await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}&org=${org}`)).headers.get('location')!).searchParams.get('state')!
  const exchanges = () => fetchCalls.filter((c) => c.body?.includes('grant_type=authorization_code')).length

  it('успех: code + state + свой client_id → обмен, токены ООО в файле ООО', async () => {
    await twoOrgs()
    const state = await tochkaState('ooo')
    const r = await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}&client_id=t-ooo`)
    expect(r.status).toBe(200)
    expect(JSON.parse(readFileSync(join(dir, 'tochka-ooo.json'), 'utf8'))).toEqual({ access_token: 't-access', refresh_token: 't-refresh' })
    expect(existsSync(join(dir, 'tochka-ip.json'))).toBe(false)
    expect(installed).toEqual(['tochka:ooo'])
  })

  it('ошибка от Точки (?error=access_denied) → 400, код не обменивается, state сгорел, текст ошибки не в логе', async () => {
    await twoOrgs()
    const state = await tochkaState('ip')
    const r = await get(`${OAUTH_PATHS.tochkaCallback}?error=access_denied&error_description=user-said-no&state=${state}`)
    expect(r.status).toBe(400)
    expect(exchanges()).toBe(0)
    expect(installed).toEqual([])
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}`)).status).toBe(403)
    expect(logLines.some((l) => l.includes('"reason":"denied"'))).toBe(true)
    expect(logLines.join('\n')).not.toContain('user-said-no')
  })

  it('ошибка: нет code → 400, файлов токенов нет', async () => {
    await twoOrgs()
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?state=${await tochkaState('ooo')}`)).status).toBe(400)
    expect(existsSync(join(dir, 'tochka-ooo.json'))).toBe(false)
  })

  it('чужой client_id: state ООО + client_id ИП → 403, обмена нет, токены никуда не записаны', async () => {
    await twoOrgs()
    const state = await tochkaState('ooo')
    const r = await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}&client_id=t-ip`)
    expect(r.status).toBe(403)
    expect(exchanges()).toBe(0)
    expect(existsSync(join(dir, 'tochka-ooo.json'))).toBe(false)
    expect(existsSync(join(dir, 'tochka-ip.json'))).toBe(false)
    expect(logLines.some((l) => l.includes('"reason":"foreign_client"'))).toBe(true)
    expect(logLines.join('\n')).not.toContain('t-ip')
  })

  it('чужой client_id: неизвестное приложение → 403; state одноразовый — повтор со своим client_id тоже 403', async () => {
    await twoOrgs()
    const state = await tochkaState('ip')
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}&client_id=evil-app`)).status).toBe(403)
    expect((await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${state}&client_id=t-ip`)).status).toBe(403)
    expect(exchanges()).toBe(0)
    expect(installed).toEqual([])
  })
})

describe('режим установки и безопасность', () => {
  it('ключ установки не задан → /oauth/* не существуют (404)', async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await start({ setupKey: '' })
    for (const p of Object.values(OAUTH_PATHS)) expect((await get(`${p}?key=`)).status).toBe(404)
  })

  it('до установки валидный вебхук → 503 (Точка повторит), платёж не теряется молча', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
    const p = Buffer.from(JSON.stringify({ webhookType: 'incomingPayment', operationId: 'x', amount: '1.00', SidePayer: {}, SideRecipient: {} })).toString('base64url')
    const s = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), keys.privateKey).toString('base64url')
    expect((await fetch(`${origin}/tochka/webhook`, { method: 'POST', body: `${h}.${p}.${s}` })).status).toBe(503)
    expect(logLines.some((l) => l.includes('"reason":"setup_mode"'))).toBe(true)
  })

  it('в логе нет токенов, кодов, state и ключа установки', async () => {
    const state = await b24State()
    await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=${state}`)
    await get(`${OAUTH_PATHS.b24Handler}?code=good-code&state=forged`)
    await form(`${OAUTH_PATHS.b24Install}?key=${KEY}`, { REFRESH_ID: 'forged' })
    const t = await get(`${OAUTH_PATHS.tochkaStart}?key=${KEY}`)
    const ts = new URL(t.headers.get('location')!).searchParams.get('state')!
    await get(`${OAUTH_PATHS.tochkaCallback}?code=t-code&state=${ts}`)
    const all = logLines.join('\n')
    expect(logLines.length).toBeGreaterThan(0)
    for (const secret of ['b24-access', 'b24-refresh', 'good-code', 't-code', 't-access', 't-refresh', 'forged', state, ts, KEY, 'secret']) {
      expect(all, `утечка «${secret}»`).not.toContain(secret)
    }
  })
})
