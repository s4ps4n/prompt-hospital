import { useT } from '../i18n'
import { UI } from '../theme/colors'
import { FONT_MONO } from './styles'

/**
 * Откуда офис взял журнал: `demo` — локальный макет (адрес не задан, оркестратор не ответил или ещё отвечает),
 * `live` — журнал оркестратора, `stale` — журнал оркестратора, но последний опрос не прошёл.
 */
export type JournalSource =
  | { kind: 'demo'; reason: 'off' | 'connecting' | 'down'; url?: string }
  | { kind: 'live' | 'stale'; url: string }

const LIVE_BG = '#1d3a1a'
const STALE_BG = '#6a4a08'

/** Плашка в нижней панели: демо — красная и самая заметная, чтобы макет не приняли за реальность. */
export function SourceBanner({ source }: { source: JournalSource }) {
  const t = useT()
  const base = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 10px',
    borderRadius: 4,
    fontFamily: FONT_MONO,
    fontSize: 12,
    fontWeight: 700,
    boxSizing: 'border-box',
  } as const

  if (source.kind === 'live') {
    return (
      <div data-source="live" role="note" aria-label={t('source.label')} style={{ ...base, background: LIVE_BG, color: UI.ok, border: `2px solid ${UI.ok}` }}>
        {t('source.live')}: {source.url}
      </div>
    )
  }
  if (source.kind !== 'demo') {
    return (
      <div data-source="stale" role="alert" aria-label={t('source.label')} style={{ ...base, background: STALE_BG, color: UI.paperLight, border: `3px solid ${UI.button}` }}>
        {t('source.stale', { url: source.url })}
      </div>
    )
  }
  return (
    <div
      data-source="demo"
      role="alert"
      aria-label={t('source.label')}
      style={{ ...base, flex: '1 1 100%', padding: '4px 10px', background: UI.danger, color: UI.paperLight, border: `3px solid ${UI.paperLight}` }}
    >
      <span style={{ fontSize: 14, letterSpacing: 1, whiteSpace: 'nowrap' }}>{t('source.demo')}</span>
      <span>{t(`source.${source.reason}`, { url: source.url ?? '' })}</span>
    </div>
  )
}
