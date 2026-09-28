import { describe, expect, it } from 'vitest'
import { COORDINATOR_ID } from '../journal/catalog'
import { initialJournal } from '../journal/initial'
import type { Journal, Worker } from '../journal/types'
import { BOSS_SIZE, G, L, M, PITCH } from './iso'
import {
  MAX_COLS,
  MAX_COUNTER_SCALE,
  MAX_SCALE,
  MIN_COLS,
  MIN_SCALE,
  ZOOM_STEP,
  clampCols,
  clampScale,
  comparePaint,
  counterScale,
  displayStatus,
  fitScale,
  layoutOffice,
  sceneBounds,
  sceneScale,
  zoomBy,
  type Cell,
} from './layout'

function workersN(n: number): Worker[] {
  const base = initialJournal().workers
  const boss = base[0]
  const out: Worker[] = [boss]
  for (let k = 1; k <= n; k++) out.push({ ...base[1 + ((k - 1) % 7)], id: `w${k}` })
  return out
}

const at = (cells: Cell[], i: number, j: number) => cells.find((c) => c.i === i && c.j === j)

describe('сетка', () => {
  it('cols ограничен 3..6, мусор → 4', () => {
    expect(clampCols(1)).toBe(MIN_COLS)
    expect(clampCols(99)).toBe(MAX_COLS)
    expect(clampCols(5.7)).toBe(5)
    expect(clampCols(Number.NaN)).toBe(4)
  })

  it('Гермес занимает ячейки 0..1 × 0..1 и кабинет 2L+G', () => {
    const lay = layoutOffice(initialJournal().workers, 4)
    const boss = lay.cells.find((c) => c.kind === 'boss')
    expect(boss).toMatchObject({ i: 0, j: 0, ox: M, oy: M, size: BOSS_SIZE })
    expect(boss?.kind === 'boss' && boss.worker?.id).toBe(COORDINATOR_ID)
    // ни одна другая ячейка не попадает в квадрат Гермеса
    for (const c of lay.cells) if (c.kind !== 'boss') expect(c.i >= 2 || c.j >= 2).toBe(true)
  })

  it('кабинет Гермеса ровно накрывает 2×2 комнаты с коридором между ними', () => {
    expect(M + BOSS_SIZE).toBe(M + PITCH + L)
  })

  it('стартовый журнал при C=4: заполнение построчно, остаток — зона отдыха', () => {
    const lay = layoutOffice(initialJournal().workers, 4)
    expect(lay.rows).toBe(3)
    const ids = (i: number, j: number) => {
      const c = at(lay.cells, i, j)
      return c?.kind === 'room' ? c.worker.id : c?.kind
    }
    expect([ids(2, 0), ids(3, 0)]).toEqual(['w1', 'w2'])
    expect([ids(2, 1), ids(3, 1)]).toEqual(['w3', 'w4'])
    expect([ids(0, 2), ids(1, 2), ids(2, 2), ids(3, 2)]).toEqual(['w5', 'w6', 'w7', 'lounge'])
  })

  it('координаты ячеек: угол = M + индекс × шаг', () => {
    const lay = layoutOffice(initialJournal().workers, 4)
    for (const c of lay.cells) {
      expect(c.ox).toBe(M + c.i * PITCH)
      expect(c.oy).toBe(M + c.j * PITCH)
      expect(c.depth).toBe(c.ox + c.oy + c.size)
    }
  })

  it('без моделей — два ряда, все свободные ячейки справа от Гермеса — зона отдыха', () => {
    const lay = layoutOffice(workersN(0), 4)
    expect(lay.rows).toBe(2)
    expect(lay.cells.filter((c) => c.kind === 'lounge').map((c) => [c.i, c.j])).toEqual(
      expect.arrayContaining([
        [2, 0],
        [3, 0],
        [2, 1],
        [3, 1],
      ]),
    )
    expect(lay.cells).toHaveLength(5)
  })

  it('каждая модель получает ровно одну комнату, ячейки не повторяются', () => {
    for (let cols = MIN_COLS; cols <= MAX_COLS; cols++) {
      for (let n = 0; n <= 20; n++) {
        const lay = layoutOffice(workersN(n), cols)
        const rooms = lay.cells.filter((c) => c.kind === 'room')
        expect(rooms).toHaveLength(n)
        const keys = lay.cells.map((c) => `${c.i},${c.j}`)
        expect(new Set(keys).size).toBe(keys.length)
        // сетка заполнена целиком: C×rows минус 3 ячейки, занятые кабинетом сверх одной
        expect(lay.cells).toHaveLength(cols * lay.rows - 3)
        // зона отдыха есть только в последнем ряду (если моделей больше, чем влезает в первые два)
        const lastRoomRow = Math.max(1, ...rooms.map((c) => c.j))
        expect(lay.rows).toBe(lastRoomRow + 1)
      }
    }
  })

  it('добавление модели растягивает офис новым рядом при переполнении', () => {
    // C=4: первые два ряда вмещают 4 модели, каждый следующий — ещё 4
    expect(layoutOffice(workersN(4), 4).rows).toBe(2)
    expect(layoutOffice(workersN(5), 4).rows).toBe(3)
    expect(layoutOffice(workersN(8), 4).rows).toBe(3)
    expect(layoutOffice(workersN(9), 4).rows).toBe(4)
    const a = layoutOffice(workersN(8), 4)
    const b = layoutOffice(workersN(9), 4)
    expect(b.height - a.height).toBe(PITCH)
    expect(b.width).toBe(a.width)
  })

  it('размер здания: 2M + C·шаг − G', () => {
    const lay = layoutOffice(initialJournal().workers, 4)
    expect(lay.width).toBe(2 * M + 4 * PITCH - G)
    expect(lay.height).toBe(2 * M + 3 * PITCH - G)
    // последняя комната упирается в поле M у дальней стены
    const last = at(lay.cells, 3, 2)
    expect(last && last.ox + last.size + M).toBe(lay.width)
    expect(last && last.oy + last.size + M).toBe(lay.height)
  })
})

describe("painter's algorithm", () => {
  /** A полностью «за» B, если лежит целиком по меньшим x (или y) и пересекается по другой оси. */
  function isBehind(a: Cell, b: Cell): boolean {
    const behindX = a.ox + a.size <= b.ox && a.oy < b.oy + b.size && b.oy < a.oy + a.size + G
    const behindY = a.oy + a.size <= b.oy && a.ox < b.ox + b.size && b.ox < a.ox + a.size + G
    return behindX || behindY
  }

  it('порядок отрисовки отсортирован по ox + oy + S', () => {
    const lay = layoutOffice(workersN(13), 5)
    const depths = lay.cells.map((c) => c.depth)
    expect(depths).toEqual([...depths].sort((x, y) => x - y))
  })

  it('задние комнаты рисуются раньше передних (все пары, C=3..6, до 20 моделей)', () => {
    for (let cols = MIN_COLS; cols <= MAX_COLS; cols++) {
      for (let n = 0; n <= 20; n++) {
        const cells = layoutOffice(workersN(n), cols).cells
        cells.forEach((a, ia) =>
          cells.forEach((b, ib) => {
            if (isBehind(a, b)) expect(ia, `${a.i},${a.j} до ${b.i},${b.j}`).toBeLessThan(ib)
          }),
        )
      }
    }
  })

  it('Гермес рисуется первым, соседи справа и снизу — после', () => {
    const cells = layoutOffice(initialJournal().workers, 4).cells
    expect(cells[0].kind).toBe('boss')
    const idx = (i: number, j: number) => cells.findIndex((c) => c.i === i && c.j === j)
    expect(idx(2, 0)).toBeGreaterThan(0)
    expect(idx(0, 2)).toBeGreaterThan(0)
    expect(idx(2, 1)).toBeGreaterThan(idx(2, 0))
    expect(idx(3, 2)).toBe(cells.length - 1)
  })

  it('равная глубина: детерминированно по ряду, затем по колонке', () => {
    const cells = layoutOffice(initialJournal().workers, 4).cells
    // (2,0) и (0,2) имеют одинаковую глубину
    const a = cells.findIndex((c) => c.i === 2 && c.j === 0)
    const b = cells.findIndex((c) => c.i === 0 && c.j === 2)
    expect(cells[a].depth).toBe(cells[b].depth)
    expect(a).toBeLessThan(b)
    expect(comparePaint(cells[a], cells[b])).toBeLessThan(0)
  })

  it('порядок не зависит от порядка массива workers, кроме назначения ячеек', () => {
    const w = initialJournal().workers
    const lay = layoutOffice([...w.slice(1), w[0]], 4)
    expect(lay.cells[0].kind).toBe('boss')
  })
})

describe('масштаб', () => {
  it('sceneBounds охватывает здание, изгородь и запас под вывески', () => {
    const lay = layoutOffice(initialJournal().workers, 4)
    const b = sceneBounds(lay)
    expect(b.minX).toBe(-lay.height - 44)
    expect(b.minY).toBe(-92)
    expect(b.width).toBe(lay.width + lay.height + 88)
    expect(b.height).toBe((lay.width + lay.height + 44) / 2 + 10 + 92)
  })

  it('вписывает в контейнер', () => {
    const b = { width: 1000, height: 500 }
    expect(fitScale({ width: 2008, height: 2008 }, b)).toBe(2)
    expect(fitScale({ width: 808, height: 408 }, b)).toBeCloseTo(0.8)
  })

  it('«Вписать» при разных контейнерах: по узкой стороне, в пределах [0.55, MAX_SCALE]', () => {
    const b = { width: 1000, height: 500 }
    // Узкий по ширине / по высоте — определяет меньшая сторона.
    expect(fitScale({ width: 708, height: 2000 }, b)).toBeCloseTo(0.7)
    expect(fitScale({ width: 2000, height: 358 }, b)).toBeCloseTo(0.7)
    // Маленький контейнер — не меньше 0.55, дальше скролл.
    expect(fitScale({ width: 300, height: 380 }, b)).toBe(MIN_SCALE)
    expect(fitScale({ width: 0, height: 0 }, b)).toBe(MIN_SCALE)
    // Огромный — не больше MAX_SCALE.
    expect(fitScale({ width: 10_000, height: 10_000 }, b)).toBe(MAX_SCALE)
    // Реальная сцена в окне 1280×720 и на телефоне.
    const real = sceneBounds(layoutOffice(initialJournal().workers))
    const desk = fitScale({ width: 1280, height: 720 }, real)
    expect(desk).toBeGreaterThanOrEqual(MIN_SCALE)
    expect(Math.ceil(real.width * desk) <= 1280 || desk === MIN_SCALE).toBe(true)
    expect(fitScale({ width: 360, height: 640 }, real)).toBe(MIN_SCALE)
  })

  it('не меньше 0.55', () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 5000, height: 5000 })).toBe(MIN_SCALE)
  })
})

describe('зум', () => {
  it('ручной зум не опускается ниже 0.55 и не поднимается выше MAX_SCALE', () => {
    let k = 1
    for (let n = 0; n < 20; n++) k = zoomBy(k, -1)
    expect(k).toBe(MIN_SCALE)
    expect(zoomBy(MIN_SCALE, -1)).toBe(MIN_SCALE)
    for (let n = 0; n < 20; n++) k = zoomBy(k, 1)
    expect(k).toBe(MAX_SCALE)
    expect(zoomBy(0.6, -1)).toBe(MIN_SCALE)
  })

  it('шаг −/＋ — множитель ZOOM_STEP', () => {
    expect(zoomBy(1, 1)).toBeCloseTo(ZOOM_STEP)
    expect(zoomBy(1, -1)).toBeCloseTo(1 / ZOOM_STEP)
  })

  it('масштаб сцены: «вписать» берёт fit, ручной — зажимается в [0.55, MAX_SCALE]', () => {
    expect(sceneScale('fit', 0.7)).toBe(0.7)
    expect(sceneScale(0.3, 0.7)).toBe(MIN_SCALE)
    expect(sceneScale(0, 0.7)).toBe(MIN_SCALE)
    expect(sceneScale(-1, 0.7)).toBe(MIN_SCALE)
    expect(sceneScale(9, 0.7)).toBe(MAX_SCALE)
    expect(sceneScale(1.3, 0.7)).toBe(1.3)
    expect(clampScale(Number.NaN)).toBe(1)
  })
})

describe('контр-масштаб вывесок/конвертов', () => {
  it('1/k при отдалении, ограничен сверху ×1.5', () => {
    expect(counterScale(1)).toBe(1)
    expect(counterScale(0.8)).toBeCloseTo(1.25)
    expect(counterScale(0.75)).toBeCloseTo(4 / 3)
    expect(counterScale(2 / 3)).toBeCloseTo(1.5)
    expect(counterScale(MIN_SCALE)).toBe(MAX_COUNTER_SCALE)
    expect(counterScale(0.1)).toBe(1.5)
  })

  it('при приближении не уменьшает (не меньше 1)', () => {
    expect(counterScale(1.5)).toBe(1)
    expect(counterScale(MAX_SCALE)).toBe(1)
  })

  it('на любом допустимом масштабе — в [1, 1.5]', () => {
    for (let k = MIN_SCALE; k <= MAX_SCALE; k += 0.05) {
      const c = counterScale(clampScale(k))
      expect(c).toBeGreaterThanOrEqual(1)
      expect(c).toBeLessThanOrEqual(MAX_COUNTER_SCALE)
    }
  })
})

describe('displayStatus', () => {
  it('Гермес «в работе», пока в лотке есть задачи', () => {
    const j = initialJournal()
    expect(displayStatus(j, j.workers[0])).toBe('run')
    const empty: Journal = { ...j, queue: j.queue.filter((t) => t.assignedTo !== null) }
    expect(displayStatus(empty, j.workers[0])).toBe('wait')
  })

  it('у остальных — собственный статус', () => {
    const j = initialJournal()
    expect(j.workers.slice(1).map((w) => displayStatus(j, w))).toEqual(j.workers.slice(1).map((w) => w.status))
    expect(displayStatus(j, null)).toBe('wait')
  })
})
