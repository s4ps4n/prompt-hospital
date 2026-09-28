import type { WorkerStatus } from '../journal/types'
import { FURNITURE, PANEL_SHADE, SCREEN, WALL, shade } from '../theme/colors'
import { H, T, quadX, quadY, rect } from './iso'
import { Box, Plant, Poly } from './primitives'
import { doorSpan, type RoomConfig } from './rooms'

function Workstation({ cfg, status }: { cfg: RoomConfig; status: WorkerStatus }) {
  const x0 = cfg.cx + cfg.deskX
  const y0 = cfg.cy + 16
  const dh = cfg.dh
  const wood = FURNITURE.desk
  return (
    <g>
      <Box x={cfg.cx - 11} y={cfg.cy - 12} w={22} d={22} h={17} color={FURNITURE.chair} />
      <Box x={cfg.cx - 11} y={cfg.cy - 17} z={17} w={22} d={5} h={26} color={FURNITURE.chair} />
      <Box x={x0} y={y0} w={cfg.dw} d={cfg.dd} h={dh} color={wood} />
      <Poly points={quadY(y0 + cfg.dd, x0 + cfg.dw - 28, x0 + cfg.dw - 6, 5, dh - 6)} fill={shade(wood, 0.7)} strokeWidth={1.5} />
      <Box x={x0 + 10} y={y0 + 6} z={dh} w={16} d={16} h={3} color={FURNITURE.mousepad} />
      <Box x={x0 + 6} y={y0 + 2} z={dh + 3} w={26} d={26} h={22} color={FURNITURE.crt} />
      <g data-screen={status}>
        <Poly points={quadX(x0 + 32, y0 + 5, y0 + 23, dh + 7, dh + 21)} fill={SCREEN[status]} />
      </g>
      <Box x={cfg.cx - 15} y={cfg.cy + 20} z={dh} w={30} d={12} h={3} color={FURNITURE.keyboard} />
    </g>
  )
}

function BossExtras() {
  const books: { y: number; z0: number; z1: number; fill: string }[] = []
  let n = 0
  for (const [z0, z1] of [
    [8, 24],
    [32, 50],
  ]) {
    for (let y = 44; y < 108; y += 9) {
      n++
      books.push({ y, z0, z1, fill: FURNITURE.books[n % FURNITURE.books.length] })
    }
  }
  return (
    <g>
      <Box x={T} y={40} w={20} d={74} h={58} color={FURNITURE.bookshelf} />
      {books.map((b, k) => (
        <Poly key={k} points={quadX(T + 20, b.y, b.y + 7, b.z0, b.z1)} fill={b.fill} strokeWidth={1.2} />
      ))}
      <Box x={250} y={T} w={64} d={24} h={26} color={FURNITURE.desk} />
      <Box x={260} y={T + 3} z={26} w={22} d={18} h={28} color={FURNITURE.coffeeMachine} />
      <Poly points={quadY(T + 21, 264, 278, 36, 48)} fill={FURNITURE.coffeeButton} strokeWidth={1.5} />
      <Box x={290} y={T + 8} z={26} w={7} d={7} h={8} color={FURNITURE.cup} />
    </g>
  )
}

interface RoomProps {
  cfg: RoomConfig
  /** Цвет ковра по роли. */
  color: string
  /** Статус для экрана ЭЛТ. */
  status: WorkerStatus
}

/** Комната в локальных координатах (угол в 0,0). Персонажей нет — это этап 3. */
export function Room({ cfg, color, status }: RoomProps) {
  const S = cfg.size
  const [dA, dB] = doorSpan(S)
  return (
    <g>
      <Poly points={rect(0, 0, S, S)} fill={color} />
      <Poly points={rect(S * 0.18, S * 0.66, S * 0.8, S * 0.92)} fill={shade(color, 1.1)} strokeWidth={1.5} />

      <Box x={0} y={0} w={T} d={S} h={H} color={WALL.face} right={shade(WALL.face, 0.92)} left={shade(WALL.face, 0.78)} top={WALL.top} />
      <Box x={T} y={0} w={S - T} d={T} h={H} color={WALL.face} left={WALL.face} right={shade(WALL.face, 0.78)} top={WALL.top} />
      <Poly points={quadX(T, T, S, 0, 18)} fill={shade(color, PANEL_SHADE.alongY)} />
      <Poly points={quadY(T, T, S, 0, 18)} fill={shade(color, PANEL_SHADE.alongX)} />

      {cfg.posters.map((b) => (
        <g key={`po${b}`}>
          <Poly points={quadX(T, b, b + 28, 26, 52)} fill={FURNITURE.frame} />
          <Poly points={quadX(T, b + 4, b + 24, 30, 48)} fill={shade(color, 0.7)} strokeWidth={1.2} />
        </g>
      ))}
      {cfg.windows.map((a) => (
        <g key={`wi${a}`}>
          <Poly points={quadY(T, a, a + 38, 24, 52)} fill={FURNITURE.frame} />
          <Poly points={quadY(T, a + 4, a + 34, 28, 48)} fill={FURNITURE.window} strokeWidth={1.2} />
          <Poly points={quadY(T, a + 18, a + 20, 28, 48)} fill={FURNITURE.frame} strokeWidth={0} />
        </g>
      ))}
      {cfg.radiators.map((a) => (
        <Box key={`rd${a}`} x={a} y={T} w={30} d={5} h={15} color={FURNITURE.radiator} />
      ))}
      {cfg.boss && <BossExtras />}
      {cfg.plants.map(([x, y]) => (
        <Plant key={`pl${x}_${y}`} x={x} y={y} />
      ))}

      <Workstation cfg={cfg} status={status} />
      {cfg.boss && <Box x={248} y={164} z={28} w={22} d={16} h={6} color={FURNITURE.paper} />}
      {cfg.frontPlants.map(([x, y]) => (
        <Plant key={`pf${x}_${y}`} x={x} y={y} />
      ))}

      <Box x={T} y={S - T} w={dA - T} d={T} h={12} color={WALL.face} top={WALL.top} />
      <Box x={dB} y={S - T} w={S - T - dB} d={T} h={12} color={WALL.face} top={WALL.top} />
      <Box x={S - T} y={T} w={T} d={S - T} h={12} color={WALL.face} top={WALL.top} />
    </g>
  )
}

/** Зона отдыха в пустой ячейке: скамья, кулер, два растения. */
export function Lounge() {
  return (
    <g>
      <Box x={30} y={64} z={8} w={70} d={4} h={14} color={FURNITURE.bench} />
      <Box x={30} y={68} w={70} d={18} h={8} color={FURNITURE.bench} />
      <Box x={118} y={20} w={18} d={18} h={34} color={FURNITURE.cooler} />
      <Box x={121} y={23} z={34} w={12} d={12} h={14} color={FURNITURE.water} />
      <Plant x={20} y={20} />
      <Plant x={124} y={124} />
    </g>
  )
}
