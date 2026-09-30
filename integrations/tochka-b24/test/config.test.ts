// Конфиг юрлиц (секреты TOCHKA_OOO_* / TOCHKA_IP_*) и проверка подписи вебхука по сохранённому JWK.

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tochkaProfiles } from '../src/config.ts'
import { fileKeys, keyFingerprint, parseKeys, SignatureError, verifyJwt, verifyWebhook } from '../src/tochka.ts'

const OOO_ACC = '40702810900000012345/044525104'
const IP_ACC = '40802810900000054321/044525104'

const env = {
  TOCHKA_OOO_CLIENT_ID: 'c-ooo',
  TOCHKA_OOO_CLIENT_SECRET: 's-ooo',
  TOCHKA_OOO_INN: '7707083893',
  TOCHKA_OOO_ACCOUNT_ID: OOO_ACC,
  TOCHKA_OOO_NAME: 'ООО «Айтитек»',
  TOCHKA_OOO_B24_MYCOMPANY_ID: '1',
  TOCHKA_IP_CLIENT_ID: 'c-ip',
  TOCHKA_IP_CLIENT_SECRET: 's-ip',
  TOCHKA_IP_INN: '500100732259',
  TOCHKA_IP_ACCOUNT_ID: IP_ACC,
  TOCHKA_IP_NAME: 'ИП Иванов',
  TOCHKA_IP_B24_MYCOMPANY_ID: '2',
}

describe('юрлица из env (TOCHKA_OOO_* / TOCHKA_IP_*)', () => {
  it('два приложения Точки: свои client_id, р/с, «Моя компания» и файлы токенов', () => {
    expect(tochkaProfiles(env, '/data')).toEqual([
      { key: 'ooo', name: 'ООО «Айтитек»', clientId: 'c-ooo', clientSecret: 's-ooo', apiToken: '', accounts: [{ id: OOO_ACC, entity: 1 }], tokenFile: '/data/tochka-ooo-tokens.json' },
      { key: 'ip', name: 'ИП Иванов', clientId: 'c-ip', clientSecret: 's-ip', apiToken: '', accounts: [{ id: IP_ACC, entity: 2 }], tokenFile: '/data/tochka-ip-tokens.json' },
    ])
  })

  it('два юрлица без B24_MYCOMPANY_ID → отказ при старте: платёж не отличить', () => {
    expect(() => tochkaProfiles({ ...env, TOCHKA_IP_B24_MYCOMPANY_ID: '' })).toThrow(/mycompanyId/)
  })

  it('кривой р/с → отказ; номер счёта в текст ошибки не попадает', () => {
    const bad = '4070281090000001234'
    expect(() => tochkaProfiles({ ...env, TOCHKA_OOO_ACCOUNT_ID: bad })).toThrow(/TOCHKA_OOO_ACCOUNT_ID/)
    try {
      tochkaProfiles({ ...env, TOCHKA_OOO_ACCOUNT_ID: bad })
    } catch (e) {
      expect((e as Error).message).not.toContain('4070')
    }
  })

  it('нет ни секрета, ни API-токена → отказ', () => {
    expect(() => tochkaProfiles({ ...env, TOCHKA_IP_CLIENT_SECRET: '' })).toThrow(/ip/)
  })

  it('одно юрлицо — «Моя компания» не обязательна', () => {
    const p = tochkaProfiles({ TOCHKA_IP_CLIENT_ID: 'c', TOCHKA_IP_API_TOKEN: 't', TOCHKA_IP_ACCOUNT_ID: IP_ACC })
    expect(p.map((x) => [x.key, x.accounts])).toEqual([['ip', [{ id: IP_ACC, entity: null }]]])
  })

  it('старая схема с одним приложением (TOCHKA_CLIENT_ID + TOCHKA_ACCOUNT_ID) работает', () => {
    const p = tochkaProfiles({ TOCHKA_CLIENT_ID: 'c', TOCHKA_API_TOKEN: 't', TOCHKA_ACCOUNT_ID: OOO_ACC })
    expect(p).toMatchObject([{ key: 'main', clientId: 'c', apiToken: 't', accounts: [{ id: OOO_ACC, entity: null }] }])
  })
})

describe('подпись вебхука по сохранённому JWK (TOCHKA_JWK_FILE)', () => {
  const tochka = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 })

  const token = (payload: object, key: KeyObject) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`
  }

  const saveJwk = (content: object) => {
    const file = join(mkdtempSync(join(tmpdir(), 'tb24-jwk-')), 'tochka_jwk.json')
    writeFileSync(file, JSON.stringify(content))
    return file
  }

  // Точка отдаёт JWK с kty/e/n и служебными полями (kid/alg/use) — они не мешают.
  const jwk = { ...tochka.publicKey.export({ format: 'jwk' }), kid: 'tochka-1', alg: 'RS256', use: 'sig' }

  it.each([
    ['одиночный JWK', jwk],
    ['JWKS { keys: [...] }', { keys: [jwk] }],
  ])('%s: подпись Точки проходит, чужая — SignatureError', async (_, content) => {
    const keys = await fileKeys(saveJwk(content)).keys()
    const body = { webhookType: 'incomingPayment', operationId: 'op-1' }
    expect(verifyJwt(token(body, tochka.privateKey), keys)).toMatchObject(body)
    expect(() => verifyJwt(token(body, stranger.privateKey), keys)).toThrow(SignatureError)
  })

  it('отпечаток ключа (src/check-key.ts): JWK и PEM одного ключа совпадают, чужой — отличается', async () => {
    const [fromJwk] = await fileKeys(saveJwk(jwk)).keys()
    const [fromPem] = parseKeys(tochka.publicKey.export({ type: 'spki', format: 'pem' }) as string)
    expect(keyFingerprint(fromJwk)).toMatch(/^[0-9a-f]{16}$/)
    expect(keyFingerprint(fromJwk)).toBe(keyFingerprint(fromPem))
    expect(keyFingerprint(fromJwk)).not.toBe(keyFingerprint(stranger.publicKey))
  })

  it('aud — любой из client_id наших приложений (ООО или ИП), чужой — отказ', async () => {
    const keys = await fileKeys(saveJwk(jwk)).keys()
    const check = { aud: ['c-ooo', 'c-ip'] }
    expect(() => verifyJwt(token({ aud: 'c-ip' }, tochka.privateKey), keys, check)).not.toThrow()
    expect(() => verifyJwt(token({ aud: ['x', 'c-ooo'] }, tochka.privateKey), keys, check)).not.toThrow()
    expect(() => verifyJwt(token({ aud: 'evil' }, tochka.privateKey), keys, check)).toThrow(SignatureError)
    expect(() => verifyJwt(token({}, tochka.privateKey), keys, check)).toThrow(SignatureError)
  })

  describe('verifyWebhook: тело вебхука (строка JWT) → payload или null, без исключений', () => {
    const now = Math.floor(Date.now() / 1000)
    const body = { webhookType: 'incomingPayment', operationId: 'op-1', iss: 'tochka', aud: 'c-ooo', exp: now + 300 }
    const keys = () => fileKeys(saveJwk(jwk)).keys()

    it('валидная подпись сохранённым JWK → payload', async () => {
      expect(verifyWebhook(token(body, tochka.privateKey), await keys())).toEqual(body)
      expect(verifyWebhook(`${token(body, tochka.privateKey)}\n`, await keys(), { iss: 'tochka', aud: ['c-ooo', 'c-ip'] })).toEqual(body)
    })

    it('битая подпись → null', async () => {
      const k = await keys()
      const good = token(body, tochka.privateKey)
      const [h, , s] = good.split('.')
      const forged = Buffer.from(JSON.stringify({ ...body, operationId: 'op-2' })).toString('base64url')
      expect(verifyWebhook(`${h}.${forged}.${s}`, k)).toBeNull()
      expect(verifyWebhook(`${good.slice(0, -4)}AAAA`, k)).toBeNull()
      expect(verifyWebhook(token(body, stranger.privateKey), k)).toBeNull()
    })

    it('просроченный токен → null', async () => {
      expect(verifyWebhook(token({ ...body, exp: now - 1 }, tochka.privateKey), await keys())).toBeNull()
    })

    it('чужой iss / aud → null', async () => {
      const k = await keys()
      expect(verifyWebhook(token(body, tochka.privateKey), k, { iss: 'other' })).toBeNull()
      expect(verifyWebhook(token(body, tochka.privateKey), k, { aud: 'evil' })).toBeNull()
    })

    it('alg=none / HS256 → null', async () => {
      const k = await keys()
      const p = Buffer.from(JSON.stringify(body)).toString('base64url')
      for (const alg of ['none', 'HS256']) {
        const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')
        expect(verifyWebhook(`${h}.${p}.`, k)).toBeNull()
      }
    })

    it.each([
      ['пустая строка', ''],
      ['JSON вместо JWT', JSON.stringify(body)],
      ['мусор', 'not a jwt'],
      ['три части не-base64', '%%%.$$$.###'],
      ['не JSON в заголовке', 'YWJj.YWJj.YWJj'],
      ['не строка', 42 as unknown as string],
    ])('мусор вместо JWT (%s) → null', async (_, raw) => {
      expect(verifyWebhook(raw, await keys())).toBeNull()
    })
  })
})
