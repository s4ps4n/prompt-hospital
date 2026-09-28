import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IDLE_SLOT_MS, IdleDirector, canIdle, idlePose, nextIdleDelay, useIdleClock } from '../animations'
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
  sceneScale,
  seatPoint,
  signAnchor,
  type RoomCell,
  type SceneItem,
  type Zoom,
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

/** Гуляет ли модель по коридору (тогда её персонаж — отдельный объект сцены). */
function walking(w: Worker, now: number, motion: boolean): boolean {
  return w.id !== COORDINATOR_ID && idlePose(w, now, motion) === 'walk'
}

/** Начало текущего idle-слота модели: поза внутри слота не меняется, мемо комнаты не сбивается. 0 — не бездельничает. */
function idleSlotTime(w: Worker, now: number, motion: boolean): number {
  if (w.id === COORDINATOR_ID || !canIdle(w, motion)) return 0
  return now + nextIdleDelay(w.id, now) - IDLE_SLOT_MS
}

interface RoomContentProps {
  journal: Journal
  cell: RoomCell
  worker: Worker
  /** 'room' — персонаж (если не гуляет), конверты и вывеска; 'walker' — только гуляющий персонаж. */
  part: 'room' | 'walker'
  over: boolean
  selected: boolean
  signScale: number
  motion: boolean
  /** Время idle-графика, квантованное до начала слота (0 — модель не бездельничает). */
  now: number
  onSelect: (id: string) => void
  onStartDrag: StartDrag
}

/**
 * Всё, что сцена рисует от журнала внутри комнаты модели; координаты — локальные (угол комнаты 0,0).
 * Мемоизировано: комната пересобирается, только когда меняются журнал, масштаб, подсветка или её idle-поза.
 */
const RoomContent = memo(function RoomContent({ journal, cell, worker: w, part, over, selected, signScale, motion, now, onSelect, onStartDrag }: RoomContentProps) {
  const boss = cell.kind === 'boss'
  const cfg = roomConfig(cell)
  const drop = boss ? TRAY_DROP : w.id
  const shown = { ...w, status: displayStatus(journal, w) }
  const entry = findCatalogEntry(w.model)
  const select = () => onSelect(w.id)

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

  if (part === 'walker') return character
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

  return (
    <>
      {!walking(w, now, motion) && character}
      {envelopes}
      {sign}
    </>
  )
})

/** Подсветка пола при наведении конверта. */
function RoomFloor({ id, size, over }: { id: string; size: number; over: boolean }) {
  return (
    <polygon
      points={pts(rect(0, 0, size, size))}
      data-room={id}
      fill={over ? UI.button : 'transparent'}
      fillOpacity={over ? 0.45 : 1}
      stroke="none"
    />
  )
}

interface SceneViewProps {
  journal: Journal
  selectedId: string | null
  /** data-drop цели под курсором при перетаскивании. */
  overDrop: string | null
  cols?: number
  /** Зум (состояние интерфейса): «вписать» или ручной масштаб; всегда не меньше MIN_SCALE. */
  zoom?: Zoom
  /** Итоговый масштаб сцены — сообщается при каждом изменении (для шага −/＋ и индикатора). */
  onScale?: (k: number) => void
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
 * гуляющие бездельники — объектами коридора. Всё — функция от журнала, зума и idle-часов.
 * Мемоизирована: перетаскивание, сообщения и модалки в App сцену не пересобирают.
 */
export const SceneView = memo(function SceneView({
  journal,
  selectedId,
  overDrop,
  cols = DEFAULT_COLS,
  zoom = 'fit',
  onScale,
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

  const layout = useMemo(() => layoutOffice(journal.workers, cols), [journal.workers, cols])
  const b = sceneBounds(layout)
  const k = sceneScale(zoom, fitScale(box, b))
  const cs = counterScale(k)

  useEffect(() => onScale?.(k), [k, onScale])

  // При смене масштаба держим на месте центр видимой области.
  const prevK = useRef(k)
  useLayoutEffect(() => {
    const el = wrapRef.current
    const r = k / prevK.current
    prevK.current = k
    if (!el || r === 1) return
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * r - el.clientWidth / 2
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * r - el.clientHeight / 2
  }, [k])

  const rooms = new Map<string, { cell: RoomCell; worker: Worker; drop: string; now: number }>()
  for (const cell of layout.cells) {
    if (cell.kind === 'lounge' || !cell.worker) continue
    const w = cell.worker
    rooms.set(w.id, { cell, worker: w, drop: w.id === COORDINATOR_ID ? TRAY_DROP : w.id, now: idleSlotTime(w, now, motion) })
  }
  const roomOf = (cell: RoomCell) => (cell.worker ? rooms.get(cell.worker.id) : undefined)
  const content = (r: { cell: RoomCell; worker: Worker; drop: string; now: number }, part: 'room' | 'walker') => (
    <RoomContent
      journal={journal}
      cell={r.cell}
      worker={r.worker}
      part={part}
      over={overDrop === r.drop}
      selected={selectedId === r.worker.id}
      signScale={cs}
      motion={motion}
      now={r.now}
      onSelect={onSelect}
      onStartDrag={onStartDrag}
    />
  )
  const walkers: SceneItem[] = []
  for (const r of rooms.values()) {
    if (!walking(r.worker, r.now, motion)) continue
    const [tx, ty] = P(r.cell.ox, r.cell.oy)
    walkers.push({ key: `walk-${r.worker.id}`, depth: idleRoute(r.cell).depth, node: <g transform={`translate(${tx},${ty})`}>{content(r, 'walker')}</g> })
  }

  return (
    <div
      ref={wrapRef}
      data-scene-scale={k}
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
          renderFloor={(cell) => {
            const r = roomOf(cell)
            return r && <RoomFloor id={r.worker.id} size={cell.size} over={overDrop === r.drop} />
          }}
          renderRoom={(cell) => {
            const r = roomOf(cell)
            return r && content(r, 'room')
          }}
          roomTarget={(cell) => {
            const r = roomOf(cell)
            return r && { drop: r.drop, onClick: () => onSelect(r.worker.id) }
          }}
          extras={walkers}
        />
      </div>
    </div>
  )
})
