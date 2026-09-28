// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_SLOT_MS, idleOffset } from '../animations'
import { initialJournal } from '../journal/initial'
import type { Journal } from '../journal/types'
import { SceneView } from './SceneView'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Начало слота «гуляет» у w2; соседние id сдвинуты на 1 мс, поэтому +10 мс — все в одной позе. */
const WALK = IDLE_SLOT_MS * 3 - idleOffset('w2') + 10
const COFFEE = WALK + IDLE_SLOT_MS
const SLEEP = WALK + 2 * IDLE_SLOT_MS

const noop = () => {}
function scene(timeMs?: number, motion = true, journal: Journal = initialJournal()) {
  const { container } = render(
    <SceneView journal={journal} selectedId={null} overDrop={null} motion={motion} timeMs={timeMs} onSelect={noop} onStartDrag={noop} onAddRoom={noop} />,
  )
  const one = (selector: string, root: ParentNode = container) => {
    const el = root.querySelector(selector)
    if (!el) throw new Error(`нет элемента ${selector}`)
    return el
  }
  return { container, one, room: (id: string) => one(`[data-cell][data-worker="${id}"]`) }
}
const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
const pose = (root: ParentNode, id: string) => root.querySelector(`[data-idle-pose][data-worker-id="${id}"]`)?.getAttribute('data-idle-pose')

describe('SceneView: персонажи в painter-порядке', () => {
  it('одна SVG-сцена: персонаж внутри своей комнаты, после стола и до передней стенки', () => {
    const { container, one, room } = scene(COFFEE)
    expect(container.querySelectorAll('svg[viewBox]')).toHaveLength(1)
    for (const id of ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']) {
      const r = room(id)
      const body = one(`[data-worker-id="${id}"]`, r)
      expect(follows(one('[data-screen]', r), body)).toBe(true)
      expect(follows(body, one('[data-wall="front"]', r))).toBe(true)
    }
  })

  it('комната — мишень drop; Гермес бросает в лоток', () => {
    const { one, room } = scene(COFFEE)
    expect(room('w2').getAttribute('data-drop')).toBe('w2')
    expect(room('w0').getAttribute('data-drop')).toBe('queue')
    expect(one('[data-worker-id="w0"]', room('w0')).closest('[data-drop]')?.getAttribute('data-drop')).toBe('queue')
  })

  it('гуляющий — объект коридора: после своей комнаты с передней стенкой, до комнаты следующего ряда', () => {
    const { container, one, room } = scene(WALK)
    const walker = one('[data-extra="walk-w2"]')
    expect(pose(walker, 'w2')).toBe('walk')
    expect(room('w2').querySelector('[data-worker-id="w2"]')).toBeNull()
    expect(follows(room('w2'), walker) && !room('w2').contains(walker)).toBe(true)
    // w2 в ячейке (3,0), w4 — под ним в (3,1).
    expect(follows(walker, room('w4'))).toBe(true)
    // На гуляющего можно бросать задачи.
    expect(one('[data-drop="w2"]', walker)).toBeTruthy()
    // Гуляют только бездельники (wait/done), не Гермес и не занятые.
    const walkers = [...container.querySelectorAll('[data-extra]')].map((el) => el.getAttribute('data-extra'))
    expect(walkers.sort()).toEqual(['walk-w2', 'walk-w3', 'walk-w5', 'walk-w6', 'walk-w7'])
  })
})

describe('SceneView: idle-анимации по графику', () => {
  it('поза — детерминированная функция времени: гуляет → кофе → спит', () => {
    expect(pose(scene(WALK).container, 'w2')).toBe('walk')
    cleanup()
    const coffee = scene(COFFEE)
    expect(pose(coffee.container, 'w2')).toBe('coffee')
    expect(pose(coffee.room('w2'), 'w2')).toBe('coffee')
    cleanup()
    expect(pose(scene(SLEEP).container, 'w2')).toBe('sleep')
  })

  it('занятые, заблокированные и Гермес сидят; motion=false — сидят все', () => {
    const { container } = scene(WALK)
    expect(pose(container, 'w1')).toBe('seated')
    expect(pose(container, 'w4')).toBe('seated')
    expect(container.querySelector('[data-idle-pose][data-worker-id="w0"]')).toBeNull()
    cleanup()
    const still = scene(WALK, false).container
    expect(still.querySelectorAll('[data-extra]')).toHaveLength(0)
    for (const id of ['w2', 'w3', 'w5', 'w6', 'w7']) expect(pose(still, id)).toBe('seated')
    expect(still.querySelector('.ph-motion')).toBeNull()
  })

  it('без timeMs — настенные часы: поза сменяется ровно на границе слота', () => {
    vi.useFakeTimers()
    vi.setSystemTime(WALK - 11)
    const { container } = scene()
    expect(pose(container, 'w2')).toBe('sleep')
    act(() => vi.advanceTimersByTime(1))
    expect(pose(container, 'w2')).toBe('walk')
  })
})
