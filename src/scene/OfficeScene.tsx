import type { Journal } from '../journal/types'
import { CORRIDOR_TILES, FURNITURE, GRASS, HEDGE, OUTER_WALL, OUTLINE, UI, roleColor } from '../theme/colors'
import { H, P, quadX, quadY, rect } from './iso'
import { DEFAULT_COLS, counterScale, displayStatus, layoutOffice, sceneBounds, type Cell } from './layout'
import { Box, Poly } from './primitives'
import { Lounge, Room } from './Room'
import { BOSS_ROOM, WORKER_ROOM } from './rooms'

const PAT = {
  grass: 'ph-grass',
  tiles: 'ph-tiles',
  brickX: 'ph-brick-x',
  brickY: 'ph-brick-y',
} as const
const url = (id: string) => `url(#${id})`

function Patterns() {
  const iso = 'matrix(1,0.5,-1,0.5,0,0)'
  const seams = 'M0 0.5 H20 M0 5.5 H20 M5 0 V5 M15 5 V10'
  return (
    <defs>
      <pattern id={PAT.grass} width={60} height={60} patternUnits="userSpaceOnUse" patternTransform={iso}>
        <rect width={60} height={60} fill={GRASS.light} />
        <rect width={30} height={60} fill={GRASS.dark} />
      </pattern>
      <pattern id={PAT.tiles} width={40} height={40} patternUnits="userSpaceOnUse" patternTransform={iso}>
        <rect width={40} height={40} fill={CORRIDOR_TILES.light} />
        <rect width={20} height={20} fill={CORRIDOR_TILES.dark} />
        <rect x={20} y={20} width={20} height={20} fill={CORRIDOR_TILES.dark} />
      </pattern>
      <pattern id={PAT.brickX} width={20} height={10} patternUnits="userSpaceOnUse" patternTransform="skewY(26.565)">
        <rect width={20} height={10} fill={OUTER_WALL.brickX.brick} />
        <path d={seams} stroke={OUTER_WALL.brickX.seam} strokeWidth={1} />
      </pattern>
      <pattern id={PAT.brickY} width={20} height={10} patternUnits="userSpaceOnUse" patternTransform="skewY(-26.565)">
        <rect width={20} height={10} fill={OUTER_WALL.brickY.brick} />
        <path d={seams} stroke={OUTER_WALL.brickY.seam} strokeWidth={1} />
      </pattern>
    </defs>
  )
}

interface FreeRoomButtonProps {
  cell: Cell
  labelScale: number
  onClick?: () => void
}

/** Кнопка «＋ свободная комната» над зоной отдыха; контр-масштабируется как вывески. */
function FreeRoomButton({ cell, labelScale, onClick }: FreeRoomButtonProps) {
  const [x, y] = P(cell.ox + 80, cell.oy + 80, 40)
  const w = 150
  const h = 26
  return (
    <g
      data-free-room={`${cell.i},${cell.j}`}
      transform={`translate(${x},${y}) scale(${labelScale})`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill={UI.paperLight} stroke={OUTLINE} strokeWidth={2} strokeDasharray="5 3" />
      <text
        y={4}
        textAnchor="middle"
        fontFamily="Verdana, Tahoma, sans-serif"
        fontSize={12}
        fontWeight={800}
        fill={OUTLINE}
      >
        ＋ свободная комната
      </text>
    </g>
  )
}

export interface OfficeSceneProps {
  journal: Journal
  /** Колонок в сетке (3..6), по умолчанию 4. */
  cols?: number
  /** Итоговый масштаб сцены (например, из fitScale); влияет на размер SVG и контр-масштаб подписей. */
  scale?: number
  onAddRoom?: () => void
}

/** Изометрическая сцена офиса — чистая функция от журнала. */
export function OfficeScene({ journal, cols = DEFAULT_COLS, scale = 1, onAddRoom }: OfficeSceneProps) {
  const layout = layoutOffice(journal.workers, cols)
  const b = sceneBounds(layout)
  const Wb = layout.width
  const Hb = layout.height
  const labelScale = counterScale(scale)
  const lounges = layout.cells.filter((c) => c.kind === 'lounge')

  const backWindowsX: number[] = []
  for (let x = 60; x < Wb - 40; x += 120) backWindowsX.push(x)
  const backWindowsY: number[] = []
  for (let y = 80; y < Hb - 40; y += 120) backWindowsY.push(y)

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${b.minX} ${b.minY} ${b.width} ${b.height}`}
      width={Math.ceil(b.width * scale)}
      height={Math.ceil(b.height * scale)}
      style={{ display: 'block' }}
      data-cols={layout.cols}
      data-rows={layout.rows}
    >
      <Patterns />
      <rect x={b.minX} y={b.minY} width={b.width} height={b.height} fill={url(PAT.grass)} />
      <Poly points={rect(0, 0, Wb, Hb)} fill={url(PAT.tiles)} />

      <Box x={-10} y={-10} w={10} d={Hb + 10} h={H + 10} color={OUTER_WALL.cap} right={OUTER_WALL.inner} left={url(PAT.brickY)} />
      <Box x={0} y={-10} w={Wb} d={10} h={H + 10} color={OUTER_WALL.cap} left={OUTER_WALL.inner} right={url(PAT.brickY)} />
      {backWindowsX.map((x) => (
        <Poly key={`ew${x}`} points={quadY(0, x, x + 44, 44, 68)} fill={FURNITURE.window} />
      ))}
      {backWindowsY.map((y) => (
        <Poly key={`ev${y}`} points={quadX(0, y, y + 44, 44, 68)} fill={FURNITURE.window} />
      ))}

      {layout.cells.map((cell) => {
        const [tx, ty] = P(cell.ox, cell.oy)
        const transform = `translate(${tx},${ty})`
        if (cell.kind === 'lounge') {
          return (
            <g key={`lounge-${cell.i}-${cell.j}`} transform={transform} data-cell="lounge" data-depth={cell.depth}>
              <Lounge />
            </g>
          )
        }
        const w = cell.worker
        const cfg = cell.kind === 'boss' ? BOSS_ROOM : WORKER_ROOM
        return (
          <g
            key={`room-${w?.id ?? 'boss'}`}
            transform={transform}
            data-cell={cell.kind}
            data-worker={w?.id}
            data-depth={cell.depth}
          >
            <Room cfg={cfg} color={roleColor(w?.role ?? 'координатор')} status={displayStatus(journal, w)} />
          </g>
        )
      })}

      <Box x={0} y={Hb} w={Wb} d={10} h={20} color={OUTER_WALL.cap} left={url(PAT.brickX)} right={url(PAT.brickY)} />
      <Box x={Wb} y={-10} w={10} d={Hb + 20} h={20} color={OUTER_WALL.cap} left={url(PAT.brickX)} right={url(PAT.brickY)} />
      <Box x={-10} y={Hb + 24} w={Wb + 24} d={14} h={16} color={HEDGE} />
      <Box x={Wb + 24} y={-10} w={14} d={Hb + 48} h={16} color={HEDGE} />

      {lounges.map((cell) => (
        <FreeRoomButton key={`free-${cell.i}-${cell.j}`} cell={cell} labelScale={labelScale} onClick={onAddRoom} />
      ))}
    </svg>
  )
}
