import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IdleDirector, idlePose, useIdleClock } from '../animations'
import { Character, WorkerSign } from '../characters'
import { COORDINATOR_ID, PRIORITY_LABEL, findCatalogEntry } from '../journal/catalog'
import { currentTask, trayTasks, workerQueue } from '../journal/selectors'
import type { Journal, Task, Worker } from '../journal/types'
import {
  DEFAULT_COLS,
  OfficeScene,
  P,
  counterScale,
  displayStatus,
  fitScale,
  idleRoute,
  layoutOffice,
  pts,
  rect,
  roomConfig,
  sceneBounds,
  seatPoint,
  signAnchor,
  type RoomCell,
  type SceneItem,
} from '../scene'
import { OUTLINE, UI, UI_EXTRA } from '../theme/colors'
import { priorityColor } from './styles'
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
      <rect x={12} y={-34} width={9} height={12} fill={priorityColor(task.priority)} data-priority={task.priority} />
    </g>
  )
}

interface RoomPartsProps {
  journal: Journal
  cell: RoomCell
  worker: Worker
  over: boolean
  selected: boolean
  signScale: number
  motion: boolean
  now: number
  onSelect: (id: string) => void
  onStartDrag: StartDrag
}

interface RoomParts {
  drop: string
  select: () => void
  /** Подсветка пола при наведении конверта. */
  floor: ReactNode
  /** Содержимое комнаты в её painter-порядке: персонаж, конверты, вывеска. */
  content: ReactNode
  /** Гуляющий по коридору — отдельный объект сцены со своей глубиной. */
  walker: SceneItem | null
}

/** Всё, что сцена рисует от журнала внутри комнаты модели; координаты — локальные (угол комнаты 0,0). */
function roomParts({ journal, cell, worker: w, over, selected, signScale, motion, now, onSelect, onStartDrag }: RoomPartsProps): RoomParts {
  const boss = cell.kind === 'boss'
  const cfg = roomConfig(cell)
  const drop = boss ? TRAY_DROP : w.id
  const shown = { ...w, status: displayStatus(journal, w) }
  const entry = findCatalogEntry(w.model)
  const select = () => onSelect(w.id)
  const S = cell.size

  const tray = trayTasks(journal)
  const cur = currentTask(journal, w.id)
  const stack = boss ? tray.slice(0, STACK_CAP.boss).reverse() : [...(cur ? [cur] : []), ...workerQueue(journal, w.id)]
  const total = boss ? tray.length : stack.length
  const pile = boss ? stack : stack.slice(0, STACK_CAP.room)
  const extra = total - STACK_CAP[cell.kind]
  const [dx, dy] = STACK[cell.kind]
  const [ax, ay] = P(cfg.cx + dx, cfg.cy + dy, cfg.dh)
  const [seatX, seatY] = seatPoint(cfg)
  const [sx, sy] = signAnchor(cfg)
  const sw = SIGN_W[cell.kind]

  // Гермес не бездельничает (canIdle), а его drop-цель — лоток, поэтому он сидит как обычный Character.
  const route = idleRoute(cell)
  const pose = boss ? null : idlePose(shown, now, motion)
  const character =
    entry &&
    (boss ? (
      <g data-drop={drop}>
        <Character worker={shown} catalogEntry={entry} furniture={false} motion={motion} x={seatX} y={seatY} />
      </g>
    ) : (
      <IdleDirector
        worker={shown}
        catalogEntry={entry}
        furniture={false}
        motion={motion}
        timeMs={now}
        lane={route.lane}
        door={route.door}
        x={seatX}
        y={seatY}
        onClick={select}
      />
    ))

  const floor = (
    <polygon
      points={pts(rect(0, 0, S, S))}
      data-room={w.id}
      fill={over ? UI.button : 'transparent'}
      fillOpacity={over ? 0.45 : 1}
      stroke="none"
    />
  )
  const envelopes = (
    <g>
      {pile.map((t, i) => (
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
      transform={`translate(${sx} ${sy}) scale(${signScale}) translate(${-sw / 2} ${-SIGN_H - 6})`}
      data-drop={drop}
      data-sign={w.id}
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
      <WorkerSign worker={shown} taskTitle={boss ? `в лотке: ${tray.length}` : cur?.title} width={sw} motion={motion} />
    </g>
  )

  const [tx, ty] = P(cell.ox, cell.oy)
  const walker: SceneItem | null =
    pose === 'walk'
      ? { key: `walk-${w.id}`, depth: route.depth, node: <g transform={`translate(${tx},${ty})`}>{character}</g> }
      : null
  return {
    drop,
    select,
    floor,
    content: (
      <>
        {!walker && character}
        {envelopes}
        {sign}
      </>
    ),
    walker,
  }
}

interface SceneViewProps {
  journal: Journal
  selectedId: string | null
  /** data-drop цели под курсором при перетаскивании. */
  overDrop: string | null
  cols?: number
  /** false — анимации сцены и idle-график отключены. */
  motion?: boolean
  /** Фиксированное время idle-графика (мс); по умолчанию — настенные часы. */
  timeMs?: number
  onSelect: (id: string) => void
  onStartDrag: StartDrag
  onAddRoom: () => void
}

/**
 * Сцена офиса целиком: персонажи, вывески и конверты — внутри комнат в painter-порядке,
 * гуляющие бездельники — объектами коридора. Всё — функция от журнала и idle-часов.
 */
export function SceneView({
  journal,
  selectedId,
  overDrop,
  cols = DEFAULT_COLS,
  motion = true,
  timeMs,
  onSelect,
  onStartDrag,
  onAddRoom,
}: SceneViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 900, height: 600 })
  const now = useIdleClock(journal.workers, motion, timeMs)

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

  const parts = new Map<string, RoomParts>()
  for (const cell of layout.cells) {
    if (cell.kind === 'lounge' || !cell.worker) continue
    const w = cell.worker
    const drop = w.id === COORDINATOR_ID ? TRAY_DROP : w.id
    parts.set(
      w.id,
      roomParts({ journal, cell, worker: w, over: overDrop === drop, selected: selectedId === w.id, signScale: cs, motion, now, onSelect, onStartDrag }),
    )
  }
  const partsOf = (cell: RoomCell) => (cell.worker ? parts.get(cell.worker.id) : undefined)
  const walkers = [...parts.values()].flatMap((p) => (p.walker ? [p.walker] : []))

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
      <div style={{ width: Math.ceil(b.width * k), margin: '0 auto' }}>
        <OfficeScene
          journal={journal}
          cols={cols}
          scale={k}
          motion={motion}
          onAddRoom={onAddRoom}
          renderFloor={(cell) => partsOf(cell)?.floor}
          renderRoom={(cell) => partsOf(cell)?.content}
          roomTarget={(cell) => {
            const p = partsOf(cell)
            return p && { drop: p.drop, onClick: p.select }
          }}
          extras={walkers}
        />
      </div>
    </div>
  )
}
