import type { CatalogEntry, Worker } from '../journal/types'
import { FURNITURE, OUTLINE } from '../theme/colors'
import { Character } from './Character'

/** Стоящая поза idle — перенос standing() из docs/handoff/Office Orchestrator.dc.html.
 *  Начало координат — ступни (тень), тело и руки подняты на translate(0,-15). */
export type StandMode = 'walk' | 'coffee'

const LEG = '#3a3550'
const CUP_STRIPE = '#e0402e'
const SHADOW = 'rgba(36,26,12,.3)'
const ARM_L = 'M-13,-18 Q-18,-8 -16,1'
const ARM_R = 'M12,-18 Q17,-8 15,1'
const CUP_ARM = 'M12,-18 Q11,-5 -1,-8'

function Arm({ d, hx, hy, color, skin, className }: { d: string, hx: number, hy: number, color: string, skin: string, className?: string }) {
  return <g className={className} data-arm>
    <path d={d} fill="none" strokeWidth={10} />
    <path d={d} fill="none" stroke={color} strokeWidth={6} />
    <circle cx={hx} cy={hy} r={4.4} fill={skin} strokeWidth={1.8} />
  </g>
}

function Leg({ x, className }: { x: number, className?: string }) {
  return <g className={className} data-leg>
    <rect x={x} y={-17} width={7} height={15} fill={LEG} />
    <ellipse cx={x + 3.5} cy={-2} rx={5} ry={3} fill={OUTLINE} stroke="none" />
  </g>
}

export interface StandingProps {
  worker: Worker
  catalogEntry: CatalogEntry
  mode: StandMode
}

export function Standing({ worker, catalogEntry: entry, mode }: StandingProps) {
  const walk = mode === 'walk'
  const seed = Array.from(worker.id).reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 4000, 0) / 1000
  return <g data-stand={mode} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
    <ellipse cx={0} cy={0} rx={13} ry={4.5} fill={SHADOW} stroke="none" />
    <Leg x={-8} className={walk ? 'ph-idle-step-a' : undefined} />
    <Leg x={1} className={walk ? 'ph-idle-step-b' : undefined} />
    <g transform="translate(0 -15)">
      <g className={walk ? 'ph-idle-bob' : undefined}>
        {/* Туловище и голова без анимации головы (в референсе pose 'stand' — headStyle undefined). */}
        <Character worker={worker} catalogEntry={entry} furniture={false} motion={false} layer="body" />
        <Arm d={ARM_L} hx={-16} hy={1} color={entry.color} skin={entry.skin} className={walk ? 'ph-idle-step-a' : undefined} />
        {walk
          ? <Arm d={ARM_R} hx={15} hy={1} color={entry.color} skin={entry.skin} className="ph-idle-step-b" />
          : <g className="ph-idle-cup" data-cup-arm style={{ animationDelay: `-${seed.toFixed(2)}s` }}>
            <path d={CUP_ARM} fill="none" strokeWidth={10} />
            <path d={CUP_ARM} fill="none" stroke={entry.color} strokeWidth={6} />
            <rect x={-9} y={-17} width={10} height={11} rx={1.5} fill={FURNITURE.cup} strokeWidth={1.8} />
            <rect x={-9} y={-14} width={10} height={3} fill={CUP_STRIPE} stroke="none" />
            <circle cx={-1} cy={-8} r={4.2} fill={entry.skin} strokeWidth={1.8} />
            <path className="ph-idle-steam" d="M-6,-20 q-2,-3 0,-6 q2,-3 0,-6" fill="none" stroke={FURNITURE.cup} strokeWidth={1.8} />
          </g>}
      </g>
    </g>
  </g>
}
