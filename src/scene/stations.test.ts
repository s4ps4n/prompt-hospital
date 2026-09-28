import { describe, expect, it } from 'vitest'
import { initialJournal } from '../journal/initial'
import { L, M, P } from './iso'
import { layoutOffice } from './layout'
import { doorSpan } from './rooms'
import { LANE_X_PAD, LANE_Y, doorX, idleRoute, roomConfig, seatPoint, type RoomCell } from './stations'

const WALK_Z = 15
/** Точка относительно кресла → координаты пола комнаты (высота WALK_Z). */
function floorOf(cell: RoomCell, p: { x: number; y: number }) {
  const [sx, sy] = seatPoint(roomConfig(cell))
  const X = p.x + sx
  const Y = p.y + sy + WALK_Z
  // P(x,y) = [x − y, (x + y)/2] ⇒ x = Y + X/2, y = Y − X/2
  return { x: Y + X / 2, y: Y - X / 2 }
}

const layout = layoutOffice(initialJournal().workers)
const rooms = layout.cells.filter((c): c is Extract<RoomCell, { kind: 'room' }> => c.kind === 'room')

describe('idleRoute: геометрия бездельника по референсу дизайнера', () => {
  it('дверь выводится из проёма передней стены, а не задана на глаз', () => {
    const [a, b] = doorSpan(L)
    expect(doorX(L)).toBe((a + b) / 2)
    // У дизайнера кофе — P(ox + 70 + …, oy + L + 34): 70 и есть середина проёма.
    expect(doorX(L)).toBe(70)
  })

  it('кофе — у двери, снаружи передней стенки, в коридоре', () => {
    expect(rooms.length).toBeGreaterThan(0)
    for (const cell of rooms) {
      const p = floorOf(cell, idleRoute(cell).door)
      const [a, b] = doorSpan(cell.size)
      expect(p.x).toBeCloseTo(doorX(cell.size))
      expect(p.x).toBeGreaterThan(a)
      expect(p.x).toBeLessThan(b)
      expect(p.y).toBeCloseTo(cell.size + LANE_Y)
    }
  })

  it('маршрут — по коридору перед своей комнатой, в пределах поля M', () => {
    expect(LANE_Y).toBe(34)
    expect(LANE_Y).toBeLessThan(M)
    for (const cell of rooms) {
      const { from, to } = idleRoute(cell).lane
      const a = floorOf(cell, from)
      const b = floorOf(cell, to)
      expect(a.y).toBeCloseTo(cell.size + LANE_Y)
      expect(b.y).toBeCloseTo(cell.size + LANE_Y)
      expect(a.x).toBeCloseTo(LANE_X_PAD)
      expect(b.x).toBeCloseTo(cell.size - LANE_X_PAD)
    }
    // Дорожка нижнего ряда — между комнатой и оградой (поле M).
    const bottom = Math.max(...rooms.map((c) => c.oy))
    expect(bottom + L + LANE_Y).toBeLessThan(layout.height)
  })

  it('экранные координаты — относительно кресла, по изометрии P', () => {
    const cell = rooms[0]
    const seat = seatPoint(roomConfig(cell))
    const [x, y] = P(doorX(cell.size), cell.size + LANE_Y, WALK_Z)
    expect(idleRoute(cell).door).toEqual({ x: x - seat[0], y: y - seat[1] })
  })
})
