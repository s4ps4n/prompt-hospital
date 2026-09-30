// Проверка сохранённого публичного ключа Точки (TOCHKA_JWK_FILE) на боевом сервере — запускать от того,
// кто может прочитать файл (права 600):
//   node --env-file=.env src/check-key.ts                 — ключ читается, RSA ≥ 2048, совпадает с JWKS Точки
//   node --env-file=.env src/check-key.ts <файл с JWT>    — плюс подпись настоящего вебхука (тело запроса как есть)
// Наружу уходит только GET публичного JWKS Точки. Содержимое JWT не печатается — только имена полей.

import { readFileSync } from 'node:fs'
import { jwksKeys, keyFingerprint, parseKeys, SignatureError, TOCHKA_JWKS, verifyJwt } from './tochka.ts'

const file = process.env.TOCHKA_JWK_FILE || process.env.TOCHKA_PUBLIC_KEY_FILE
if (!file) {
  console.error('Не задан TOCHKA_JWK_FILE')
  process.exit(1)
}

let ok = true
const keys = parseKeys(readFileSync(file, 'utf8'))
for (const k of keys) {
  const bits = k.asymmetricKeyDetails?.modulusLength ?? 0
  const good = k.asymmetricKeyType === 'rsa' && bits >= 2048
  ok &&= good
  console.log(`${good ? 'OK ' : 'ERR'} ключ ${keyFingerprint(k)}: ${k.asymmetricKeyType} ${bits} бит`)
}

const url = process.env.TOCHKA_JWKS_URL || TOCHKA_JWKS
try {
  const published = new Set((await jwksKeys(url).keys()).map(keyFingerprint))
  const same = keys.some((k) => published.has(keyFingerprint(k)))
  console.log(`${same ? 'OK ' : 'WARN'} JWKS Точки (${url}): ${same ? 'ключ совпадает' : `ключ не найден, опубликованы: ${[...published].join(', ')}`}`)
} catch {
  console.log(`WARN JWKS Точки (${url}) недоступен — сверка с опубликованным ключом пропущена`)
}

const jwtFile = process.argv[2]
if (jwtFile) {
  try {
    const payload = verifyJwt(readFileSync(jwtFile, 'utf8'), keys)
    console.log(`OK  подпись JWT верна; поля: ${Object.keys(payload).join(', ')}`)
    console.log(`    iss=${JSON.stringify(payload.iss)} aud=${JSON.stringify(payload.aud)} → TOCHKA_JWT_ISS / TOCHKA_JWT_AUD`)
  } catch (e) {
    ok = false
    console.log(`ERR JWT: ${e instanceof SignatureError ? e.message : 'не прочитан'}`)
  }
}

process.exit(ok ? 0 : 1)
