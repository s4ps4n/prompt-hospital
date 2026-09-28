/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../journal/catalog'
import type { Worker } from '../journal/types'
import { IdleDirector } from './IdleDirector'
import { laneStyle } from './geometry'
import { idleOffset, idlePose, IDLE_SLOT_MS, nextIdleDelay } from './schedule'

const worker: Worker = { id: 'w1', model: 'deepseek', name: 'DeepSeek', provider: 'DeepSeek', role: 'исполнитель', color: '#000000', status: 'wait', task: null, doneCount: 0, history: [] }
const lane = { from: { x: -80, y: 70 }, to: { x: 90, y: 110 } }
const start = IDLE_SLOT_MS * 3 - idleOffset(worker.id)
const render = (timeMs: number, motion = true, current = worker) => renderToStaticMarkup(
  <svg><IdleDirector worker={current} catalogEntry={CATALOG[0]} lane={lane} door={{ x: 40, y: 50 }} timeMs={timeMs} motion={motion} onClick={() => {}} /></svg>,
)

describe('idle schedule', () => {
  it('changes exactly at 45-second boundaries and repeats after three activities', () => {
    expect(idlePose(worker, start - 1)).toBe('sleep')
    expect(idlePose(worker, start)).toBe('walk')
    expect(idlePose(worker, start + 44_999)).toBe('walk')
    expect(idlePose(worker, start + 45_000)).toBe('coffee')
    expect(idlePose(worker, start + 90_000)).toBe('sleep')
    expect(idlePose(worker, start + 135_000)).toBe('walk')
    expect(idlePose({ ...worker, status: 'done' }, start)).toBe('walk')
  })
  it('has stable id offsets and schedules the next exact boundary', () => {
    expect(idleOffset('w1')).toBe(3738)
    expect(idleOffset('w2')).toBe(3739)
    expect(nextIdleDelay(worker.id, start)).toBe(45_000)
    expect(nextIdleDelay(worker.id, start + 44_999)).toBe(1)
    expect(idlePose(worker, -idleOffset(worker.id) - 1)).toBe('sleep')
  })
  it('excludes Hermes, active and blocked workers, and motion opt-out', () => {
    for (const status of ['run', 'blocked'] as const) expect(idlePose({ ...worker, status }, start)).toBeNull()
    expect(idlePose({ ...worker, id: 'w0' }, start)).toBeNull()
    expect(idlePose({ ...worker, role: 'координатор' }, start)).toBeNull()
    expect(idlePose(worker, start, false)).toBeNull()
    expect(idlePose(worker, NaN)).toBeNull()
  })
})

describe('IdleDirector SVG contract', () => {
  it('exports all four lane variables and a moving click/drop target', () => {
    expect(laneStyle(lane)).toEqual({ '--x0': '-80px', '--y0': '70px', '--x1': '90px', '--y1': '110px' })
    const markup = render(start)
    for (const value of ['--x0:-80px', '--y0:70px', '--x1:90px', '--y1:110px', 'data-drop="w1"', 'role="button"', 'tabindex="0"', 'ph-idle-step-a', 'ph-idle-step-b']) expect(markup).toContain(value)
    expect(markup).toContain('data-idle-chair="empty"')
    expect(markup.match(/class="ph-head"/g)).toHaveLength(1)
  })
  it('renders coffee at the door and sleep on the desk, without duplicate characters', () => {
    const coffee = render(start + 45_000)
    expect(coffee).toContain('translate(40 50)')
    expect(coffee).toContain('ph-idle-steam')
    expect(coffee).toContain('data-idle-chair="empty"')
    const sleep = render(start + 90_000)
    expect(sleep).toContain('data-idle-chair="occupied"')
    expect(sleep).toContain('ph-idle-drool')
    expect(sleep.match(/>z<\/text>/g)).toHaveLength(3)
    expect(sleep.match(/class="ph-head"/g)).toHaveLength(1)
    // Как в character() дизайнера: глаза-дуги, открытый рот, голова на столе translate(2,26) rotate(-28).
    expect(sleep).toContain('ph-eyes-closed')
    expect(sleep).not.toContain('class="ph-eyes"')
    expect(sleep).toContain('M-4.5,-33 A2.5,2 0 1 0 0.5,-33')
    expect(sleep.match(/transform="translate\(2 26\) rotate\(-28\)"/g)).toHaveLength(2)
    expect(render(start)).not.toContain('rotate(')
  })
  it('keeps sleep geometry in markup, not in invented CSS head transforms', () => {
    const css = readFileSync(new URL('../theme/animations.css', import.meta.url), 'utf8')
    expect(css).not.toMatch(/\.ph-idle-sleep \.ph-(head|eyes)/)
  })
  it('motion=false restores the static seated character for every slot', () => {
    for (const offset of [0, 45_000, 90_000]) {
      const markup = render(start + offset, false)
      expect(markup).toContain('data-idle-pose="seated"')
      expect(markup).not.toContain('ph-motion')
      expect(markup).not.toContain('ph-idle-enter')
      expect(markup).not.toContain('ph-idle-lane')
    }
  })
  it('can omit furniture when the host owns painter ordering', () => {
    const markup = renderToStaticMarkup(<IdleDirector worker={worker} catalogEntry={CATALOG[0]} lane={lane} door={lane.from} timeMs={start} furniture={false} />)
    expect(markup).not.toContain('data-idle-chair')
    expect(markup).not.toContain('ph-screen')
  })
  it('uses required CSS timings and honors reduced motion', () => {
    const css = readFileSync(new URL('../theme/animations.css', import.meta.url), 'utf8')
    for (const animation of ['walkLane 11s', 'face 11s', 'stepA .45s', 'stepB .45s', 'sip 4s', 'steam 1.6s', 'fadeIn .9s']) expect(css).toContain(animation)
    for (const variable of ['--x0', '--y0', '--x1', '--y1']) expect(css).toContain(`var(${variable})`)
    expect(css).toContain('.ph-still, .ph-still * { animation: none !important; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
