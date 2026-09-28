import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LanguageContext } from './context'
import { createTranslate, readLang, saveLang } from './translate'
import type { Lang } from './translations'

/** Язык интерфейса: по умолчанию русский, выбор сохраняется в localStorage. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(readLang)
  const setLang = useCallback((next: Lang) => {
    saveLang(next)
    setLangState(next)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const value = useMemo(() => ({ lang, setLang, t: createTranslate(lang) }), [lang, setLang])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
