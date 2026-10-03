import { nextLang, useLanguage } from '../i18n'
import { translations } from '../i18n/translations'
import { OUTLINE, UI, UI_EXTRA } from '../theme/colors'
import { FONT_MONO, button } from './styles'

interface TopBarProps {
  /** Текущий масштаб сцены (1 = 100%). */
  scale: number
  onAddModel: () => void
  onZoomOut: () => void
  onZoomFit: () => void
  onZoomIn: () => void
  onJournal: () => void
  onReset: () => void
}

/** Компактная шапка: название и управление. Счётчики задач и плашка связи — в нижней панели (StatusBar). */
export function TopBar({ scale, onAddModel, onZoomOut, onZoomFit, onZoomIn, onJournal, onReset }: TopBarProps) {
  const { lang, setLang, t } = useLanguage()
  const next = nextLang(lang)
  // Подсказка — на языке, на который переключаем («Switch to English» / «Переключить на русский»).
  const switchTo = translations[next]['lang.switchTo']
  const pct = Math.round(scale * 100)
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '4px 10px',
        background: UI.wood,
        border: `3px solid ${UI.console}`,
        borderRadius: 6,
        boxShadow: `inset 0 2px 0 ${UI_EXTRA.woodLight}`,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: 'inherit',
          fontWeight: 800,
          fontSize: 16,
          color: UI.button,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          textShadow: `2px 2px 0 ${OUTLINE}`,
        }}
      >
        {t('top.title')}
      </h1>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="ph-btn" style={button('primary')} onClick={onAddModel}>
          {t('top.addModel')}
        </button>
        <button type="button" className="ph-btn" style={{ ...button(), width: 32 }} onClick={onZoomOut} title={t('top.zoomOut')}>
          −
        </button>
        <button type="button" className="ph-btn" style={button()} onClick={onZoomFit} title={t('top.zoomTitle', { pct })}>
          {t('top.zoomFit')}
        </button>
        <span data-zoom={scale} style={{ alignSelf: 'center', minWidth: 38, textAlign: 'center', fontSize: 11, fontFamily: FONT_MONO, fontWeight: 700, color: UI.paper }}>
          {pct}%
        </span>
        <button type="button" className="ph-btn" style={{ ...button(), width: 32 }} onClick={onZoomIn} title={t('top.zoomIn')}>
          ＋
        </button>
        <button type="button" className="ph-btn" style={button()} onClick={onJournal}>
          {t('top.journal')}
        </button>
        <button type="button" className="ph-btn" style={button('danger')} onClick={onReset}>
          {t('top.reset')}
        </button>
        <button type="button" className="ph-btn" data-lang={lang} style={button()} onClick={() => setLang(next)} title={switchTo} aria-label={switchTo}>
          {next.toUpperCase()}
        </button>
      </div>
    </header>
  )
}
