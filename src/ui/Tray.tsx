import { useState, type KeyboardEvent } from 'react'
import { useT } from '../i18n'
import { ROLES, isAssignableRole } from '../journal/catalog'
import { trayTasks } from '../journal/selectors'
import type { Journal, Priority } from '../journal/types'
import { OUTLINE, UI_EXTRA } from '../theme/colors'
import {
  bumpPriority,
  button,
  field,
  flag,
  miniButton,
  panel,
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
  const t = useT()
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
      aria-label={t('tray.title')}
      style={{ ...panel, flex: '0 0 250px', gap: 8, padding: 10, minHeight: 380, borderColor: over ? UI_EXTRA.highlight : OUTLINE }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, font: 'inherit', fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {t('tray.title')}
        </h2>
        <div style={{ fontSize: 11, color: UI_EXTRA.muted }}>{t.plural('tasks', tasks.length)}</div>
      </div>
      <div style={{ fontSize: 11, color: UI_EXTRA.muted, lineHeight: 1.45 }}>
        {t('tray.hint')}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', flex: 1, minHeight: 0, padding: 2 }}>
        {tasks.map((task) => (
          <li
            key={task.id}
            data-drop={TRAY_DROP}
            data-task-slot={task.id}
            onPointerDown={(e) => onStartDrag(e, task.id)}
            style={{
              ...taskRow,
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
              boxShadow: '2px 2px 0 rgba(36,26,12,.25)',
            }}
          >
            <div style={flag(task.priority)} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{task.title}</div>
              <div style={{ fontSize: 10, color: UI_EXTRA.muted }}>
                {task.id} · {t(`priority.${task.priority}`)} · {task.kind ? t('task.onlyKind', { kind: t.role(task.kind) }) : t('task.anyRole')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button
                type="button"
                style={miniButton}
                title={t('priority.up')}
                disabled={!bumpPriority(task.priority, 1)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPrio(task.id, bumpPriority(task.priority, 1))}
              >
                ▲
              </button>
              <button
                type="button"
                style={miniButton}
                title={t('priority.down')}
                disabled={!bumpPriority(task.priority, -1)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPrio(task.id, bumpPriority(task.priority, -1))}
              >
                ▼
              </button>
            </div>
          </li>
        ))}
        {tasks.length === 0 && (
          <li style={{ padding: '16px 8px', textAlign: 'center', fontSize: 12, color: UI_EXTRA.muted, border: `2px dashed ${UI_EXTRA.dashed}`, borderRadius: 4 }}>
            {t('tray.empty')}
          </li>
        )}
      </ul>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: `2px dashed ${UI_EXTRA.dashed}` }}>
        <input
          aria-label={t('tray.newTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('tray.newPlaceholder')}
          style={field}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            aria-label={t('tray.priority')}
            value={priority}
            onChange={(e) => {
              const p = PRIORITIES.find((x) => String(x) === e.target.value)
              if (p) setPriority(p)
            }}
            style={{ ...field, flex: 1, fontSize: 11, padding: 5 }}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>
          <select aria-label={t('tray.kind')} value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, flex: 1, fontSize: 11, padding: 5 }}>
            <option value="">{t('task.anyRole')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.role(r)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="ph-btn" style={button('primary')} onClick={addTask}>
          {t('tray.add')}
        </button>
      </div>
    </section>
  )
}
