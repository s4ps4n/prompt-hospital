import { useT } from '../i18n'
import { taskCounts, type TaskCounts } from '../journal/selectors'
import type { Journal } from '../journal/types'
import { OUTLINE, UI } from '../theme/colors'
import { FONT_MONO, STATUS_META } from './styles'

/** Счётчики задач, не моделей. «Выполнено» нет: закрытые задачи журнал не хранит. */
const COUNTER_ORDER: readonly (keyof TaskCounts)[] = ['run', 'blocked', 'wait']

/** «Задачи: в работе N · заблокировано N · ожидают N» — в нижней панели. */
export function TaskCounters({ journal }: { journal: Journal }) {
  const c = taskCounts(journal)
  const t = useT()
  return (
    <div data-counters style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontFamily: FONT_MONO, fontWeight: 700, color: UI.paper }}>{t('counter.tasks')}</span>
      {COUNTER_ORDER.map((s) => (
        <div
          key={s}
          data-counter={s}
          title={t(`counter.${s}.title`)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            background: OUTLINE,
            borderRadius: 4,
            color: UI.paper,
            fontSize: 11,
            fontFamily: FONT_MONO,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ width: 12, height: 10, border: `1.5px solid ${UI.paper}`, background: STATUS_META[s].screen }} />
          <div>
            {t(`counter.${s}`)}: {c[s]}
          </div>
        </div>
      ))}
    </div>
  )
}
