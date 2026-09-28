import { useEffect, useRef, useState } from 'react'
import { Character, WorkerSign } from '../characters'
import { COORDINATOR_ID, PRIORITY_LABEL, findCatalogEntry } from '../journal/catalog'
import { currentTask, trayTasks, workerQueue } from '../journal/selectors'
import type { Journal, Task, Worker } from '../journal/types'
import {
  BOSS_ROOM,
  DEFAULT_COLS,
  H,
  OfficeScene,
  P,
  WORKER_ROOM,
  counterScale,
  displayStatus,
  fitScale,
  layoutOffice,
  pts,
  rect,
  sceneBounds,
  type Cell,
} from '../scene'
import { OUTLINE, UI } from '../theme/colors'
import { UI_EXTRA, priorityColor } from './styles'
import { TRAY_DROP, type StartDrag } from './types'

/** Смещение стопки конвертов от кресла (как в прототипе), по типу комнаты. */
const STACK = { boss: [52, 42], room: [17, 42] } as const
const STACK_CAP = { boss: 6, room: 4 } as const
const SIGN_W = { boss: 220, room: 180 } as const
const SIGN_H = 66

interface EnvelopeProps {
  task: Task
  x: number
  y: number
  scale: number
  drop: string
  current: boolean
  onPointerDown: StartDrag
  onClick?: () => void
}

function Envelope({ task, x, y, scale, drop, current, onPointerDown, onClick }: EnvelopeProps) {
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale})`}
      data-drop={drop}
      data-envelope={task.id}
      onPointerDown={(e) => onPointerDown(e, task.id, onClick)}
      style={{ cursor: 'grab', pointerEvents: 'visiblePainted', touchAction: 'none' }}
      stroke={OUTLINE}
      strokeWidth={2}
      strokeLinejoin="round"
    >
      <title>{`${task.id} · ${task.title} · ${PRIORITY_LABEL[task.priority]}${task.kind ? ` · только ${task.kind}` : ''}`}</title>
      <rect x={-15} y={-20} width={34} height={23} rx={3} fill="rgba(36,26,12,.45)" stroke="none" />
      <rect x={-17} y={-23} width={34} height={23} rx={3} fill={current ? UI_EXTRA.envelopeCurrent : UI_EXTRA.envelope} />
      <path d="M-16 -22 L0 -12 L16 -22" fill="none" strokeWidth={1.8} />
      <rect x={12} y={-34} width={9} height={12} fill={priorityColor(task.priority)} />
    </g>
  )
}

interface RoomOverlayProps {
  journal: Journal
  cell: Exclude<Cell, { kind: 'lounge' }>
  worker: Worker
  over: boolean
  selected: boolean
  signScale: number
  onSelect: (id: string) => void
  onStartDrag: StartDrag
}

/** Что сцена этапа 2 не рисует: персонаж, пол-мишень для drop, вывеска, конверты на столе. */
function roomLayers({ journal, cell, worker: w, over, selected, signScale, onSelect, onStartDrag }: RoomOverlayProps) {
  const boss = cell.kind === 'boss'
  const cfg = boss ? BOSS_ROOM : WORKER_ROOM
  const drop = boss ? TRAY_DROP : w.id
  const status = displayStatus(journal, w)
  const entry = findCatalogEntry(w.model)
  const select = () => onSelect(w.id)
  const S = cell.size

  const tray = trayTasks(journal)
  const cur = currentTask(journal, w.id)
  const stack = boss ? tray.slice(0, STACK_CAP.boss).reverse() : [...(cur ? [cur] : []), ...workerQueue(journal, w.id)]
  const total = boss ? tray.length : stack.length
  const shown = boss ? stack : stack.slice(0, STACK_CAP.room)
  const extra = total - STACK_CAP[cell.kind]
  const [dx, dy] = STACK[cell.kind]
  const [ax, ay] = P(cell.ox + cfg.cx + dx, cell.oy + cfg.cy + dy, cfg.dh)
  const [seatX, seatY] = P(cell.ox + cfg.cx, cell.oy + cfg.cy, 17)
  const [sx, sy] = P(cell.ox + S / 2, cell.oy, H + 4)
  const sw = SIGN_W[cell.kind]

  const floor = (
    <polygon
      key={`floor-${w.id}`}
      points={pts(rect(cell.ox, cell.oy, cell.ox + S, cell.oy + S))}
      data-drop={drop}
      data-room={w.id}
      fill={over ? UI.button : 'transparent'}
      fillOpacity={over ? 0.45 : 1}
      onClick={select}
      style={{ cursor: 'pointer', pointerEvents: 'all' }}
    />
  )
  const body = entry && (
    <g key={`char-${w.id}`} data-drop={drop} onClick={select} style={{ cursor: 'pointer', pointerEvents: 'visiblePainted' }}>
      <Character worker={{ ...w, status }} catalogEntry={entry} furniture={false} x={seatX} y={seatY} />
    </g>
  )
  const envelopes = (
    <g key={`env-${w.id}`}>
      {shown.map((t, i) => (
        <Envelope
          key={t.id}
          task={t}
          x={ax + i * 2}
          y={ay - i * 7 * signScale}
          scale={signScale}
          drop={drop}
          current={t.id === cur?.id}
          onPointerDown={onStartDrag}
          onClick={boss ? undefined : select}
        />
      ))}
      {extra > 0 && (
        <g transform={`translate(${ax + 20} ${ay - STACK_CAP[cell.kind] * 7 * signScale}) scale(${signScale})`}>
          <rect x={0} y={-14} width={30} height={16} rx={8} fill={OUTLINE} />
          <text x={15} y={-2} textAnchor="middle" fontSize={11} fontWeight={800} fill={UI.button} fontFamily="Verdana, Tahoma, sans-serif">
            +{extra}
          </text>
        </g>
      )}
    </g>
  )
  const sign = (
    <g
      key={`sign-${w.id}`}
      transform={`translate(${sx} ${sy}) scale(${signScale}) translate(${-sw / 2} ${-SIGN_H - 6})`}
      data-drop={drop}
      data-sign={w.id}
      onClick={select}
      style={{ cursor: 'pointer', pointerEvents: 'visiblePainted' }}
    >
      {(over || selected) && (
        <rect
          x={-5}
          y={-5}
          width={sw + 10}
          height={SIGN_H + 10}
          rx={6}
          fill={selected ? UI_EXTRA.selected : 'none'}
          stroke={over ? UI_EXTRA.highlight : OUTLINE}
          strokeWidth={3}
        />
      )}
      <WorkerSign
        worker={{ ...w, status }}
        taskTitle={boss ? `в лотке: ${tray.length}` : cur?.title}
        width={sw}
      />
    </g>
  )
  return { floor, body, envelopes, sign }
}

interface SceneViewProps {
  journal: Journal
  selectedId: string | null
  /** data-drop цели под курсором при перетаскивании. */
  overDrop: string | null
  cols?: number
  onSelect: (id: string) => void
  onStartDrag: StartDrag
  onAddRoom: () => void
}

/**
 * Сцена этапа 2 + интерактивный слой поверх неё (SVG с тем же viewBox):
 * персонажи, мишени для drop, вывески, конверты.
 */
export function SceneView({ journal, selectedId, overDrop, cols = DEFAULT_COLS, onSelect, onStartDrag, onAddRoom }: SceneViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 900, height: 600 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = layoutOffice(journal.workers, cols)
  const b = sceneBounds(layout)
  // Зум — этап 7; пока только «вписать».
  const k = fitScale(box, b)
  const cs = counterScale(k)
  const width = Math.ceil(b.width * k)
  const height = Math.ceil(b.height * k)

  const layers = layout.cells.flatMap((cell) => {
    if (cell.kind === 'lounge' || !cell.worker) return []
    const w = cell.worker
    const drop = w.id === COORDINATOR_ID ? TRAY_DROP : w.id
    return [roomLayers({ journal, cell, worker: w, over: overDrop === drop, selected: selectedId === w.id, signScale: cs, onSelect, onStartDrag })]
  })

  return (
    <div
      ref={wrapRef}
      style={{
        flex: '1 1 480px',
        minWidth: 300,
        minHeight: 380,
        overflow: 'auto',
        background: UI_EXTRA.lawn,
        border: `3px solid ${UI.console}`,
        borderRadius: 6,
        position: 'relative',
      }}
    >
      <div style={{ width, height, position: 'relative', margin: '0 auto' }}>
        <OfficeScene journal={journal} cols={cols} scale={k} onAddRoom={onAddRoom} />
        <svg
          viewBox={`${b.minX} ${b.minY} ${b.width} ${b.height}`}
          width={width}
          height={height}
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          data-layer="interactive"
        >
          {layers.map((l) => l.floor)}
          {layers.map((l) => l.body)}
          {layers.map((l) => l.envelopes)}
          {layers.map((l) => l.sign)}
        </svg>
      </div>
    </div>
  )
}
