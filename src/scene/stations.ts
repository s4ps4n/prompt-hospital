import type { IdleLane, IdlePoint } from '../animations/geometry'
import { H, P, type Pt } from './iso'
import type { Cell } from './layout'
import { BOSS_ROOM, WORKER_ROOM, doorSpan, type RoomConfig } from './rooms'

/** Ячейка с комнатой (кабинет Гермеса или комната модели). */
export type RoomCell = Exclude<Cell, { kind: 'lounge' }>

/** Высота сиденья: локальный ноль спрайта Character. */
export const SEAT_Z = 17
/** Высота «пояса» идущего персонажа: ноги спрайта заканчиваются на 15 ниже нуля. */
const WALK_Z = 15
/** Дорожка прогулки: в коридоре перед комнатой, в пределах поля M у нижнего ряда. */
const LANE_Y = 30
const LANE_X: readonly [number, number] = [20, 140]
/** Кофе — у двери, внутри комнаты, перед передней стенкой. */
const DOOR_Y = 132

export function roomConfig(cell: RoomCell): RoomConfig {
  return cell.kind === 'boss' ? BOSS_ROOM : WORKER_ROOM
}

/** Кресло в локальных экранных координатах комнаты (угол комнаты — 0,0). */
export function seatPoint(cfg: RoomConfig): Pt {
  return P(cfg.cx, cfg.cy, SEAT_Z)
}

/** Середина верхней кромки задней стены — точка крепления вывески. */
export function signAnchor(cfg: RoomConfig): Pt {
  return P(cfg.size / 2, 0, H + 4)
}

export interface IdleRoute {
  /** Маршрут прогулки относительно кресла (для IdleDirector). */
  lane: IdleLane
  /** Место с кофе относительно кресла. */
  door: IdlePoint
  /**
   * Ключ painter's algorithm для гуляющего: он в коридоре, поэтому рисуется
   * после своей комнаты (включая переднюю стенку) и до следующего ряда.
   */
  depth: number
}

function rel(from: Pt, x: number, y: number, z: number): IdlePoint {
  const [px, py] = P(x, y, z)
  return { x: px - from[0], y: py - from[1] }
}

/** Где бездельник гуляет и пьёт кофе — в координатах сцены, заданных раскладкой. */
export function idleRoute(cell: RoomCell): IdleRoute {
  const cfg = roomConfig(cell)
  const seat = seatPoint(cfg)
  const S = cfg.size
  const [dA, dB] = doorSpan(S)
  return {
    lane: { from: rel(seat, LANE_X[0], S + LANE_Y, WALK_Z), to: rel(seat, LANE_X[1], S + LANE_Y, WALK_Z) },
    door: rel(seat, (dA + dB) / 2, DOOR_Y, WALK_Z),
    depth: cell.depth + LANE_Y,
  }
}
