import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialJournal } from '../journal/initial'
import { OPS } from '../journal/ops'
import type { Journal } from '../journal/types'
import { CORRIDOR_TILES, GRASS, OUTER_WALL, OUTLINE, ROLE_COLORS, SCREEN, WALL } from '../theme/colors'
import { P, pts, rect } from './iso'
import { layoutOffice, sceneBounds } from './layout'
import { OfficeScene } from './OfficeScene'

const render = (j: Journal, cols = 4, scale = 1) =>
  renderToStaticMarkup(<OfficeScene journal={j} cols={cols} scale={scale} />)

function attrs(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1])
}

function addWorker(j: Journal): Journal {
  const r = OPS.addWorker(j, { model: 'claude', role: 'фулстак' })
  if (!('journal' in r)) throw new Error('addWorker не прошёл')
  return r.journal
}

describe('OfficeScene', () => {
  it('рисует SVG с viewBox по границам сцены', () => {
    const j = initialJournal()
    const html = render(j)
    const b = sceneBounds(layoutOffice(j.workers, 4))
    expect(html.startsWith('<svg')).toBe(true)
    expect(html).toContain(`viewBox="${b.minX} ${b.minY} ${b.width} ${b.height}"`)
    expect(html).toContain(`width="${Math.ceil(b.width)}"`)
  })

  it('scale меняет размер SVG, но не viewBox', () => {
    const j = initialJournal()
    const b = sceneBounds(layoutOffice(j.workers, 4))
    const html = render(j, 4, 0.5)
    expect(html).toContain(`width="${Math.ceil(b.width * 0.5)}"`)
    expect(html).toContain(`viewBox="${b.minX} ${b.minY} ${b.width} ${b.height}"`)
  })

  it('комнаты в DOM идут в painter-порядке раскладки', () => {
    const j = initialJournal()
    const html = render(j)
    const depths = attrs(html, 'data-depth').map(Number)
    expect(depths).toEqual(layoutOffice(j.workers, 4).cells.map((c) => c.depth))
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
  })

  it('одна комната на модель, кабинет Гермеса — один, зона отдыха в остатке ряда', () => {
    const j = initialJournal()
    const html = render(j)
    const cells = attrs(html, 'data-cell')
    expect(cells.filter((c) => c === 'boss')).toHaveLength(1)
    expect(cells.filter((c) => c === 'room')).toHaveLength(j.workers.length - 1)
    expect(cells.filter((c) => c === 'lounge')).toHaveLength(1)
    expect(new Set(attrs(html, 'data-worker'))).toEqual(new Set(j.workers.map((w) => w.id)))
    expect(attrs(html, 'data-free-room')).toEqual(['3,2'])
    expect(html).toContain('＋ свободная комната')
  })

  it('пол комнаты окрашен ковром роли', () => {
    const j = initialJournal()
    const html = render(j)
    const floor = pts(rect(0, 0, 160, 160))
    for (const w of j.workers.slice(1)) {
      const room = html.split(`data-worker="${w.id}"`)[1]
      expect(room).toContain(`points="${floor}" fill="${ROLE_COLORS[w.role]}"`)
    }
    expect(html.split('data-worker="w0"')[1]).toContain(`fill="${ROLE_COLORS['координатор']}"`)
  })

  it('экран ЭЛТ по статусу модели', () => {
    const j = initialJournal()
    const html = render(j)
    const screens = attrs(html, 'data-screen')
    expect(screens).toEqual(layoutOffice(j.workers, 4).cells.filter((c) => c.kind !== 'lounge').map((c) => (c.kind === 'boss' ? 'run' : c.worker.status)))
    expect(html).toContain(SCREEN.blocked)
  })

  it('палитра: контур, стены, шахматка коридора, трава, кирпич', () => {
    const html = render(initialJournal())
    expect(html).toContain(`stroke="${OUTLINE}"`)
    expect(html).toContain('stroke-linejoin="round"')
    for (const c of [WALL.face, WALL.top, CORRIDOR_TILES.light, CORRIDOR_TILES.dark, GRASS.light, GRASS.dark, OUTER_WALL.brickX.brick, OUTER_WALL.brickX.seam]) {
      expect(html).toContain(c)
    }
  })

  it('добавление модели растягивает офис', () => {
    let j = initialJournal()
    const h0 = Number(attrs(render(j), 'data-rows')[0])
    j = addWorker(j) // занимает зону отдыха (3,2)
    expect(Number(attrs(render(j), 'data-rows')[0])).toBe(h0)
    expect(attrs(render(j), 'data-free-room')).toEqual([])
    j = addWorker(j) // новый ряд
    const html = render(j)
    expect(Number(attrs(html, 'data-rows')[0])).toBe(h0 + 1)
    expect(attrs(html, 'data-free-room')).toEqual(['1,3', '2,3', '3,3'])
  })

  it('cols меняет ширину сетки', () => {
    const j = initialJournal()
    expect(attrs(render(j, 6), 'data-cols')).toEqual(['6'])
    expect(attrs(render(j, 6), 'data-rows')).toEqual(['2'])
    expect(attrs(render(j, 3), 'data-rows')).toEqual(['4'])
  })

  it('кнопка «свободная комната» стоит над центром зоны отдыха и контр-масштабируется', () => {
    const j = initialJournal()
    const c = layoutOffice(j.workers, 4).cells.find((x) => x.kind === 'lounge')
    if (!c) throw new Error('нет зоны отдыха')
    const [x, y] = P(c.ox + 80, c.oy + 80, 40)
    expect(render(j, 4, 1)).toContain(`transform="translate(${x},${y}) scale(1)"`)
    expect(render(j, 4, 0.4)).toContain(`transform="translate(${x},${y}) scale(1.5)"`)
  })

  it('чистая функция: одинаковый журнал — одинаковая разметка, журнал не мутируется', () => {
    const j = initialJournal()
    const snapshot = JSON.stringify(j)
    expect(render(j)).toBe(render(initialJournal()))
    expect(JSON.stringify(j)).toBe(snapshot)
  })
})
