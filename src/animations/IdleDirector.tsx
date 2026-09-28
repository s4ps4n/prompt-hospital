import { useEffect, useState, type SVGProps } from 'react'
import { Character, SLEEP_HEAD, type CharacterProps } from '../characters/Character'
import { Workstation } from '../characters/Workstation'
import { FURNITURE, OUTLINE } from '../theme/colors'
import { canIdle, idlePose, nextIdleDelay } from './schedule'
import '../theme/animations.css'

import { laneStyle, type IdleLane, type IdlePoint } from './geometry'

type Interaction = Pick<SVGProps<SVGGElement>, 'onClick' | 'onPointerDown' | 'onPointerUp' | 'onDragOver' | 'onDrop' | 'onKeyDown'>
export interface IdleDirectorProps extends Omit<CharacterProps, 'layer'>, Interaction {
  /** Coordinates relative to the seat (x, y), in SVG scene units. */
  lane: IdleLane
  door: IdlePoint
  /** Supply a shared clock for deterministic rendering; otherwise uses wall time. */
  timeMs?: number
}

/** Replace the seated Character with this SVG group; the host owns journal actions. */
export function IdleDirector({ worker, catalogEntry, lane, door, timeMs, motion = true,
  furniture = true, x = 0, y = 0, ...events }: IdleDirectorProps) {
  const [clock, setClock] = useState(() => Date.now())
  const enabled = canIdle(worker, motion)
  useEffect(() => {
    if (!enabled || timeMs !== undefined) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const now = Date.now()
      setClock(now)
      timer = setTimeout(tick, nextIdleDelay(worker.id, now))
    }
    tick()
    return () => clearTimeout(timer)
  }, [enabled, worker.id, timeMs])
  const pose = idlePose(worker, timeMs ?? clock, motion)
  const sprite = <Character worker={worker} catalogEntry={catalogEntry} furniture={false} motion={false} sleep={pose === 'sleep'} />
  return <g transform={`translate(${x} ${y})`} className={motion ? 'ph-idle ph-motion' : 'ph-idle ph-still'}
    data-idle-pose={pose ?? 'seated'} data-worker-id={worker.id}>
    {!pose ? <Character worker={worker} catalogEntry={catalogEntry} motion={motion} furniture={furniture} /> : <>
      {furniture && <g data-idle-chair={pose === 'sleep' ? 'occupied' : 'empty'}>
        <rect x={-18} y={-26} width={36} height={38} rx={6} fill={FURNITURE.chair} stroke={OUTLINE} strokeWidth={2} />
        <Workstation status={worker.status} motion={motion} />
      </g>}
    </>}
    <g key={pose ?? 'seated'} className={pose ? 'ph-idle-enter' : undefined}>
      <g className={pose === 'walk' ? 'ph-idle-lane' : undefined} style={pose === 'walk' ? laneStyle(lane) : undefined}
        transform={pose === 'coffee' ? `translate(${door.x} ${door.y})` : undefined}>
        <g data-drop={worker.id} data-worker={worker.id} {...events}
          role={events.onClick ? 'button' : undefined} tabIndex={events.onClick ? 0 : undefined}
          aria-label={worker.name} onKeyDown={event => {
            events.onKeyDown?.(event)
            if (!event.defaultPrevented && events.onClick && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            }
          }} style={{ cursor: events.onClick ? 'pointer' : undefined }}>
          <rect x={-38} y={-78} width={76} height={100} fill="transparent" pointerEvents="all" />
          {pose && <g className={`ph-idle-${pose}`}>
            {pose === 'walk' && <g stroke={OUTLINE} strokeWidth={7} strokeLinecap="round">
              <path className="ph-idle-step-a" d="M-7,0 L-9,15" /><path className="ph-idle-step-b" d="M7,0 L9,15" />
            </g>}
            {sprite}
            {pose === 'coffee' && <g className="ph-idle-cup" stroke={OUTLINE} strokeWidth={2}>
              <path d="M-16,-7 C-4,-10 -4,3 -16,1" fill="none" />
              <rect x={-30} y={-12} width={15} height={17} rx={3} fill={FURNITURE.cup} />
              <path className="ph-idle-steam" d="M-25,-16 Q-31,-21 -25,-26 M-19,-16 Q-25,-21 -19,-26" fill="none" stroke={FURNITURE.cup} />
            </g>}
            {pose === 'sleep' && <g fill={OUTLINE}>
              {[0, 1, 2].map(i => <text key={i} className="ph-idle-z" x={2 + i * 8} y={-23 - i * 8} style={{ animationDelay: `${i * .6}s` }} fontSize={12}>z</text>)}
              {/* Слюна — из уголка рта, в системе координат лежащей головы (как в character() дизайнера). */}
              <g transform={SLEEP_HEAD}>
                <path className="ph-idle-drool" d="M-3,-31 Q-4,-25 -2,-22 Q0,-25 -1,-31 Z" fill={FURNITURE.water} stroke={OUTLINE} strokeWidth={1} />
              </g>
            </g>}
          </g>}
        </g>
      </g>
    </g>
  </g>
}
