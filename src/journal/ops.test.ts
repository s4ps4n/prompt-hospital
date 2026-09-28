import { describe, expect, it } from 'vitest'
import { CATALOG, ROLES } from './catalog'
import { initialJournal } from './initial'
import { OPS, applyOp } from './ops'
import { findTask, findWorker, trayTasks, workerQueue } from './selectors'
import type { Journal, OpArgs, OpName, OpResult, Priority } from './types'

/** Достаёт журнал из успешного результата, иначе валит тест с текстом ошибки. */
function ok(r: OpResult): Journal {
  if (!('msg' in r)) throw new Error(`ожидался успех, получено ${JSON.stringify(r)}`)
  return r.journal
}

function createdId(r: OpResult): string {
  if (!('msg' in r) || !r.id) throw new Error(`ожидался id созданной сущности, получено ${JSON.stringify(r)}`)
  return r.id
}

function errOf(r: OpResult): string {
  if (!('err' in r)) throw new Error(`ожидалась ошибка, получено ${JSON.stringify(r)}`)
  return r.err
}

const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id)
const worker = (j: Journal, id: string) => {
  const w = findWorker(j, id)
  if (!w) throw new Error(`нет модели ${id}`)
  return w
}
const task = (j: Journal, id: string) => {
  const t = findTask(j, id)
  if (!t) throw new Error(`нет задачи ${id}`)
  return t
}

/** Все инварианты журнала; возвращает список нарушений (пусто — всё в порядке). */
function invariantViolations(j: Journal): string[] {
  const out: string[] = []
  for (const w of j.workers) {
    const busy = w.status === 'run' || w.status === 'blocked'
    if ((w.task !== null) !== busy) out.push(`${w.id}: task=${w.task}, status=${w.status}`)
    if (w.task !== null) {
      const t = findTask(j, w.task)
      if (!t) out.push(`${w.id}: текущая ${w.task} не существует`)
      else if (t.assignedTo !== w.id) out.push(`${w.id}: текущая ${t.id} назначена ${t.assignedTo}`)
    }
    if (w.task === null && workerQueue(j, w.id).length > 0) out.push(`${w.id}: свободна, но очередь не пуста`)
    if (w.role === 'координатор' && j.queue.some((t) => t.assignedTo === w.id)) out.push(`${w.id}: у координатора задачи`)
  }
  for (const t of j.queue) {
    if (t.assignedTo === null) continue
    const w = findWorker(j, t.assignedTo)
    if (!w) out.push(`${t.id}: назначена несуществующей ${t.assignedTo}`)
    else if (t.kind && t.kind !== w.role) out.push(`${t.id}: kind ${t.kind} ≠ роль ${w.role}`)
  }
  if (new Set(j.queue.map((t) => t.id)).size !== j.queue.length) out.push('дубли id задач')
  if (new Set(j.workers.map((w) => w.id)).size !== j.workers.length) out.push('дубли id моделей')
  return out
}

describe('стартовый журнал', () => {
  it('соблюдает инварианты', () => {
    expect(invariantViolations(initialJournal())).toEqual([])
  })

  it('каталог — 8 моделей, Гермес — координатор w0', () => {
    expect(CATALOG).toHaveLength(8)
    const j = initialJournal()
    expect(worker(j, 'w0')).toMatchObject({ name: 'Гермес', role: 'координатор' })
  })
})

describe('assign', () => {
  it('на свободную модель — задача текущая, статус run', () => {
    const j = ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w2' }))
    expect(worker(j, 'w2')).toMatchObject({ task: 'T-12', status: 'run' })
    expect(task(j, 'T-12').assignedTo).toBe('w2')
  })

  it('на модель в статусе done — тоже становится текущей', () => {
    const j = ok(OPS.assign(initialJournal(), { task: 'T-16', worker: 'w6' }))
    expect(worker(j, 'w6')).toMatchObject({ task: 'T-16', status: 'run' })
  })

  it('на занятую модель — в очередь, текущая не прерывается', () => {
    const r = OPS.assign(initialJournal(), { task: 'T-12', worker: 'w1' })
    const j = ok(r)
    expect(worker(j, 'w1')).toMatchObject({ task: 'T-07', status: 'run' })
    expect(ids(workerQueue(j, 'w1'))).toEqual(['T-12', 'T-08'])
    expect('msg' in r && r.msg).toContain('очередь')
  })

  it('на заблокированную — в очередь, статус blocked сохраняется', () => {
    const j = ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w4' }))
    expect(worker(j, 'w4')).toMatchObject({ task: 'T-09', status: 'blocked' })
    expect(ids(workerQueue(j, 'w4'))).toEqual(['T-12'])
  })

  it('повторно на ту же модель — noop', () => {
    expect(OPS.assign(initialJournal(), { task: 'T-08', worker: 'w1' })).toEqual({ noop: true })
  })

  it('на Гермеса — это unassign', () => {
    const j = ok(OPS.assign(initialJournal(), { task: 'T-08', worker: 'w0' }))
    expect(task(j, 'T-08').assignedTo).toBeNull()
    expect(worker(j, 'w0').task).toBeNull()
  })

  it('несуществующие задача/модель — err', () => {
    errOf(OPS.assign(initialJournal(), { task: 'T-999', worker: 'w2' }))
    errOf(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w999' }))
  })
})

describe('kind ≠ роль', () => {
  it('assign даёт err с сообщением', () => {
    const e = errOf(OPS.assign(initialJournal(), { task: 'T-13', worker: 'w3' }))
    expect(e).toContain('архитектор')
    expect(e).toContain('фулстак')
  })

  it('reassign даёт err с сообщением', () => {
    const j = ok(OPS.assign(initialJournal(), { task: 'T-13', worker: 'w2' }))
    const e = errOf(OPS.reassign(j, { task: 'T-13', from: 'w2', to: 'w5' }))
    expect(e).toContain('только для роли «архитектор»')
  })

  it('задача без kind идёт любой роли', () => {
    ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w7' }))
  })
})

describe('reassign', () => {
  it('переносит текущую задачу; исходная модель берёт следующую из очереди', () => {
    const j = ok(OPS.reassign(initialJournal(), { task: 'T-07', from: 'w1', to: 'w2' }))
    expect(worker(j, 'w2')).toMatchObject({ task: 'T-07', status: 'run' })
    expect(worker(j, 'w1')).toMatchObject({ task: 'T-08', status: 'run' })
  })

  it('перенос последней задачи освобождает модель (wait)', () => {
    const j = ok(OPS.reassign(initialJournal(), { task: 'T-08', from: 'w1', to: 'w3' }))
    const j2 = ok(OPS.reassign(j, { task: 'T-07', from: 'w1', to: 'w2' }))
    expect(worker(j2, 'w1')).toMatchObject({ task: null, status: 'wait' })
  })

  it('from не совпадает с владельцем — err', () => {
    errOf(OPS.reassign(initialJournal(), { task: 'T-07', from: 'w2', to: 'w3' }))
  })
})

describe('unassign', () => {
  it('задача из очереди уходит в лоток, текущая модели не меняется', () => {
    const j = ok(OPS.unassign(initialJournal(), { task: 'T-08' }))
    expect(task(j, 'T-08').assignedTo).toBeNull()
    expect(ids(trayTasks(j))).toContain('T-08')
    expect(worker(j, 'w1')).toMatchObject({ task: 'T-07', status: 'run' })
  })

  it('текущая задача уходит в лоток, модель берёт следующую', () => {
    const j = ok(OPS.unassign(initialJournal(), { task: 'T-07' }))
    expect(task(j, 'T-07').assignedTo).toBeNull()
    expect(worker(j, 'w1')).toMatchObject({ task: 'T-08', status: 'run' })
  })

  it('последняя задача заблокированной модели — модель wait', () => {
    const j = ok(OPS.unassign(initialJournal(), { task: 'T-09' }))
    expect(worker(j, 'w4')).toMatchObject({ task: null, status: 'wait' })
  })

  it('задача уже в лотке — noop', () => {
    expect(OPS.unassign(initialJournal(), { task: 'T-12' })).toEqual({ noop: true })
  })
})

describe('setRole', () => {
  it('у свободной модели (wait) — ок', () => {
    const j = ok(OPS.setRole(initialJournal(), { worker: 'w2', role: 'дизайнер' }))
    expect(worker(j, 'w2').role).toBe('дизайнер')
  })

  it('у модели в статусе done — ок', () => {
    const j = ok(OPS.setRole(initialJournal(), { worker: 'w6', role: 'приёмщик' }))
    expect(worker(j, 'w6').role).toBe('приёмщик')
  })

  it('у занятой (run) — err', () => {
    expect(errOf(OPS.setRole(initialJournal(), { worker: 'w1', role: 'архитектор' }))).toContain('в работе')
  })

  it('у заблокированной — err', () => {
    errOf(OPS.setRole(initialJournal(), { worker: 'w4', role: 'архитектор' }))
  })

  it('у Гермеса — err, роль закреплена', () => {
    errOf(OPS.setRole(initialJournal(), { worker: 'w0', role: 'исполнитель' }))
  })

  it('назначить роль координатора нельзя', () => {
    errOf(OPS.setRole(initialJournal(), { worker: 'w2', role: 'координатор' }))
  })

  it('та же роль — noop', () => {
    expect(OPS.setRole(initialJournal(), { worker: 'w2', role: 'архитектор' })).toEqual({ noop: true })
  })
})

describe('setPriority', () => {
  it('пересортировывает лоток', () => {
    const before = initialJournal()
    expect(ids(trayTasks(before))[0]).toBe('T-12')
    const j = ok(OPS.setPriority(before, { task: 'T-17', priority: 3 }))
    expect(task(j, 'T-17').priority).toBe(3)
    // T-17 (order 9) остаётся позади T-12 (order 4) внутри высокого приоритета
    expect(ids(trayTasks(j)).slice(0, 2)).toEqual(['T-12', 'T-17'])
  })

  it('пересортировывает очередь модели', () => {
    let j = ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w1' }))
    j = ok(OPS.setPriority(j, { task: 'T-12', priority: 1 }))
    expect(ids(workerQueue(j, 'w1'))).toEqual(['T-08', 'T-12'])
    j = ok(OPS.setPriority(j, { task: 'T-12', priority: 2 }))
    expect(ids(workerQueue(j, 'w1'))).toEqual(['T-12', 'T-08'])
  })

  it('тот же приоритет — noop; неверный — err', () => {
    expect(OPS.setPriority(initialJournal(), { task: 'T-12', priority: 3 })).toEqual({ noop: true })
    errOf(OPS.setPriority(initialJournal(), { task: 'T-12', priority: 5 as Priority }))
  })
})

describe('reorder', () => {
  it('в лотке: встаёт перед целью и берёт её приоритет', () => {
    const j = ok(OPS.reorder(initialJournal(), { task: 'T-17', before: 'T-14' }))
    expect(task(j, 'T-17').priority).toBe(2)
    expect(ids(trayTasks(j))).toEqual(['T-12', 'T-13', 'T-17', 'T-14', 'T-16', 'T-15'])
  })

  it('в лотке: вверх в более высокий приоритет', () => {
    const j = ok(OPS.reorder(initialJournal(), { task: 'T-15', before: 'T-12' }))
    expect(task(j, 'T-15').priority).toBe(3)
    expect(ids(trayTasks(j))[0]).toBe('T-15')
  })

  it('в очереди модели: встаёт перед целью', () => {
    let j = ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w1' }))
    expect(ids(workerQueue(j, 'w1'))).toEqual(['T-12', 'T-08'])
    j = ok(OPS.reorder(j, { task: 'T-08', before: 'T-12' }))
    expect(ids(workerQueue(j, 'w1'))).toEqual(['T-08', 'T-12'])
    expect(worker(j, 'w1').task).toBe('T-07')
  })

  it('назначенная задача перед конвертом в лотке — возвращается в лоток', () => {
    const j = ok(OPS.reorder(initialJournal(), { task: 'T-08', before: 'T-13' }))
    expect(task(j, 'T-08').assignedTo).toBeNull()
    expect(ids(trayTasks(j)).indexOf('T-08')).toBe(ids(trayTasks(j)).indexOf('T-13') - 1)
    expect(workerQueue(j, 'w1')).toEqual([])
  })

  it('из лотка в очередь модели — kind проверяется', () => {
    let j = ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w1' }))
    errOf(OPS.reorder(j, { task: 'T-13', before: 'T-12' }))
    const r = OPS.addTask(j, { title: 'без роли', priority: 3 })
    const id = createdId(r)
    j = ok(OPS.reorder(ok(r), { task: id, before: 'T-08' }))
    expect(task(j, id)).toMatchObject({ assignedTo: 'w1', priority: 1 })
    expect(ids(workerQueue(j, 'w1'))).toEqual(['T-12', id, 'T-08'])
    expect(worker(j, 'w1').task).toBe('T-07')
  })

  it('перед текущей задачей модели — err', () => {
    errOf(OPS.reorder(initialJournal(), { task: 'T-12', before: 'T-07' }))
  })

  it('перед собой — noop', () => {
    expect(OPS.reorder(initialJournal(), { task: 'T-12', before: 'T-12' })).toEqual({ noop: true })
  })
})

describe('complete', () => {
  it('с очередью — в history, doneCount++, берётся следующая по приоритету', () => {
    let j = ok(OPS.assign(initialJournal(), { task: 'T-12', worker: 'w1' }))
    j = ok(OPS.complete(j, { worker: 'w1' }))
    const w = worker(j, 'w1')
    expect(w).toMatchObject({ task: 'T-12', status: 'run', doneCount: 4 })
    expect(w.history[0]).toBe('рефакторинг роутера admin-api')
    expect(findTask(j, 'T-07')).toBeUndefined()
  })

  it('без очереди — статус done, doneCount++', () => {
    let j = ok(OPS.assign(initialJournal(), { task: 'T-13', worker: 'w2' }))
    j = ok(OPS.complete(j, { worker: 'w2' }))
    expect(worker(j, 'w2')).toMatchObject({ task: null, status: 'done', doneCount: 1, history: ['схема БД для заказов'] })
  })

  it('заблокированную тоже можно завершить', () => {
    const j = ok(OPS.complete(initialJournal(), { worker: 'w4' }))
    expect(worker(j, 'w4')).toMatchObject({ status: 'done', doneCount: 2 })
  })

  it('history ограничена 6 записями', () => {
    let j = initialJournal()
    for (let i = 0; i < 8; i++) {
      const r = OPS.addTask(j, { title: `задача ${i}`, priority: 2 })
      j = ok(r)
      j = ok(OPS.assign(j, { task: createdId(r), worker: 'w2' }))
      j = ok(OPS.complete(j, { worker: 'w2' }))
    }
    expect(worker(j, 'w2').history).toHaveLength(6)
    expect(worker(j, 'w2').doneCount).toBe(8)
  })

  it('без текущей задачи — err', () => {
    errOf(OPS.complete(initialJournal(), { worker: 'w2' }))
  })
})

describe('block', () => {
  it('статус blocked, задача остаётся текущей', () => {
    const j = ok(OPS.block(initialJournal(), { worker: 'w1' }))
    expect(worker(j, 'w1')).toMatchObject({ status: 'blocked', task: 'T-07' })
  })

  it('повторный block снимает блокировку', () => {
    const j = ok(OPS.block(initialJournal(), { worker: 'w4' }))
    expect(worker(j, 'w4')).toMatchObject({ status: 'run', task: 'T-09' })
  })

  it('у свободной модели — err', () => {
    errOf(OPS.block(initialJournal(), { worker: 'w2' }))
  })
})

describe('addWorker / removeWorker', () => {
  it('addWorker создаёт модель из каталога с ролью, статус wait', () => {
    const r = OPS.addWorker(initialJournal(), { model: 'claude', role: 'архитектор' })
    const j = ok(r)
    expect(createdId(r)).toBe('w21')
    expect(worker(j, 'w21')).toEqual({
      id: 'w21', model: 'claude', name: 'Claude', provider: 'Anthropic', role: 'архитектор',
      color: '#d07040', status: 'wait', task: null, doneCount: 0, history: [],
    })
  })

  it('экземпляр той же модели с другой ролью — отдельный worker', () => {
    const j = ok(OPS.addWorker(initialJournal(), { model: 'claude', role: 'сисадмин' }))
    expect(j.workers.filter((w) => w.model === 'claude').map((w) => w.role)).toEqual(['исполнитель', 'сисадмин'])
  })

  it('addWorker: неизвестная модель или роль координатора — err', () => {
    errOf(OPS.addWorker(initialJournal(), { model: 'nope', role: 'архитектор' }))
    errOf(OPS.addWorker(initialJournal(), { model: 'claude', role: 'координатор' }))
  })

  it('removeWorker свободной — ок', () => {
    const j = ok(OPS.removeWorker(initialJournal(), { worker: 'w2' }))
    expect(findWorker(j, 'w2')).toBeUndefined()
  })

  it('removeWorker в статусе done — ок', () => {
    ok(OPS.removeWorker(initialJournal(), { worker: 'w6' }))
  })

  it('removeWorker занятой — err', () => {
    errOf(OPS.removeWorker(initialJournal(), { worker: 'w1' }))
    errOf(OPS.removeWorker(initialJournal(), { worker: 'w4' }))
  })

  it('removeWorker Гермеса — err', () => {
    errOf(OPS.removeWorker(initialJournal(), { worker: 'w0' }))
  })
})

describe('addTask', () => {
  it('в лоток, assignedTo = null', () => {
    const r = OPS.addTask(initialJournal(), { title: '  новая задача  ', priority: 3, kind: 'сисадмин' })
    const j = ok(r)
    expect(createdId(r)).toBe('T-21')
    expect(task(j, 'T-21')).toEqual({ id: 'T-21', title: 'новая задача', priority: 3, order: 21, assignedTo: null, kind: 'сисадмин' })
    expect(ids(trayTasks(j))).toContain('T-21')
  })

  it('kind по умолчанию null', () => {
    const j = ok(OPS.addTask(initialJournal(), { title: 'x', priority: 1 }))
    expect(task(j, 'T-21').kind).toBeNull()
  })

  it('пустое название — err', () => {
    errOf(OPS.addTask(initialJournal(), { title: '   ', priority: 2 }))
  })
})

/** Детерминированный ГПСЧ (mulberry32) для воспроизводимого прогона. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type AnyCall = { [K in OpName]: { name: K; args: OpArgs[K] } }[OpName]

function randomCall(j: Journal, rand: () => number): AnyCall {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
  const taskId = () => (j.queue.length ? pick(j.queue).id : 'T-none')
  const workerId = () => pick(j.workers).id
  const prio = () => pick([1, 2, 3] as const)
  const calls: (() => AnyCall)[] = [
    () => ({ name: 'assign', args: { task: taskId(), worker: workerId() } }),
    () => {
      const t = taskId()
      return { name: 'reassign', args: { task: t, from: findTask(j, t)?.assignedTo ?? 'w0', to: workerId() } }
    },
    () => ({ name: 'unassign', args: { task: taskId() } }),
    () => ({ name: 'setRole', args: { worker: workerId(), role: pick(ROLES) } }),
    () => ({ name: 'setPriority', args: { task: taskId(), priority: prio() } }),
    () => ({ name: 'reorder', args: { task: taskId(), before: taskId() } }),
    () => ({ name: 'complete', args: { worker: workerId() } }),
    () => ({ name: 'block', args: { worker: workerId() } }),
    () => ({ name: 'addWorker', args: { model: pick(CATALOG).model, role: pick(ROLES) } }),
    () => ({ name: 'removeWorker', args: { worker: workerId() } }),
    () => ({ name: 'addTask', args: { title: `t${Math.floor(rand() * 1000)}`, priority: prio(), kind: rand() < 0.5 ? null : pick(ROLES) } }),
  ]
  return pick(calls)()
}

describe('свойства на случайной последовательности операций', () => {
  const STEPS = 2000

  it('инвариант task != null ⇔ run|blocked (и связанные) держится после каждой операции', () => {
    const rand = rng(42)
    let j = initialJournal()
    const applied = new Set<OpName>()
    for (let step = 0; step < STEPS; step++) {
      const call = randomCall(j, rand)
      const r = applyOp(j, call.name, call.args)
      if ('msg' in r) {
        j = r.journal
        applied.add(call.name)
      }
      const v = invariantViolations(j)
      if (v.length) throw new Error(`шаг ${step}, ${call.name}(${JSON.stringify(call.args)}): ${v.join('; ')}`)
    }
    // прогон реально задел все операции
    expect([...applied].sort()).toEqual(Object.keys(OPS).sort())
  })

  it('OPS не мутируют входной журнал — ни при успехе, ни при ошибке', () => {
    const rand = rng(7)
    let j = initialJournal()
    for (let step = 0; step < STEPS; step++) {
      const call = randomCall(j, rand)
      const snapshot = structuredClone(j)
      const r = applyOp(j, call.name, call.args)
      expect(j).toEqual(snapshot)
      if ('msg' in r) {
        expect(r.journal).not.toBe(j)
        j = r.journal
      }
    }
  })
})

describe('чистота: каждая операция на фиксированных аргументах', () => {
  const cases: AnyCall[] = [
    { name: 'assign', args: { task: 'T-12', worker: 'w2' } },
    { name: 'assign', args: { task: 'T-12', worker: 'w1' } },
    { name: 'reassign', args: { task: 'T-07', from: 'w1', to: 'w2' } },
    { name: 'unassign', args: { task: 'T-07' } },
    { name: 'setRole', args: { worker: 'w2', role: 'дизайнер' } },
    { name: 'setPriority', args: { task: 'T-08', priority: 3 } },
    { name: 'reorder', args: { task: 'T-17', before: 'T-12' } },
    { name: 'reorder', args: { task: 'T-08', before: 'T-13' } },
    { name: 'complete', args: { worker: 'w1' } },
    { name: 'block', args: { worker: 'w1' } },
    { name: 'addWorker', args: { model: 'grok', role: 'сисадмин' } },
    { name: 'removeWorker', args: { worker: 'w2' } },
    { name: 'addTask', args: { title: 'x', priority: 2 } },
  ]

  it.each(cases)('$name $args', (call) => {
    const input = initialJournal()
    const snapshot = structuredClone(input)
    const j = ok(applyOp(input, call.name, call.args))
    expect(input).toEqual(snapshot)
    expect(invariantViolations(j)).toEqual([])
  })
})
