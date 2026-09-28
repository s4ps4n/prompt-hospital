import { BOSS_SIZE, L, T } from './iso'

/** Расстановка мебели внутри комнаты (координаты относительно угла комнаты). */
export interface RoomConfig {
  size: number
  /** Центр кресла. */
  cx: number
  cy: number
  /** Стол: ширина, глубина, высота, сдвиг по x от кресла. */
  dw: number
  dd: number
  dh: number
  deskX: number
  windows: readonly number[]
  posters: readonly number[]
  radiators: readonly number[]
  plants: readonly (readonly [number, number])[]
  frontPlants: readonly (readonly [number, number])[]
  boss: boolean
}

export const WORKER_ROOM: RoomConfig = {
  size: L,
  cx: 95,
  cy: 44,
  dw: 80,
  dd: 34,
  dh: 26,
  deskX: -55,
  windows: [98],
  posters: [20],
  radiators: [100],
  plants: [[134, T + 4]],
  frontPlants: [],
  boss: false,
}

export const BOSS_ROOM: RoomConfig = {
  size: BOSS_SIZE,
  cx: 206,
  cy: 132,
  dw: 150,
  dd: 46,
  dh: 28,
  deskX: -76,
  windows: [70, 210],
  posters: [196],
  radiators: [72, 212],
  plants: [[BOSS_SIZE - 26, T + 4]],
  frontPlants: [[T + 10, BOSS_SIZE - 38]],
  boss: true,
}

/** Проём двери в передней стене (вдоль x): [начало, конец]. */
export function doorSpan(size: number): [number, number] {
  const a = Math.round(size * 0.3)
  return [a, a + 44]
}
