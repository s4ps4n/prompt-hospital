import { COORDINATOR_ID } from '../journal/catalog'
import type { Journal, WorkerStatus } from '../journal/types'
import { OUTLINE, UI, UI_EXTRA } from '../theme/colors'
import { FONT_MONO, STATUS_META, STATUS_ORDER, button } from './styles'

interface TopBarProps {
  journal: Journal
  onAddModel: () => void
  onZoomOut: () => void
  onZoomFit: () => void
  onZoomIn: () => void
  onJournal: () => void
  onReset: () => void
}

/** Счётчики — по моделям, без координатора (его статус производный). */
function counts(j: Journal): Record<WorkerStatus, number> {
  const c: Record<WorkerStatus, number> = { run: 0, blocked: 0, wait: 0, done: 0 }
  for (const w of j.workers) if (w.id !== COORDINATOR_ID) c[w.status]++
  return c
}

export function TopBar({ journal, onAddModel, onZoomOut, onZoomFit, onZoomIn, onJournal, onReset }: TopBarProps) {
  const c = counts(journal)
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
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
        Prompt Hospital
      </h1>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STATUS_ORDER.map((s) => (
          <div
            key={s}
            data-counter={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: OUTLINE,
              borderRadius: 4,
              color: UI.paper,
              fontSize: 11,
              fontFamily: FONT_MONO,
              fontWeight: 700,
            }}
          >
            <div style={{ width: 12, height: 10, border: `1.5px solid ${UI.paper}`, background: STATUS_META[s].screen }} />
            <div>
              {STATUS_META[s].label}: {c[s]}
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="ph-btn" style={button('primary')} onClick={onAddModel}>
          ＋ Модель
        </button>
        <button type="button" className="ph-btn" style={{ ...button(), width: 32 }} onClick={onZoomOut} title="Уменьшить">
          −
        </button>
        <button type="button" className="ph-btn" style={button()} onClick={onZoomFit}>
          Вписать
        </button>
        <button type="button" className="ph-btn" style={{ ...button(), width: 32 }} onClick={onZoomIn} title="Увеличить">
          ＋
        </button>
        <button type="button" className="ph-btn" style={button()} onClick={onJournal}>
          Журнал
        </button>
        <button type="button" className="ph-btn" style={button('danger')} onClick={onReset}>
          Сброс
        </button>
      </div>
    </header>
  )
}
