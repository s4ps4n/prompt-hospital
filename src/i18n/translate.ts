import type { Role } from '../journal/types'
import { LANGS, translations, type Lang, type TKey } from './translations'

export const DEFAULT_LANG: Lang = 'ru'
export const LANG_STORAGE_KEY = 'ph-lang'

type Vars = Record<string, string | number>
/** Базы ключей множественного числа: `<base>.one|few|many|other` (обязателен `.other`). */
export type PluralBase = { [K in TKey]: K extends `${infer B}.other` ? B : never }[TKey]

export interface Translate {
  (key: TKey, vars?: Vars): string
  /** Множественное число по Intl.PluralRules; `{n}` подставляется. */
  plural: (base: PluralBase, n: number, vars?: Vars) => string
  /** Роль хранится в журнале по-русски (зеркалит сервер) — здесь только её подпись. */
  role: (role: Role) => string
  lang: Lang
}

const ROLE_KEY: Record<Role, TKey> = {
  координатор: 'role.coordinator',
  исполнитель: 'role.executor',
  архитектор: 'role.architect',
  фулстак: 'role.fullstack',
  сисадмин: 'role.sysadmin',
  дизайнер: 'role.designer',
  'UX/UI': 'role.uxui',
  приёмщик: 'role.acceptor',
  рецензент: 'role.reviewer',
}

export const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v)

/** Следующий язык по кругу — для кнопки-переключателя. */
export const nextLang = (lang: Lang): Lang => LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)

export function createTranslate(lang: Lang): Translate {
  const dict = translations[lang]
  const rules = new Intl.PluralRules(lang)
  const t = ((key: TKey, vars?: Vars) => fill(dict[key], vars)) as Translate
  t.plural = (base, n, vars) => {
    const key = `${base}.${rules.select(n)}`
    return fill(key in dict ? dict[key as TKey] : dict[`${base}.other` as TKey], { n, ...vars })
  }
  // Роль из внешнего журнала может оказаться незнакомой — тогда показываем как есть.
  t.role = (role) => (role in ROLE_KEY ? t(ROLE_KEY[role]) : role)
  t.lang = lang
  return t
}

export function readLang(): Lang {
  try {
    const v = globalThis.localStorage?.getItem(LANG_STORAGE_KEY)
    return isLang(v) ? v : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

export function saveLang(lang: Lang) {
  try {
    globalThis.localStorage?.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // приватный режим — выбор живёт до перезагрузки
  }
}
