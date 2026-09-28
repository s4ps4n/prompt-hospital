/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL журнала оркестратора, напр. http://127.0.0.1:8090/journal; пусто — локальный режим. */
  readonly VITE_JOURNAL_URL?: string
}
