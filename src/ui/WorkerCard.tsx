import { useEffect, useState, type PointerEvent } from 'react'
import { useT } from '../i18n'
import { COORDINATOR_ID, COORDINATOR_ROLE, ROLES, isAssignableRole, resolveCatalogEntry } from '../journal/catalog'
import { currentTask, trayTasks, workerQueue } from '../journal/selectors'
import type { AssignableRole, Journal, Role, Worker } from '../journal/types'
import { displayStatus } from '../scene'
import { OUTLINE, UI, UI_EXTRA, roleColor } from '../theme/colors'
import { Avatar } from './Avatar'
import {
  bumpPriority,
  button,
  field,
  flag,
  miniButton,
  panel,
  sectionLabel,
  STATUS_META,
  taskRow,
} from './styles'
import type { CheckOp, RunOp, StartDrag } from './types'

/** Длительность тряски select'а роли (анимация .4s + запас). */
const FLASH_MS = 650

interface WorkerCardProps {
  journal: Journal
  worker: Worker
  run: RunOp
  check: CheckOp
  /** Сообщение об отказе (в строку сообщений). */
  onDenied: (err: string) => void
  onClose: () => void
  onClone: (model: string, role: AssignableRole) => void
  /** Перетаскивание задач очереди: на другую задачу очереди — reorder, на комнату — reassign. */
  onStartDrag: StartDrag
}

/** Кнопки внутри перетаскиваемой строки не начинают drag. */
const stop = (e: PointerEvent) => e.stopPropagation()

/** Любая роль, отличная от текущей: для сухого прогона setRole и «экземпляра с другой ролью». */
function otherRole(role: Role): AssignableRole {
  return ROLES.find((r) => r !== role) ?? ROLES[0]
}

export function WorkerCard({ journal, worker: w, run, check, onDenied, onClose, onClone, onStartDrag }: WorkerCardProps) {
  const t = useT()
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(false), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  const isCoord = w.id === COORDINATOR_ID
  const status = displayStatus(journal, w)
  const cur = currentTask(journal, w.id)
  const queue = workerQueue(journal, w.id)
  const entry = resolveCatalogEntry(w.model, w.provider)
  const locked = isCoord || !!w.task

  // Причину отказа берём у журнала (сухой прогон), а не дублируем текст в UI.
  const tryLockedRole = () => {
    if (!locked) return
    const r = check('setRole', { worker: w.id, role: otherRole(w.role) })
    setFlash(true)
    if ('err' in r) onDenied(r.err)
  }

  return (
    <aside aria-label={t('card.label')} style={{ ...panel, flex: '0 0 290px', gap: 12, padding: 12, minHeight: 380, overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div
          style={{
            flex: '0 0 auto',
            width: 64,
            height: 84,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            background: roleColor(w.role),
            border: `2px solid ${OUTLINE}`,
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {entry && <Avatar worker={{ ...w, status }} entry={entry} width={60} height={82} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, font: 'inherit', fontSize: 17, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em' }}>{w.name}</h2>
          <div style={{ fontSize: 12, color: UI_EXTRA.muted }}>
            {w.provider} · {w.id}
          </div>
          <div
            data-status={status}
            style={{
              alignSelf: 'flex-start',
              padding: '3px 8px',
              background: STATUS_META[status].color,
              color: '#fff',
              border: `2px solid ${OUTLINE}`,
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {t(`status.${status}`)}
          </div>
        </div>
        <button type="button" aria-label={t('card.close')} onClick={onClose} style={{ ...miniButton, width: 26, height: 26, fontSize: 14, fontWeight: 800 }}>
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="ph-role" style={sectionLabel}>
          {t('card.role')}
        </label>
        <div data-testid="role-lock" className={flash ? 'ph-nope' : undefined} onClick={tryLockedRole} style={{ borderRadius: 4 }}>
          <select
            id="ph-role"
            value={w.role}
            disabled={locked}
            onChange={(e) => {
              const role = e.target.value
              if (isAssignableRole(role)) run('setRole', { worker: w.id, role })
            }}
            style={{
              ...field,
              width: '100%',
              fontSize: 13,
              fontWeight: 700,
              borderColor: flash ? UI_EXTRA.highlight : OUTLINE,
              background: locked ? UI_EXTRA.locked : UI.paperLight,
              pointerEvents: locked ? 'none' : 'auto',
            }}
          >
            {(isCoord ? [COORDINATOR_ROLE] : ROLES).map((r) => (
              <option key={r} value={r}>
                {t.role(r)}
              </option>
            ))}
          </select>
        </div>
        {locked && (
          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.4, color: flash ? UI.danger : UI_EXTRA.muted }}>
            {isCoord ? t('card.coordLocked') : t('card.roleLocked')}
          </div>
        )}
      </div>

      {isCoord ? (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: UI_EXTRA.history }}>
          {t('card.coordInfo', { tasks: t.plural('tasks', trayTasks(journal).length) })}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={sectionLabel}>{t('card.current')}</div>
            {cur ? (
              <>
                <div style={taskRow}>
                  <div style={flag(cur.priority, 22)} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{cur.title}</div>
                    <div style={{ fontSize: 10, color: UI_EXTRA.muted }}>
                      {cur.id} · {t(`priority.${cur.priority}`)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="ph-btn" style={button('ok', true)} onClick={() => run('complete', { worker: w.id })}>
                    {t('card.complete')}
                  </button>
                  <button type="button" className="ph-btn" style={button('paper', true)} onClick={() => run('block', { worker: w.id })}>
                    {w.status === 'blocked' ? t('card.unblock') : t('card.block')}
                  </button>
                  <button type="button" className="ph-btn" style={button('paper', true)} onClick={() => run('unassign', { task: cur.id })}>
                    {t('card.toTray')}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: 8, fontSize: 12, color: UI_EXTRA.muted, border: `2px dashed ${UI_EXTRA.dashed}`, borderRadius: 4 }}>
                {t('card.free')}
              </div>
            )}
          </div>

          {queue.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={sectionLabel}>{t('card.queue')}</div>
              <ul aria-label={t('card.queue')} data-drop={w.id} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {queue.map((task) => {
                  const up = bumpPriority(task.priority, 1)
                  const down = bumpPriority(task.priority, -1)
                  return (
                    <li
                      key={task.id}
                      data-queue-task={task.id}
                      data-drop={w.id}
                      data-task-slot={task.id}
                      onPointerDown={(e) => onStartDrag(e, task.id)}
                      style={{ ...taskRow, padding: '6px 8px', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
                    >
                      <div style={flag(task.priority, 20)} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700 }}>{task.title}</div>
                      <button type="button" style={{ ...miniButton, height: 20 }} title={t('priority.up')} disabled={!up} onPointerDown={stop} onClick={() => up && run('setPriority', { task: task.id, priority: up })}>
                        ▲
                      </button>
                      <button type="button" style={{ ...miniButton, height: 20 }} title={t('priority.down')} disabled={!down} onPointerDown={stop} onClick={() => down && run('setPriority', { task: task.id, priority: down })}>
                        ▼
                      </button>
                      <button type="button" style={{ ...miniButton, height: 20, fontSize: 10 }} title={t('card.returnToTray')} onPointerDown={stop} onClick={() => run('unassign', { task: task.id })}>
                        ↩
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={sectionLabel}>{t('card.done', { n: w.doneCount })}</div>
            {w.history.slice(0, 5).map((h, i) => (
              <div key={i} style={{ fontSize: 11, color: UI_EXTRA.history }}>
                ✓ {h}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10, borderTop: `2px dashed ${UI_EXTRA.dashed}` }}>
            <button type="button" className="ph-btn" style={button('primary', true)} onClick={() => onClone(w.model, otherRole(w.role))}>
              {t('card.clone')}
            </button>
            <button type="button" className="ph-btn" style={button('danger', true)} onClick={() => run('removeWorker', { worker: w.id })}>
              {t('card.remove')}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
