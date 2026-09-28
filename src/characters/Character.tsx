import type { CatalogEntry, HairStyle, Worker, WorkerStatus } from '../journal/types'
import { CHARACTER, FURNITURE, OUTLINE, OUTLINE_WIDTH } from '../theme/colors'
import { StatusLamp } from './Status'
import { Workstation } from './Workstation'
import '../theme/animations.css'

const CAP = 'M-18,-42 C-19,-58 -8,-63 0,-63 C8,-63 19,-58 18,-42 C12,-50 4,-52 0,-51 C-6,-52 -13,-50 -18,-42 Z'
const HAIR: Record<HairStyle, string> = {
  cap: CAP, bun: CAP, quiff: CAP,
  bob: 'M-20,-27 C-23,-50 -14,-65 0,-65 C14,-65 23,-50 20,-27 L13,-27 C15,-37 14,-45 11,-50 C3,-47 -8,-48 -13,-45 C-15,-39 -15,-33 -13,-27 Z',
  spiky: 'M-18,-42 L-21,-56 L-12,-55 L-11,-67 L-3,-59 L2,-70 L6,-59 L15,-65 L13,-54 L21,-55 L18,-42 C12,-50 4,-52 0,-51 C-6,-52 -13,-50 -18,-42 Z',
}
const MOUTH: Record<WorkerStatus, string> = {
  run: 'M-6,-33 Q-2,-30 2,-33', wait: 'M-6,-33 Q-2,-31 2,-33',
  blocked: 'M-6,-31 Q-2,-35 2,-31', done: 'M-7,-34 Q-2,-24 3,-34 Z',
}

function Hair({ entry }: { entry: CatalogEntry }) {
  return <g fill={entry.hair} data-hair={entry.style}>
    {entry.style === 'bun' && <circle cx={1} cy={-64} r={7} />}
    <path d={HAIR[entry.style]} />
    {entry.style === 'quiff' && <path d="M-6,-60 C-4,-73 10,-74 15,-64 C9,-67 3,-64 -6,-60 Z" />}
  </g>
}
function Accessory({ entry }: { entry: CatalogEntry }) {
  switch (entry.acc) {
    case 'glasses': return <g data-accessory="glasses" fill={CHARACTER.lenses}>
      <circle cx={-7} cy={-43} r={6} /><circle cx={6} cy={-43} r={6} />
      <path d="M-1,-43 H0 M12,-43 L16,-45" fill="none" />
    </g>
    case 'wings': return <g data-accessory="wings" fill={CHARACTER.white}>
      <path d="M-15,-56 C-27,-64 -31,-54 -24,-50 C-29,-47 -24,-43 -16,-48 Z" />
      <path d="M13,-56 C25,-64 29,-54 22,-50 C27,-47 22,-43 14,-48 Z" />
    </g>
    case 'headset': return <g data-accessory="headset">
      <path d="M-19,-46 C-23,-76 23,-76 19,-46" fill="none" stroke={CHARACTER.headset} strokeWidth={3.2} />
      <rect x={14} y={-51} width={7} height={11} rx={2} fill={CHARACTER.headset} />
      <path d="M17,-40 Q12,-31 2,-31" fill="none" stroke={CHARACTER.headset} />
    </g>
    default: return null
  }
}

export interface CharacterProps {
  worker: Worker
  catalogEntry: CatalogEntry
  motion?: boolean
  /** Local origin is the seat; sprite bounds with furniture: (-64,-96)..(35,39). */
  x?: number
  y?: number
  /** Disable when the host scene supplies its own furniture. */
  furniture?: boolean
  /** Allows the host to interleave the body, desk and hands in painter order. */
  layer?: 'all' | 'body' | 'arms'
}

/** Pure SVG group. Appearance comes from the catalogue, expression from the journal. */
export function Character({ worker, catalogEntry: entry, motion = true, x = 0, y = 0, furniture = true, layer = 'all' }: CharacterProps) {
  const phase = Array.from(worker.id).reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 5000, 0) / 1000
  return <g transform={`translate(${x} ${y})`} className={motion ? 'ph-motion' : 'ph-still'} data-status={worker.status}
    data-worker-id={worker.id} stroke={OUTLINE} strokeWidth={OUTLINE_WIDTH} strokeLinejoin="round" strokeLinecap="round">
    <title>{worker.name} — {worker.role}</title>
    {layer !== 'arms' && <>
      {furniture && <rect x={-18} y={-26} width={36} height={38} rx={6} fill={FURNITURE.chair} />}
      <path d="M-16,3 C-17,-10 -14,-21 -8,-25 L8,-25 C14,-21 17,-10 16,3 Z" fill={entry.color} />
      <path d="M-6,-25 L0,-17 L6,-25 Z" fill={CHARACTER.white} />
      <g className="ph-head">
        <circle cx={15} cy={-42} r={4.5} fill={entry.skin} />
        <circle cx={0} cy={-44} r={17} fill={entry.skin} />
        <g fill={CHARACTER.blush} stroke="none" opacity={.75}>
          <ellipse cx={-12} cy={-35.5} rx={3.6} ry={2.2} /><ellipse cx={9} cy={-35.5} rx={3.6} ry={2.2} />
        </g>
        <Hair entry={entry} />
        <g className="ph-eyes" style={{ animationDelay: `-${phase}s` }}>
          {[-7, 5].map(cx => <g key={cx}>
            <ellipse cx={cx} cy={-43} rx={4.3} ry={5.3} fill={CHARACTER.white} strokeWidth={1.6} />
            <circle cx={cx - 1.2} cy={-41.8} r={2.2} fill={OUTLINE} stroke="none" />
          </g>)}
        </g>
        <path d={worker.status === 'blocked' ? 'M-11,-49 L-3,-52 M1,-52 L9,-49' : 'M-11,-50 Q-7,-52.5 -3,-50 M1,-50 Q5,-52.5 9,-50'} fill="none" />
        <path d={MOUTH[worker.status]} fill={worker.status === 'done' ? CHARACTER.mouth : 'none'} />
        <Accessory entry={entry} />
      </g>
      {worker.status === 'blocked' && <StatusLamp status={worker.status} y={-86} motion={motion} />}
    </>}
    {furniture && layer === 'all' && <Workstation status={worker.status} motion={motion} />}
    {layer !== 'body' && <>
      {(['a', 'b'] as const).map((arm, i) => <g key={arm} className={`ph-arm-${arm}`}>
        <path d={i === 0 ? 'M-12,-17 Q-22,-8 -29,3' : 'M11,-17 Q5,-2 -17,7'} fill="none" strokeWidth={10} />
        <path d={i === 0 ? 'M-12,-17 Q-22,-8 -29,3' : 'M11,-17 Q5,-2 -17,7'} fill="none" stroke={entry.color} strokeWidth={6} />
        <circle cx={i === 0 ? -29 : -17} cy={i === 0 ? 3 : 7} r={4.4} fill={entry.skin} />
      </g>)}
    </>}
  </g>
}
