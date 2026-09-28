/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../journal/catalog'
import type { Worker } from '../journal/types'
import { IdleDirector } from './IdleDirector'
import { laneStyle, walkStyle } from './geometry'
import { idHash, idleOffset, idlePose, IDLE_POSES, IDLE_SLOT_MS, nextIdleDelay } from './schedule'

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
    // FNV-1a: эталонные значения 32-битного хэша.
    expect(idHash('')).toBe(0x811c9dc5)
    expect(idHash('a')).toBe(0xe40c292c)
    expect(idleOffset('w1')).toBe(idHash('w1') % (IDLE_SLOT_MS * 3))
    expect(nextIdleDelay(worker.id, start)).toBe(45_000)
    expect(nextIdleDelay(worker.id, start + 44_999)).toBe(1)
    expect(idlePose(worker, -idleOffset(worker.id) - 1)).toBe('sleep')
  })
  it('spreads offsets of neighbouring ids across the cycle (not ~0 apart)', () => {
    const cycle = IDLE_SLOT_MS * 3
    const ids = Array.from({ length: 12 }, (_, i) => `w${i + 1}`)
    for (let i = 1; i < ids.length; i++) {
      const d = Math.abs(idleOffset(ids[i]) - idleOffset(ids[i - 1]))
      expect(Math.min(d, cycle - d), `${ids[i - 1]}→${ids[i]}`).toBeGreaterThan(1_000)
    }
    // Сдвиги w1…w12 попадают во все три трети цикла, а не в одну.
    expect(new Set(ids.map(id => Math.floor(idleOffset(id) / IDLE_SLOT_MS))).size).toBe(3)
  })
  it('idle workers do different things at the same moment', () => {
    const team = Array.from({ length: 6 }, (_, i) => ({ ...worker, id: `w${i + 1}` }))
    for (let t = 0; t < IDLE_SLOT_MS * 3; t += 5_000) {
      expect(new Set(team.map(w => idlePose(w, t))).size, `t=${t}`).toBeGreaterThanOrEqual(2)
    }
    const counts = Object.fromEntries(IDLE_POSES.map(p => [p, 0]))
    for (const w of team) counts[idlePose(w, 0)!]++
    expect(Math.max(...Object.values(counts))).toBeLessThan(team.length)
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
    const delay = walkStyle('w1', lane)['--walk-delay']
    expect(delay).toMatch(/^-\d+\.\ds$/)
    expect(walkStyle('w2', lane)['--walk-delay']).not.toBe(delay)
    const markup = render(start)
    expect(markup).toContain(`--walk-delay:${delay}`)
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
  it('walk and coffee are the standing pose from standing(): legs, torso, static head, arms', () => {
    const torso = 'M-16,3 C-17,-10 -14,-21 -8,-25 L8,-25 C14,-21 17,-10 16,3 Z'
    for (const [offset, mode] of [[0, 'walk'], [45_000, 'coffee']] as const) {
      const markup = render(start + offset)
      expect(markup).toContain(`data-stand="${mode}"`)
      expect(markup.match(/data-leg/g)).toHaveLength(2)
      for (const x of [-8, 1]) expect(markup).toContain(`<rect x="${x}" y="-17" width="7" height="15"`)
      expect(markup).toContain('<ellipse cx="0" cy="0" rx="13" ry="4.5"')
      expect(markup).toContain('transform="translate(0 -15)"')
      expect(markup).toContain(torso)
      expect(markup.match(/class="ph-head"/g)).toHaveLength(1)
      expect(markup).not.toContain('data-idle-pose="seated"')
      // Голова статична: персонаж внутри — ph-still, без nod/sway.
      expect(markup).toContain('class="ph-still"')
      expect(markup).not.toContain('Q-22,-8 -29,3')
    }
    const walk = render(start)
    expect(walk).toContain('M-13,-18 Q-18,-8 -16,1')
    expect(walk).toContain('M12,-18 Q17,-8 15,1')
    expect(walk.match(/ph-idle-step-a/g)).toHaveLength(2)
    expect(walk.match(/ph-idle-step-b/g)).toHaveLength(2)
    // Ноги в противофазе: левая (x=-8) — stepA, правая (x=1) — stepB.
    expect(walk).toContain('class="ph-idle-step-a" data-leg="true"><rect x="-8"')
    expect(walk).toContain('class="ph-idle-step-b" data-leg="true"><rect x="1"')
    // Руки накрест ногам: левая рука с правой ногой, правая — с левой.
    expect(walk).toContain('class="ph-idle-step-b" data-arm="true"><path d="M-13,-18')
    expect(walk).toContain('class="ph-idle-step-a" data-arm="true"><path d="M12,-18')
    expect(walk).toContain('ph-idle-bob')
    expect(walk).not.toContain('data-cup-arm')
    const coffee = render(start + 45_000)
    expect(coffee).toContain('data-cup-arm')
    expect(coffee).toContain('M12,-18 Q11,-5 -1,-8')
    expect(coffee).toContain('<rect x="-9" y="-17" width="10" height="11" rx="1.5"')
    expect(coffee).toContain('M-6,-20 q-2,-3 0,-6 q2,-3 0,-6')
    expect(coffee).not.toContain('ph-idle-step')
    expect(coffee).not.toContain('ph-idle-bob')
  })
  it('walk steps are in anti-phase and actually step (no sliding)', () => {
    const css = readFileSync(new URL('../theme/animations.css', import.meta.url), 'utf8')
    const frames = (name: string) => css.split('\n').find(line => line.startsWith(`@keyframes ${name} `))!
    // stepA вверху там, где stepB внизу, — ноги не подпрыгивают вместе.
    expect(frames('stepA')).toContain('0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); }')
    expect(frames('stepB')).toContain('0%,100% { transform: translateY(-3px); } 50% { transform: translateY(0); }')
    // Переступание: ступни ходят вперёд-назад навстречу друг другу, а не только топают на месте.
    expect(frames('strideA')).toContain('0%,100% { translate: -2px 0; } 50% { translate: 2px 0; }')
    expect(frames('strideB')).toContain('0%,100% { translate: 2px 0; } 50% { translate: -2px 0; }')
    expect(css).toContain('.ph-idle-step-a { animation: stepA .45s ease-in-out infinite, strideA .45s ease-in-out -.3375s infinite; }')
    expect(css).toContain('.ph-idle-step-b { animation: stepB .45s ease-in-out infinite, strideB .45s ease-in-out -.3375s infinite; }')
    // Корпус поднимается на каждом шаге (дважды за цикл), а не раз за пару шагов.
    expect(frames('bob')).toContain('0%,50%,100% { transform: translateY(-1.5px); } 25%,75% { transform: translateY(0); }')
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
    for (const animation of ['walkLane 11s', 'face 11s', 'stepA .45s', 'stepB .45s', 'bob .45s', 'sip 4s', 'steam 1.6s', 'fadeIn .9s']) expect(css).toContain(animation)
    for (const variable of ['--x0', '--y0', '--x1', '--y1']) expect(css).toContain(`var(${variable})`)
    // Плавный ход с замедлением у концов коридора (как у дизайнера); разворот — в фазе с ходом.
    expect(css).toContain('walkLane 11s ease-in-out var(--walk-delay, 0s)')
    expect(css).toContain('face 11s linear var(--walk-delay, 0s)')
    expect(css).toContain('@keyframes face { 0%,49.9% { transform: scaleX(1); } 50%,100% { transform: scaleX(-1); } }')
    expect(css).toContain('.ph-still, .ph-still * { animation: none !important; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
