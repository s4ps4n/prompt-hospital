// Однократная подписка на вебхук incomingPayment в Точке — для каждого юрлица (своё приложение), дальше подписку
// проверяет ежедневная сверка. Нужен токен с правом ManageWebhookData: TOCHKA_<ЮРЛИЦО>_API_TOKEN или OAuth-токены
// после /oauth/tochka/start?org=…
// Если подписку делает персональный менеджер Точки — передайте ему PUBLIC_WEBHOOK_URL; скрипт тогда только покажет статус.
// Запуск: node --env-file=.env src/subscribe.ts

import { tochkaProfiles } from './config.ts'
import { DEFAULT_WEBHOOK_PATH } from './server.ts'
import { tochkaApi, tochkaOAuthTokens } from './tochka.ts'

const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '')
const url = process.env.PUBLIC_WEBHOOK_URL || (base ? `${base}${process.env.WEBHOOK_PATH || DEFAULT_WEBHOOK_PATH}` : '')
if (!url) {
  console.error('Нужен PUBLIC_WEBHOOK_URL или PUBLIC_BASE_URL')
  process.exit(1)
}

let ok = true
for (const p of tochkaProfiles(process.env)) {
  const api = tochkaApi({ token: p.apiToken || tochkaOAuthTokens({ clientId: p.clientId, clientSecret: p.clientSecret, tokenFile: p.tokenFile }) })
  try {
    await api.subscribe(p.clientId, url)
    const w = await api.webhooks(p.clientId)
    const good = w.list.includes('incomingPayment') && w.url === url
    ok &&= good
    console.log(`${p.name}: ${w.list.join(', ') || '—'} → ${w.url || '—'}${good ? '' : '  ✗'}`)
  } catch (e) {
    ok = false
    console.log(`${p.name}: ошибка ${(e as Error).name}`)
  }
}
process.exit(ok ? 0 : 1)
