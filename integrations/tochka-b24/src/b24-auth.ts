// Первичная авторизация локального приложения Б24: обмен OAuth-кода на токены, запись в B24_TOKEN_FILE (0600).
// 1. Открыть в браузере https://<портал>/oauth/authorize/?client_id=<B24_CLIENT_ID>
// 2. Из адреса, на который перебросит портал, скопировать параметр code (живёт 30 секунд).
// 3. node --env-file=.env src/b24-auth.ts <code>
// Дальше токены обновляются сервисом сами.

import { exchangeToken, writeTokens } from './b24.ts'

const code = process.argv[2]
const clientId = process.env.B24_CLIENT_ID
const clientSecret = process.env.B24_CLIENT_SECRET
const file = process.env.B24_TOKEN_FILE || './data/b24-tokens.json'
if (!code || !clientId || !clientSecret) {
  console.error('Использование: node --env-file=.env src/b24-auth.ts <code>  (нужны B24_CLIENT_ID, B24_CLIENT_SECRET)')
  process.exit(1)
}
writeTokens(file, await exchangeToken({ clientId, clientSecret }, { code }))
console.log(`Токены сохранены в ${file}`)
