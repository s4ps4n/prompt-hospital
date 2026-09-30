// Юрлица владельца в Точке. У каждого своё приложение (client_id/secret), свой р/с, свои токены и своя
// подписка на вебхук; адрес вебхука и ключ подписи Точки — общие.
//
//   TOCHKA_OOO_CLIENT_ID / _CLIENT_SECRET / _ACCOUNT_ID / _NAME / _B24_MYCOMPANY_ID [/ _API_TOKEN]
//   TOCHKA_IP_…                                                                   (то же для ИП)
//
// _ACCOUNT_ID — «р/с/БИК» (формат Точки); _B24_MYCOMPANY_ID — «Моя компания» юрлица в Б24 (обязательно, если
// юрлиц два: по нему счёт отличается от счёта другого юрлица). _INN в работе не нужен и не читается.
// Нет ни одного TOCHKA_<ЮРЛИЦО>_CLIENT_ID — старая схема с одним приложением: TOCHKA_CLIENT_ID, TOCHKA_ACCOUNTS.

import { checkAccounts, ownAccount, parseAccounts, type OwnAccount } from './tochka.ts'

export const ENTITY_PREFIXES = ['OOO', 'IP'] as const

export type TochkaProfile = {
  /** Короткий ключ для маршрутов и имён файлов: ooo / ip / main. В лог — можно (не платёжные данные). */
  key: string
  /** Название юрлица — для сообщений ответственному в Б24. */
  name: string
  clientId: string
  /** Пусто — OAuth не используется, нужен apiToken. */
  clientSecret: string
  /** JWT-ключ API из интернет-банка (альтернатива OAuth). */
  apiToken: string
  accounts: OwnAccount[]
  tokenFile: string
}

type Env = Record<string, string | undefined>

export function tochkaProfiles(env: Env, dataDir = './data'): TochkaProfile[] {
  const get = (name: string) => env[name]?.trim() ?? ''
  const profiles: TochkaProfile[] = []

  for (const prefix of ENTITY_PREFIXES) {
    const p = `TOCHKA_${prefix}_`
    if (!get(`${p}CLIENT_ID`)) continue
    const key = prefix.toLowerCase()
    profiles.push({
      key,
      name: get(`${p}NAME`) || prefix,
      clientId: get(`${p}CLIENT_ID`),
      clientSecret: get(`${p}CLIENT_SECRET`),
      apiToken: get(`${p}API_TOKEN`),
      accounts: [ownAccount(get(`${p}ACCOUNT_ID`), get(`${p}B24_MYCOMPANY_ID`), `${p}ACCOUNT_ID`)],
      tokenFile: get(`${p}TOKEN_FILE`) || `${dataDir}/tochka-${key}-tokens.json`,
    })
  }

  if (profiles.length === 0) {
    if (!get('TOCHKA_CLIENT_ID')) throw new Error('env TOCHKA_OOO_CLIENT_ID / TOCHKA_IP_CLIENT_ID (or legacy TOCHKA_CLIENT_ID) is required')
    profiles.push({
      key: 'main',
      name: get('TOCHKA_NAME') || 'Точка',
      clientId: get('TOCHKA_CLIENT_ID'),
      clientSecret: get('TOCHKA_CLIENT_SECRET'),
      apiToken: get('TOCHKA_API_TOKEN'),
      accounts: parseAccounts(get('TOCHKA_ACCOUNTS'), get('TOCHKA_ACCOUNT_ID')),
      tokenFile: get('TOCHKA_TOKEN_FILE') || `${dataDir}/tochka-tokens.json`,
    })
  }

  for (const p of profiles) {
    if (!p.clientSecret && !p.apiToken) throw new Error(`Tochka «${p.key}»: CLIENT_SECRET (OAuth) or API_TOKEN is required`)
  }
  checkAccounts(profiles.flatMap((p) => p.accounts))
  return profiles
}
