import { describe, expect, it } from 'vitest'
import { BOSS_SIZE, G, H, L, M, P, PITCH, T, boxFaces, pts, quadX, quadY, rect } from './iso'

describe('константы сцены', () => {
  it('совпадают с README дизайнера', () => {
    expect({ L, G, PITCH, M, H, T }).toEqual({ L: 160, G: 110, PITCH: 270, M: 55, H: 64, T: 6 })
    expect(BOSS_SIZE).toBe(2 * L + G)
    expect(BOSS_SIZE).toBe(430)
  })
})

describe('проекция P(x,y,z) = [x − y, (x + y)/2 − z]', () => {
  it('начало координат остаётся на месте', () => {
    expect(P(0, 0, 0)).toEqual([0, 0])
    expect(P(0, 0)).toEqual([0, 0])
  })

  it('+x уходит вправо-вниз с наклоном 2:1', () => {
    expect(P(1, 0, 0)).toEqual([1, 0.5])
    expect(P(100, 0, 0)).toEqual([100, 50])
  })

  it('+y уходит влево-вниз с наклоном 2:1', () => {
    expect(P(0, 1, 0)).toEqual([-1, 0.5])
    expect(P(0, 100, 0)).toEqual([-100, 50])
  })

  it('z поднимает точку строго вверх на z', () => {
    expect(P(0, 0, 1)).toEqual([0, -1])
    expect(P(40, 20, 64)).toEqual([20, 30 - 64])
    const base = P(37, 91)
    const up = P(37, 91, H)
    expect(up[0]).toBe(base[0])
    expect(base[1] - up[1]).toBe(H)
  })

  it('линейна: P(a+b) = P(a) + P(b)', () => {
    const a = P(12, 7, 3)
    const b = P(-5, 30, 11)
    const s = P(7, 37, 14)
    expect(s[0]).toBeCloseTo(a[0] + b[0])
    expect(s[1]).toBeCloseTo(a[1] + b[1])
  })

  it('точки на одной диагонали x + y = const лежат на одной экранной высоте', () => {
    expect(P(100, 0)[1]).toBe(P(0, 100)[1])
    expect(P(70, 30)[1]).toBe(P(30, 70)[1])
  })
})

describe('полигоны', () => {
  it('pts округляет до 0.1 и склеивает пары', () => {
    expect(pts([P(0, 0), P(1, 0), [1.234, -5.678]])).toBe('0,0 1,0.5 1.2,-5.7')
  })

  it('rect — четыре угла на высоте z', () => {
    expect(rect(0, 0, 10, 20, 5)).toEqual([P(0, 0, 5), P(10, 0, 5), P(10, 20, 5), P(0, 20, 5)])
  })

  it('quadX/quadY лежат в своих плоскостях', () => {
    expect(quadX(6, 0, 10, 0, 18)).toEqual([P(6, 0, 0), P(6, 10, 0), P(6, 10, 18), P(6, 0, 18)])
    expect(quadY(6, 0, 10, 0, 18)).toEqual([P(0, 6, 0), P(10, 6, 0), P(10, 6, 18), P(0, 6, 18)])
  })

  it('boxFaces: верх на z+h, левая грань на y+d, правая на x+w', () => {
    const f = boxFaces(10, 20, 5, 30, 40, 50)
    expect(f.top).toEqual(rect(10, 20, 40, 60, 55))
    expect(f.left).toEqual(quadY(60, 10, 40, 5, 55))
    expect(f.right).toEqual(quadX(40, 20, 60, 5, 55))
  })
})
