/** Изометрия 2:1 и размеры сцены — по docs/handoff/README.md, «Раскладка сцены». */

/** Сторона комнаты. */
export const L = 160
/** Ширина коридора. */
export const G = 110
/** Шаг сетки комнат. */
export const PITCH = L + G
/** Поле между наружной стеной и комнатами. */
export const M = 55
/** Высота стен комнаты. */
export const H = 64
/** Толщина стен комнаты. */
export const T = 6
/** Запас вокруг здания (изгородь, трава). */
export const E = 22
/** Сторона кабинета Гермеса: две комнаты и коридор между ними. */
export const BOSS_SIZE = 2 * L + G

export type Pt = readonly [number, number]

/** Проекция точки сцены на экран: P(x,y,z) = [x − y, (x + y)/2 − z]. */
export function P(x: number, y: number, z = 0): Pt {
  return [x - y, (x + y) / 2 - z]
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** Строка для `points` у SVG-полигона, с округлением до 0.1. */
export function pts(a: readonly Pt[]): string {
  return a.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ')
}

/** Вертикальный четырёхугольник в плоскости x = const. */
export function quadX(x: number, y0: number, y1: number, z0: number, z1: number): Pt[] {
  return [P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)]
}

/** Вертикальный четырёхугольник в плоскости y = const. */
export function quadY(y: number, x0: number, x1: number, z0: number, z1: number): Pt[] {
  return [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)]
}

/** Горизонтальный прямоугольник на высоте z. */
export function rect(x0: number, y0: number, x1: number, y1: number, z = 0): Pt[] {
  return [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)]
}

export interface BoxFaces {
  top: Pt[]
  /** Грань, обращённая к +y (левая на экране). */
  left: Pt[]
  /** Грань, обращённая к +x (правая на экране). */
  right: Pt[]
}

/** Видимые грани коробки с углом (x,y,z) и размерами w×d×h. */
export function boxFaces(x: number, y: number, z: number, w: number, d: number, h: number): BoxFaces {
  return {
    top: rect(x, y, x + w, y + d, z + h),
    left: quadY(y + d, x, x + w, z, z + h),
    right: quadX(x + w, y, y + d, z, z + h),
  }
}
