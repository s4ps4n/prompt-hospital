import type { CSSProperties } from 'react'
import { FLIGHT_EASE, FLIGHT_MS, type ScreenPoint } from '../animations/flight'
import type { Task } from '../journal/types'
import { OUTLINE, UI, UI_EXTRA } from '../theme/colors'
import { priorityColor } from './styles'

interface DragGhostProps {
  task: Task
  x: number
  y: number
  /** Если задано — конверт летит из (x, y) в `to` (FLIGHT_MS, дуга) и не является призраком. */
  to?: ScreenPoint
}

/** Полёт: left и top анимируются отдельно, с разными кривыми — получается дуга. */
function flightStyle(from: ScreenPoint, to: ScreenPoint): CSSProperties {
  return {
    '--fx0': `${from.x}px`,
    '--fy0': `${from.y}px`,
    '--fx1': `${to.x}px`,
    '--fy1': `${to.y}px`,
    left: to.x,
    top: to.y,
    animation: `ph-fly-x ${FLIGHT_MS}ms ${FLIGHT_EASE.left} both, ph-fly-y ${FLIGHT_MS}ms ${FLIGHT_EASE.top} both`,
  } as CSSProperties
}

/** Призрак конверта под курсором во время перетаскивания; он же летит в цель после drop. */
export function DragGhost({ task, x, y, to }: DragGhostProps) {
  return (
    <div
      data-ghost={to ? undefined : task.id}
      data-flight={to ? task.id : undefined}
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
        ...(to && flightStyle({ x, y }, to)),
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
      {!to && (
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
      )}
    </div>
  )
}
