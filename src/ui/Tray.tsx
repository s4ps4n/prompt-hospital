import { useState, type KeyboardEvent } from 'react'
import { ROLES, isAssignableRole } from '../journal/catalog'
import { trayTasks } from '../journal/selectors'
import type { Journal, Priority } from '../journal/types'
import { OUTLINE } from '../theme/colors'
import {
  UI_EXTRA,
  bumpPriority,
  button,
  field,
  flag,
  miniButton,
  panel,
  pluralTasks,
  priorityLabel,
  taskRow,
} from './styles'
import { TRAY_DROP, type RunOp, type StartDrag } from './types'

interface TrayProps {
  journal: Journal
  /** Подсветка: над лотком сейчас держат конверт. */
  over: boolean
  run: RunOp
  onStartDrag: StartDrag
}

const PRIORITIES: readonly Priority[] = [3, 2, 1]

/** Лоток Гермеса: неназначенные задачи и форма новой задачи. */
export function Tray({ journal, over, run, onStartDrag }: TrayProps) {
  const tasks = trayTasks(journal)
  // Черновик формы — локальное состояние ввода, а не копия журнала.
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>(2)
  const [kind, setKind] = useState('')

  const addTask = () => {
    const r = run('addTask', { title, priority, kind: isAssignableRole(kind) ? kind : null })
    if ('msg' in r) setTitle('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') addTask()
  }
  const setPrio = (id: string, p: Priority | null) => {
    if (p) run('setPriority', { task: id, priority: p })
  }

  return (
    <section
      data-drop={TRAY_DROP}
      aria-label="Лоток Гермеса"
      style={{ ...panel, flex: '0 0 250px', gap: 8, padding: 10, minHeight: 380, borderColor: over ? UI_EXTRA.highlight : OUTLINE }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, font: 'inherit', fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Лоток Гермеса
        </h2>
        <div style={{ fontSize: 11, color: UI_EXTRA.muted }}>{pluralTasks(tasks.length)}</div>
      </div>
      <div style={{ fontSize: 11, color: UI_EXTRA.muted, lineHeight: 1.45 }}>
        Тащите конверт на комнату модели. Бросите на другой конверт в лотке — встанет перед ним и возьмёт его приоритет.
      </div>
      <ul style={{ listStyle: 'none', margin: 0, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', flex: 1, minHeight: 0, padding: 2 }}>
        {tasks.map((t) => (
          <li
            key={t.id}
            data-drop={TRAY_DROP}
            data-task-slot={t.id}
            onPointerDown={(e) => onStartDrag(e, t.id)}
            style={{
              ...taskRow,
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
              boxShadow: '2px 2px 0 rgba(36,26,12,.25)',
            }}
          >
            <div style={flag(t.priority)} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{t.title}</div>
              <div style={{ fontSize: 10, color: UI_EXTRA.muted }}>
                {t.id} · {priorityLabel(t.priority)} · {t.kind ? `только ${t.kind}` : 'любая роль'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button
                type="button"
                style={miniButton}
                title="Повысить приоритет"
                disabled={!bumpPriority(t.priority, 1)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPrio(t.id, bumpPriority(t.priority, 1))}
              >
                ▲
              </button>
              <button
                type="button"
                style={miniButton}
                title="Понизить приоритет"
                disabled={!bumpPriority(t.priority, -1)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPrio(t.id, bumpPriority(t.priority, -1))}
              >
                ▼
              </button>
            </div>
          </li>
        ))}
        {tasks.length === 0 && (
          <li style={{ padding: '16px 8px', textAlign: 'center', fontSize: 12, color: UI_EXTRA.muted, border: `2px dashed ${UI_EXTRA.dashed}`, borderRadius: 4 }}>
            Лоток пуст
          </li>
        )}
      </ul>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: `2px dashed ${UI_EXTRA.dashed}` }}>
        <input
          aria-label="Название задачи"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder="Новая задача…"
          style={field}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            aria-label="Приоритет"
            value={priority}
            onChange={(e) => {
              const p = PRIORITIES.find((x) => String(x) === e.target.value)
              if (p) setPriority(p)
            }}
            style={{ ...field, flex: 1, fontSize: 11, padding: 5 }}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p)}
              </option>
            ))}
          </select>
          <select aria-label="Роль задачи" value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, flex: 1, fontSize: 11, padding: 5 }}>
            <option value="">любая роль</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="ph-btn" style={button('primary')} onClick={addTask}>
          ＋ В лоток
        </button>
      </div>
    </section>
  )
}
