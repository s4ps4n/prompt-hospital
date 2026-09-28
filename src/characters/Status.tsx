import type { WorkerStatus } from '../journal/types'
import { CHARACTER, LAMP, OUTLINE, OUTLINE_WIDTH, SCREEN } from '../theme/colors'
import '../theme/animations.css'

export interface StatusProps {
  status: WorkerStatus
  motion?: boolean
  x?: number
  y?: number
}

export function StatusLamp({ status, motion = true, x = 0, y = 0 }: StatusProps) {
  return <g transform={`translate(${x} ${y})`} data-status={status} className={motion ? 'ph-motion' : 'ph-still'}>
    <g className="ph-lamp">
      <circle r={6.5} fill={LAMP[status]} stroke={OUTLINE} strokeWidth={OUTLINE_WIDTH} />
      <circle cx={-2} cy={-2} r={1.5} fill={CHARACTER.white} stroke="none" />
    </g>
  </g>
}

/** Screen is a separate group so it can be placed on an existing CRT. */
export function StatusScreen({ status, motion = true, x = 0, y = 0 }: StatusProps) {
  return <g transform={`translate(${x} ${y})`} data-status={status} className={motion ? 'ph-motion' : 'ph-still'}>
    <path className="ph-screen" d="M0,0 L22,5 L22,24 L0,19 Z" fill={SCREEN[status]} stroke={OUTLINE} strokeWidth={OUTLINE_WIDTH} />
  </g>
}
