import { useEffect, useState, type PointerEvent } from 'react'
import { COORDINATOR_ID, COORDINATOR_ROLE, ROLES, findCatalogEntry, isAssignableRole } from '../journal/catalog'
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
  pluralTasks,
  priorityLabel,
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
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])

  const isCoord = w.id === COORDINATOR_ID
  const status = displayStatus(journal, w)
  const cur = currentTask(journal, w.id)
  const queue = workerQueue(journal, w.id)
  const entry = findCatalogEntry(w.model)
  const locked = isCoord || !!w.task

  // Причину отказа берём у журнала (сухой прогон), а не дублируем текст в UI.
  const tryLockedRole = () => {
    if (!locked) return
    const r = check('setRole', { worker: w.id, role: otherRole(w.role) })
    setFlash(true)
    if ('err' in r) onDenied(r.err)
  }

  return (
    <aside aria-label="Карточка модели" style={{ ...panel, flex: '0 0 290px', gap: 12, padding: 12, minHeight: 380, overflow: 'auto' }}>
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
            {STATUS_META[status].label}
          </div>
        </div>
        <button type="button" aria-label="Закрыть карточку" onClick={onClose} style={{ ...miniButton, width: 26, height: 26, fontSize: 14, fontWeight: 800 }}>
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="ph-role" style={sectionLabel}>
          Роль
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
                {r}
              </option>
            ))}
          </select>
        </div>
        {locked && (
          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.4, color: flash ? UI.danger : UI_EXTRA.muted }}>
            {isCoord ? 'Роль координатора закреплена.' : 'Нельзя сменить роль, пока модель в работе. Сначала заверши или сними задачу.'}
          </div>
        )}
      </div>

      {isCoord ? (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: UI_EXTRA.history }}>
          Координатор раздаёт задачи. В лотке {pluralTasks(trayTasks(journal).length)}. Возьмите конверт со стола или из лотка слева и бросьте на комнату модели.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={sectionLabel}>Текущая задача</div>
            {cur ? (
              <>
                <div style={taskRow}>
                  <div style={flag(cur.priority, 22)} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{cur.title}</div>
                    <div style={{ fontSize: 10, color: UI_EXTRA.muted }}>
                      {cur.id} · {priorityLabel(cur.priority)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="ph-btn" style={button('ok', true)} onClick={() => run('complete', { worker: w.id })}>
                    ✓ Завершить
                  </button>
                  <button type="button" className="ph-btn" style={button('paper', true)} onClick={() => run('block', { worker: w.id })}>
                    {w.status === 'blocked' ? 'Снять блок' : '⛔ Блок'}
                  </button>
                  <button type="button" className="ph-btn" style={button('paper', true)} onClick={() => run('unassign', { task: cur.id })}>
                    ↩ В лоток
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: 8, fontSize: 12, color: UI_EXTRA.muted, border: `2px dashed ${UI_EXTRA.dashed}`, borderRadius: 4 }}>
                Свободен — перетащите сюда конверт
              </div>
            )}
          </div>

          {queue.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={sectionLabel}>Очередь модели</div>
              <ul aria-label="Очередь модели" data-drop={w.id} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {queue.map((t) => {
                  const up = bumpPriority(t.priority, 1)
                  const down = bumpPriority(t.priority, -1)
                  return (
                    <li
                      key={t.id}
                      data-queue-task={t.id}
                      data-drop={w.id}
                      data-task-slot={t.id}
                      onPointerDown={(e) => onStartDrag(e, t.id)}
                      style={{ ...taskRow, padding: '6px 8px', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
                    >
                      <div style={flag(t.priority, 20)} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700 }}>{t.title}</div>
                      <button type="button" style={{ ...miniButton, height: 20 }} title="Повысить приоритет" disabled={!up} onPointerDown={stop} onClick={() => up && run('setPriority', { task: t.id, priority: up })}>
                        ▲
                      </button>
                      <button type="button" style={{ ...miniButton, height: 20 }} title="Понизить приоритет" disabled={!down} onPointerDown={stop} onClick={() => down && run('setPriority', { task: t.id, priority: down })}>
                        ▼
                      </button>
                      <button type="button" style={{ ...miniButton, height: 20, fontSize: 10 }} title="Вернуть в лоток" onPointerDown={stop} onClick={() => run('unassign', { task: t.id })}>
                        ↩
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={sectionLabel}>Выполнено: {w.doneCount}</div>
            {w.history.slice(0, 5).map((h, i) => (
              <div key={i} style={{ fontSize: 11, color: UI_EXTRA.history }}>
                ✓ {h}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10, borderTop: `2px dashed ${UI_EXTRA.dashed}` }}>
            <button type="button" className="ph-btn" style={button('primary', true)} onClick={() => onClone(w.model, otherRole(w.role))}>
              ＋ Экземпляр с другой ролью
            </button>
            <button type="button" className="ph-btn" style={button('danger', true)} onClick={() => run('removeWorker', { worker: w.id })}>
              Убрать из офиса
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
