import { createContext, useContext } from 'react'
import { DEFAULT_LANG, createTranslate, type Translate } from './translate'
import type { Lang } from './translations'

export interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
}

// Без провайдера (изолированные тесты компонентов) — язык по умолчанию, переключение не работает.
export const LanguageContext = createContext<LanguageContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: createTranslate(DEFAULT_LANG),
})

export const useLanguage = () => useContext(LanguageContext)
export const useT = () => useContext(LanguageContext).t
