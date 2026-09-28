import { COORDINATOR_ID } from '../journal/catalog'
import { trayTasks } from '../journal/selectors'
import type { Journal, Worker, WorkerStatus } from '../journal/types'
import { BOSS_SIZE, E, G, L, M, PITCH } from './iso'

export const DEFAULT_COLS = 4
export const MIN_COLS = 3
export const MAX_COLS = 6
/** Нижняя граница масштаба «вписать»; меньше — скролл. */
export const MIN_SCALE = 0.55
/** Верхняя граница масштаба (и «вписать», и ручного зума). */
export const MAX_SCALE = 2
/** Множитель одного нажатия −/＋. */
export const ZOOM_STEP = 1.25
/** Предел контр-масштаба вывесок и конвертов. */
export const MAX_COUNTER_SCALE = 1.5

interface CellBase {
  /** Колонка и ряд сетки. */
  i: number
  j: number
  /** Угол ячейки в координатах сцены. */
  ox: number
  oy: number
  /** Сторона ячейки (L или BOSS_SIZE). */
  size: number
  /** Ключ painter's algorithm: ox + oy + size. */
  depth: number
}

export type Cell =
  | (CellBase & { kind: 'boss'; worker: Worker | null })
  | (CellBase & { kind: 'room'; worker: Worker })
  | (CellBase & { kind: 'lounge' })

export interface OfficeLayout {
  cols: number
  rows: number
  /** Ячейки в порядке отрисовки (задние раньше передних). */
  cells: Cell[]
  /** Размер пола здания в координатах сцены. */
  width: number
  height: number
}

export function clampCols(cols: number): number {
  if (!Number.isFinite(cols)) return DEFAULT_COLS
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.trunc(cols)))
}

function cellAt(i: number, j: number, size: number): CellBase {
  const ox = M + i * PITCH
  const oy = M + j * PITCH
  return { i, j, ox, oy, size, depth: ox + oy + size }
}

/** Порядок painter's algorithm: по глубине, при равенстве — по ряду, затем по колонке. */
export function comparePaint(a: CellBase, b: CellBase): number {
  return a.depth - b.depth || a.j - b.j || a.i - b.i
}

/**
 * Раскладка офиса: Гермес в ячейках (0..1, 0..1), остальные модели — построчно
 * в свободные ячейки, при переполнении — новый ряд. Пустые ячейки — зона отдыха.
 */
export function layoutOffice(workers: readonly Worker[], cols: number = DEFAULT_COLS): OfficeLayout {
  const C = clampCols(cols)
  const boss = workers.find((w) => w.id === COORDINATOR_ID) ?? null
  const others = workers.filter((w) => w.id !== COORDINATOR_ID)
  const cells: Cell[] = [{ ...cellAt(0, 0, BOSS_SIZE), kind: 'boss', worker: boss }]

  let n = 0
  let row = 0
  while (row < 2 || n < others.length) {
    for (let i = 0; i < C; i++) {
      if (i < 2 && row < 2) continue
      if (n < others.length) cells.push({ ...cellAt(i, row, L), kind: 'room', worker: others[n++] })
      else cells.push({ ...cellAt(i, row, L), kind: 'lounge' })
    }
    row++
  }

  cells.sort(comparePaint)
  return {
    cols: C,
    rows: row,
    cells,
    width: 2 * M + C * PITCH - G,
    height: 2 * M + row * PITCH - G,
  }
}

/** Статус для отображения: Гермес «в работе», пока в лотке есть задачи, иначе ждёт. */
export function displayStatus(j: Journal, w: Worker | null): WorkerStatus {
  if (!w) return 'wait'
  if (w.id === COORDINATOR_ID) return trayTasks(j).length > 0 ? 'run' : 'wait'
  return w.status
}

export interface SceneBounds {
  minX: number
  minY: number
  width: number
  height: number
}

/** Экранные границы сцены с учётом изгороди, травы и запаса сверху под вывески. */
export function sceneBounds(layout: Pick<OfficeLayout, 'width' | 'height'>): SceneBounds {
  const { width: Wb, height: Hb } = layout
  const minX = -Hb - 2 * E
  const maxX = Wb + 2 * E
  const minY = -92
  const maxY = (Wb + Hb + 2 * E) / 2 + 10
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

/** Масштаб сцены всегда в [MIN_SCALE, MAX_SCALE]. */
export function clampScale(k: number): number {
  if (!Number.isFinite(k)) return 1
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, k))
}

/** Масштаб «вписать в контейнер», но не меньше MIN_SCALE (дальше — скролл контейнера). */
export function fitScale(container: { width: number; height: number }, bounds: Pick<SceneBounds, 'width' | 'height'>): number {
  return clampScale(Math.min((container.width - 8) / bounds.width, (container.height - 8) / bounds.height))
}

/** Зум — состояние интерфейса (не журнала): «вписать» или ручной масштаб. */
export type Zoom = 'fit' | number

/** Итоговый масштаб сцены при зуме `zoom` и вписанном масштабе `fit`. */
export function sceneScale(zoom: Zoom, fit: number): number {
  return zoom === 'fit' ? fit : clampScale(zoom)
}

/** Шаг кнопок −/＋ от текущего масштаба `k`; не выходит за [MIN_SCALE, MAX_SCALE]. */
export function zoomBy(k: number, dir: 1 | -1): number {
  return clampScale(k * ZOOM_STEP ** dir)
}

/** Контр-масштаб вывесок/конвертов при общем масштабе `k`: 1/k, от 1 до MAX_COUNTER_SCALE. */
export function counterScale(k: number): number {
  return Math.min(MAX_COUNTER_SCALE, Math.max(1, 1 / k))
}
