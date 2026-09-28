import type { Task } from '../journal/types'
import { OUTLINE, UI } from '../theme/colors'
import { UI_EXTRA, priorityColor } from './styles'

/** Призрак конверта под курсором во время перетаскивания. */
export function DragGhost({ task, x, y }: { task: Task; x: number; y: number }) {
  return (
    <div
      data-ghost={task.id}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 100,
        pointerEvents: 'none',
        transform: 'translate(-50%,-70%) rotate(-8deg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 44,
          height: 30,
          background: UI_EXTRA.ghost,
          border: `2px solid ${OUTLINE}`,
          borderRadius: 3,
          boxShadow: '4px 4px 0 rgba(36,26,12,.4)',
        }}
      >
        <svg viewBox="0 0 40 26" width={40} height={26} style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d="M1 1 L20 14 L39 1" fill="none" stroke={OUTLINE} strokeWidth={2} />
        </svg>
        <div
          style={{
            position: 'absolute',
            right: -7,
            top: -13,
            width: 11,
            height: 14,
            background: priorityColor(task.priority),
            border: `2px solid ${OUTLINE}`,
          }}
        />
      </div>
      <div
        style={{
          padding: '2px 7px',
          background: OUTLINE,
          color: UI.button,
          fontSize: 11,
          fontWeight: 800,
          borderRadius: 3,
          whiteSpace: 'nowrap',
        }}
      >
        {task.id} · {task.title}
      </div>
    </div>
  )
}
