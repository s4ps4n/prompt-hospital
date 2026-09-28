// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLIGHT_MS } from '../animations'
import { createJournalStore, createMemoryStorage, type JournalStore } from '../journal'
import { PRIORITY_COLORS } from '../theme/colors'
import App from './App'

let store: JournalStore
let dom: ReturnType<typeof render>

beforeEach(() => {
  vi.useFakeTimers()
  store = createJournalStore({ storage: createMemoryStorage(), now: () => '12:00:00' })
  dom = render(<App store={store} />)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'elementFromPoint')
})

const $ = (selector: string): Element => {
  const el = dom.container.querySelector(selector)
  if (!el) throw new Error(`нет элемента ${selector}`)
  return el
}
const message = () => screen.getByRole('status')
const card = () => screen.getByRole('complementary', { name: 'Карточка модели' })
const task = (id: string) => store.getJournal().queue.find((t) => t.id === id)
const worker = (id: string) => store.getJournal().workers.find((w) => w.id === id)

/** Перетаскивание без приземления: jsdom не умеет elementFromPoint — подставляем цель под курсором. */
function release(source: Element, target: Element | null) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  fireEvent.pointerDown(source, { clientX: 10, clientY: 10, button: 0 })
  fireEvent.pointerMove(window, { clientX: 60, clientY: 40 })
  fireEvent.pointerUp(window, { clientX: 60, clientY: 40 })
}
const land = (ms = FLIGHT_MS) => act(() => vi.advanceTimersByTime(ms))
/** Перетаскивание + полёт конверта до приземления. */
function dragTo(source: Element, target: Element | null) {
  release(source, target)
  land()
}

describe('App: карточка', () => {
  it('клик по комнате открывает карточку модели', () => {
    expect(screen.queryByRole('complementary', { name: 'Карточка модели' })).toBeNull()
    fireEvent.click($('[data-room="w2"]'))
    expect(within(card()).getByRole('heading').textContent).toBe('GPT-5')
    expect(within(card()).getByText('ожидает')).toBeTruthy()
  })

  it('клик по вывеске тоже открывает карточку, ✕ закрывает', () => {
    fireEvent.click($('[data-sign="w4"]'))
    expect(within(card()).getByRole('heading').textContent).toBe('Qwen')
    fireEvent.click(within(card()).getByRole('button', { name: 'Закрыть карточку' }))
    expect(screen.queryByRole('complementary', { name: 'Карточка модели' })).toBeNull()
  })
})

describe('App: drag-and-drop', () => {
  it('drop конверта из лотка на свободную модель → assign, статус run', () => {
    dragTo($('[data-task-slot="T-13"]'), $('[data-room="w2"]'))
    expect(task('T-13')?.assignedTo).toBe('w2')
    expect(worker('w2')?.status).toBe('run')
    expect(worker('w2')?.task).toBe('T-13')
    expect(message().textContent).toContain('T-13 → GPT-5')
    fireEvent.click($('[data-room="w2"]'))
    expect(within(card()).getByText('в работе')).toBeTruthy()
    expect(within(card()).getByText('схема БД для заказов')).toBeTruthy()
  })

  it('drop на занятую модель → в её очередь, текущая задача не прерывается', () => {
    dragTo($('[data-task-slot="T-12"]'), $('[data-room="w1"]'))
    expect(task('T-12')?.assignedTo).toBe('w1')
    expect(worker('w1')?.task).toBe('T-07')
    expect(message().textContent).toContain('встала в очередь')
    fireEvent.click($('[data-room="w1"]'))
    const queue = within(card()).getByRole('list', { name: 'Очередь модели' })
    expect(within(queue).getByText('починить смоук karkas')).toBeTruthy()
  })

  it('несовпадение роли → отказ с сообщением, журнал не меняется', () => {
    const before = store.getJournal()
    dragTo($('[data-task-slot="T-13"]'), $('[data-room="w3"]'))
    expect(store.getJournal()).toBe(before)
    expect(message().getAttribute('data-kind')).toBe('err')
    expect(message().textContent).toContain('только для роли «архитектор»')
  })

  it('конверт со стола модели на лоток → unassign; мимо → сообщение', () => {
    dragTo($('[data-envelope="T-08"]'), $('[data-drop="queue"]'))
    expect(task('T-08')?.assignedTo).toBeNull()
    expect($('[data-task-slot="T-08"]')).toBeTruthy()

    dragTo($('[data-task-slot="T-12"]'), null)
    expect(task('T-12')?.assignedTo).toBeNull()
    expect(message().textContent).toContain('Мимо')
  })

  it('drop на конверт в лотке → reorder', () => {
    dragTo($('[data-task-slot="T-15"]'), $('[data-task-slot="T-12"]'))
    const tray = [...dom.container.querySelectorAll('[data-task-slot]')].map((el) => el.getAttribute('data-task-slot'))
    expect(tray.indexOf('T-15')).toBe(tray.indexOf('T-12') - 1)
    expect(task('T-15')?.priority).toBe(3)
  })

  it('без движения дальше порога — клик, а не drop; призрак только во время перетаскивания', () => {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => $('[data-room="w2"]') })
    fireEvent.pointerDown($('[data-envelope="T-07"]'), { clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(window, { clientX: 12, clientY: 12 })
    expect(dom.container.querySelector('[data-ghost]')).toBeNull()
    fireEvent.pointerUp(window, { clientX: 12, clientY: 12 })
    expect(task('T-07')?.assignedTo).toBe('w1')
    expect(within(card()).getByRole('heading').textContent).toBe('Claude')

    fireEvent.pointerDown($('[data-task-slot="T-12"]'), { clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 })
    expect($('[data-ghost="T-12"]')).toBeTruthy()
    expect($('[data-room="w2"]').getAttribute('fill')).not.toBe('transparent')
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 })
    expect(dom.container.querySelector('[data-ghost]')).toBeNull()
  })
})

describe('App: полёт конверта', () => {
  it('после drop конверт летит 450 мс по дуге, операция — по приземлении', () => {
    release($('[data-task-slot="T-13"]'), $('[data-room="w2"]'))
    const flight = $('[data-flight="T-13"]')
    const style = flight.getAttribute('style') ?? ''
    expect(style).toContain(`${FLIGHT_MS}ms cubic-bezier(.4,0,.2,1)`)
    expect(style).toContain(`${FLIGHT_MS}ms cubic-bezier(.3,-.6,.6,1)`)
    expect(dom.container.querySelector('[data-ghost]')).toBeNull()
    expect(task('T-13')?.assignedTo).toBeNull()
    land(FLIGHT_MS - 1)
    expect(task('T-13')?.assignedTo).toBeNull()
    land(1)
    expect(task('T-13')?.assignedTo).toBe('w2')
    expect(dom.container.querySelector('[data-flight]')).toBeNull()
    expect(message().textContent).toContain('T-13 → GPT-5')
  })

  it('отказ виден сразу, без полёта (сухой прогон до анимации)', () => {
    release($('[data-task-slot="T-13"]'), $('[data-room="w3"]'))
    expect(dom.container.querySelector('[data-flight]')).toBeNull()
    expect(message().getAttribute('data-kind')).toBe('err')
  })

  it('motion=false — без полёта, операция сразу', () => {
    cleanup()
    dom = render(<App store={store} motion={false} />)
    release($('[data-task-slot="T-13"]'), $('[data-room="w2"]'))
    expect(dom.container.querySelector('[data-flight]')).toBeNull()
    expect(task('T-13')?.assignedTo).toBe('w2')
  })
})

describe('App: приоритизация', () => {
  const slots = () => [...dom.container.querySelectorAll('[data-task-slot]')].map((el) => el.getAttribute('data-task-slot'))
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

  it('лоток: priority desc, order asc; флажки цвета приоритета', () => {
    expect(slots()).toEqual(['T-12', 'T-13', 'T-14', 'T-16', 'T-15', 'T-17'])
    const flags = [...dom.container.querySelectorAll<HTMLElement>('[data-task-slot] > div:first-child')].map((el) => el.style.background)
    expect(flags).toEqual([3, 2, 2, 2, 1, 1].map((p) => rgb(PRIORITY_COLORS[p as 1 | 2 | 3])))
    expect(PRIORITY_COLORS).toEqual({ 3: '#e0402e', 2: '#f2c230', 1: '#a3a3a3' })
    expect($('[data-envelope="T-09"] [data-priority]').getAttribute('fill')).toBe(PRIORITY_COLORS[3])
  })

  it('▲ пересортировывает лоток сразу', () => {
    const tray = screen.getByRole('region', { name: 'Лоток Гермеса' })
    const up = () => within($('[data-task-slot="T-17"]') as HTMLElement).getByTitle('Повысить приоритет')
    fireEvent.click(up())
    fireEvent.click(up())
    expect(task('T-17')?.priority).toBe(3)
    expect(slots()).toEqual(['T-12', 'T-17', 'T-13', 'T-14', 'T-16', 'T-15'])
    expect(within(tray).getAllByRole('listitem')).toHaveLength(6)
  })

  it('очередь модели: сортировка и reorder перетаскиванием', () => {
    act(() => {
      store.run('assign', { task: 'T-12', worker: 'w1' })
    })
    fireEvent.click($('[data-room="w1"]'))
    const queue = () => [...within(card()).getByRole('list', { name: 'Очередь модели' }).querySelectorAll('[data-queue-task]')].map((el) => el.getAttribute('data-queue-task'))
    expect(queue()).toEqual(['T-12', 'T-08'])
    dragTo($('[data-queue-task="T-08"]'), $('[data-queue-task="T-12"]'))
    expect(queue()).toEqual(['T-08', 'T-12'])
    expect(task('T-08')).toMatchObject({ priority: 3, assignedTo: 'w1' })
    expect(worker('w1')?.task).toBe('T-07')
  })
})

describe('App: роль и состав офиса', () => {
  it('смена роли у занятой модели заблокирована: тряска и ошибка', () => {
    fireEvent.click($('[data-room="w1"]'))
    const select = within(card()).getByLabelText<HTMLSelectElement>('Роль')
    expect(select.disabled).toBe(true)
    fireEvent.click(within(card()).getByTestId('role-lock'))
    expect(within(card()).getByTestId('role-lock').className).toBe('ph-nope')
    expect(message().getAttribute('data-kind')).toBe('err')
    expect(message().textContent).toContain('Нельзя сменить роль: Claude в работе')
    expect(worker('w1')?.role).toBe('исполнитель')
  })

  it('у свободной модели роль меняется через select', () => {
    fireEvent.click($('[data-room="w2"]'))
    fireEvent.change(within(card()).getByLabelText('Роль'), { target: { value: 'фулстак' } })
    expect(worker('w2')?.role).toBe('фулстак')
    expect(message().textContent).toContain('GPT-5: роль «фулстак»')
  })

  it('addTask через форму → задача в лотке', () => {
    fireEvent.change(screen.getByLabelText('Название задачи'), { target: { value: 'новый отчёт' } })
    fireEvent.change(screen.getByLabelText('Приоритет'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Роль задачи'), { target: { value: 'сисадмин' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ В лоток' }))
    const t = store.getJournal().queue.find((x) => x.title === 'новый отчёт')
    expect(t).toMatchObject({ priority: 3, kind: 'сисадмин', assignedTo: null })
    const tray = screen.getByRole('region', { name: 'Лоток Гермеса' })
    expect(within(tray).getByText('новый отчёт')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Название задачи').value).toBe('')
  })

  it('пустое название задачи → ошибка из журнала', () => {
    fireEvent.click(screen.getByRole('button', { name: '＋ В лоток' }))
    expect(message().textContent).toContain('Введите название задачи')
  })

  it('removeWorker у занятой модели → ошибка, модель остаётся', () => {
    fireEvent.click($('[data-room="w1"]'))
    fireEvent.click(within(card()).getByRole('button', { name: 'Убрать из офиса' }))
    expect(worker('w1')).toBeTruthy()
    expect(message().getAttribute('data-kind')).toBe('err')
    expect(message().textContent).toContain('Нельзя убрать Claude')
  })

  it('removeWorker у свободной модели → комната и карточка исчезают', () => {
    fireEvent.click($('[data-room="w2"]'))
    fireEvent.click(within(card()).getByRole('button', { name: 'Убрать из офиса' }))
    expect(worker('w2')).toBeUndefined()
    expect(dom.container.querySelector('[data-room="w2"]')).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Карточка модели' })).toBeNull()
  })

  it('каталог: модель + роль → addWorker, открывается карточка новой модели', () => {
    fireEvent.click(screen.getByRole('button', { name: '＋ Модель' }))
    const dialog = screen.getByRole('dialog', { name: 'Каталог моделей' })
    fireEvent.click(within(dialog).getByRole('option', { name: /Mistral/ }))
    fireEvent.change(within(dialog).getByLabelText('Роль:'), { target: { value: 'приёмщик' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить в офис' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const added = store.getJournal().workers.at(-1)
    expect(added).toMatchObject({ model: 'mistral', role: 'приёмщик', status: 'wait' })
    expect(within(card()).getByText(`Mistral AI · ${added?.id}`)).toBeTruthy()
  })

  it('«＋ Экземпляр с другой ролью» открывает каталог с той же моделью и другой ролью', () => {
    fireEvent.click($('[data-room="w2"]'))
    fireEvent.click(within(card()).getByRole('button', { name: '＋ Экземпляр с другой ролью' }))
    const dialog = screen.getByRole('dialog', { name: 'Каталог моделей' })
    const models = within(dialog).getByRole('listbox', { name: 'Модели' })
    expect(within(models).getByRole('option', { selected: true }).getAttribute('data-model')).toBe('gpt5')
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Роль:').value).not.toBe('архитектор')
  })
})

describe('App: отрисовка — функция от журнала', () => {
  it('операция мимо UI (store.run) перерисовывает сцену, лоток и счётчики', () => {
    expect($('[data-counter="run"]').textContent).toContain('в работе: 1')
    act(() => {
      store.run('assign', { task: 'T-12', worker: 'w3' })
    })
    expect(dom.container.querySelector('[data-task-slot="T-12"]')).toBeNull()
    expect($('[data-envelope="T-12"]').getAttribute('data-drop')).toBe('w3')
    expect($('[data-counter="run"]').textContent).toContain('в работе: 2')
  })

  it('«Журнал» показывает JSON-дамп с операциями', () => {
    dragTo($('[data-task-slot="T-13"]'), $('[data-room="w2"]'))
    fireEvent.click(screen.getByRole('button', { name: 'Журнал' }))
    const dump = within(screen.getByRole('dialog', { name: 'Журнал оркестратора' })).getByText(/"operations"/)
    expect(dump.textContent).toContain('"op": "assign"')
  })
})
