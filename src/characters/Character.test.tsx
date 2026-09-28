import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../journal/catalog'
import type { Worker, WorkerStatus } from '../journal/types'
import { LAMP, SCREEN } from '../theme/colors'
import { Character } from './Character'
import { WorkerSign } from './WorkerSign'

const worker: Worker = {
  id: 'worker-example', model: CATALOG[0].model, name: 'Пример', provider: 'Example',
  role: 'исполнитель', color: '#000000', status: 'wait', task: null, doneCount: 0, history: [],
}
describe('SVG components', () => {
  it('renders every catalogue style and accessory, using catalogue colors', () => {
    for (const entry of CATALOG) {
      const markup = renderToStaticMarkup(<svg><Character worker={worker} catalogEntry={entry} /></svg>)
      expect(markup).toContain(`data-hair="${entry.style}"`)
      if (entry.acc) expect(markup).toContain(`data-accessory="${entry.acc}"`)
      for (const color of [entry.hair, entry.skin, entry.color]) expect(markup).toContain(color)
      expect(markup).toContain('r="17"')
    }
  })
  it('renders the matching screen and sign lamp for all four statuses', () => {
    for (const status of ['run', 'done', 'blocked', 'wait'] satisfies WorkerStatus[]) {
      const current = { ...worker, status }
      const markup = renderToStaticMarkup(<svg><Character worker={current} catalogEntry={CATALOG[0]} motion={false} /><WorkerSign worker={current} motion={false} /></svg>)
      expect(markup).toContain(SCREEN[status])
      expect(markup).toContain(LAMP[status])
      expect(markup).not.toContain('class="ph-motion"')
    }
  })
  it('exposes separate layers for scene painter ordering without duplicate furniture', () => {
    const body = renderToStaticMarkup(<Character worker={worker} catalogEntry={CATALOG[0]} layer="body" furniture={false} />)
    const arms = renderToStaticMarkup(<Character worker={worker} catalogEntry={CATALOG[0]} layer="arms" furniture={false} />)
    expect(body).toContain('ph-head')
    expect(body).not.toContain('ph-arm-a')
    expect(arms).toContain('ph-arm-a')
    expect(arms).not.toContain('ph-head')
    expect(body + arms).not.toContain('ph-screen')
  })
  it('paints the head in painter order from the designer reference: seated under desk, asleep over arms', () => {
    const at = (markup: string, needle: string) => {
      const i = markup.indexOf(needle)
      expect(i, needle).toBeGreaterThanOrEqual(0)
      return i
    }
    const seated = renderToStaticMarkup(<svg><Character worker={worker} catalogEntry={CATALOG[0]} /></svg>)
    expect(at(seated, 'ph-head')).toBeLessThan(at(seated, 'ph-screen'))
    expect(at(seated, 'ph-screen')).toBeLessThan(at(seated, 'ph-arm-a'))

    const sleep = renderToStaticMarkup(<svg><Character worker={worker} catalogEntry={CATALOG[0]} sleep /></svg>)
    expect(at(sleep, 'ph-screen')).toBeLessThan(at(sleep, 'ph-arm-a'))
    expect(at(sleep, 'ph-arm-a')).toBeLessThan(at(sleep, 'ph-arm-b'))
    expect(at(sleep, 'ph-arm-b')).toBeLessThan(at(sleep, 'ph-head'))
    expect(sleep.match(/class="ph-head"/g)).toHaveLength(1)

    const sleepBody = renderToStaticMarkup(<Character worker={worker} catalogEntry={CATALOG[0]} layer="body" furniture={false} sleep />)
    const sleepArms = renderToStaticMarkup(<Character worker={worker} catalogEntry={CATALOG[0]} layer="arms" furniture={false} sleep />)
    expect(sleepBody).not.toContain('ph-head')
    expect(at(sleepArms, 'ph-arm-b')).toBeLessThan(at(sleepArms, 'ph-head'))
  })
  it('escapes task titles and preserves full text in the SVG title', () => {
    const markup = renderToStaticMarkup(<WorkerSign worker={worker} taskTitle={'<script> & длинная задача '.repeat(8)} />)
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).toContain('…')
  })
})
