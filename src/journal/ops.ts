import {
  COORDINATOR_ID,
  COORDINATOR_ROLE,
  PRIORITY_LABEL,
  findCatalogEntry,
  isAssignableRole,
} from './catalog'
import { compareTasks, findTask, findWorker, workerQueue } from './selectors'
import type { Journal, Op, OpArgs, OpName, OpResult, Priority, Task, Worker } from './types'

/**
 * Мутатор работает над черновиком (копией журнала). Наружу он не экспортируется:
 * публичные OPS оборачивают его в clone → mutate, поэтому входной журнал не меняется.
 */
type DraftResult = { msg: string; id?: string } | { err: string } | { noop: true }
type Mutator<K extends OpName> = (draft: Journal, args: OpArgs[K]) => DraftResult

const NOOP = { noop: true } as const

function isPriority(p: number): p is Priority {
  return p === 1 || p === 2 || p === 3
}

/**
 * Снимает задачу с модели. Если это была текущая задача — модель берёт следующую
 * из очереди (статус run) или освобождается (wait).
 */
function detach(j: Journal, t: Task): void {
  if (!t.assignedTo) return
  const w = findWorker(j, t.assignedTo)
  t.assignedTo = null
  if (w && w.task === t.id) takeNext(j, w, 'wait')
}

function takeNext(j: Journal, w: Worker, idleStatus: 'wait' | 'done'): Task | undefined {
  const next = workerQueue(j, w.id)[0]
  w.task = next ? next.id : null
  w.status = next ? 'run' : idleStatus
  return next
}

function renumber(j: Journal): void {
  j.queue
    .slice()
    .sort(compareTasks)
    .forEach((t, i) => {
      t.order = i + 1
    })
}

function kindMismatch(t: Task, w: Worker): string | null {
  if (!t.kind || t.kind === w.role) return null
  return `Нельзя: «${t.title}» только для роли «${t.kind}», а у ${w.name} роль «${w.role}».`
}

/** Ставит задачу модели: свободной — текущей, занятой — в очередь. */
function placeOnWorker(j: Journal, t: Task, w: Worker): void {
  detach(j, t)
  t.assignedTo = w.id
  if (!w.task) {
    w.task = t.id
    w.status = 'run'
  }
}

const assign: Mutator<'assign'> = (j, a) => {
  const t = findTask(j, a.task)
  const w = findWorker(j, a.worker)
  if (!t || !w) return { err: 'Нет такой задачи или модели' }
  if (w.role === COORDINATOR_ROLE) return unassign(j, { task: a.task })
  if (t.assignedTo === w.id) return NOOP
  const mismatch = kindMismatch(t, w)
  if (mismatch) return { err: mismatch }

  const wasFree = !w.task
  t.order = ++j.seq
  placeOnWorker(j, t, w)
  if (wasFree) return { msg: `${t.id} → ${w.name} (${w.role}): в работе` }
  const position = workerQueue(j, w.id).findIndex((x) => x.id === t.id) + 2
  return { msg: `${t.id} встала в очередь к ${w.name} — №${position}, текущая задача продолжается` }
}

const reassign: Mutator<'reassign'> = (j, a) => {
  const t = findTask(j, a.task)
  if (!t) return { err: 'Нет задачи' }
  if (t.assignedTo !== a.from) return { err: `${t.id} не назначена этой модели` }
  return assign(j, { task: a.task, worker: a.to })
}

const unassign: Mutator<'unassign'> = (j, a) => {
  const t = findTask(j, a.task)
  if (!t) return { err: 'Нет задачи' }
  if (!t.assignedTo) return NOOP
  detach(j, t)
  t.order = ++j.seq
  return { msg: `${t.id} вернулась в лоток Гермеса` }
}

const setRole: Mutator<'setRole'> = (j, a) => {
  const w = findWorker(j, a.worker)
  if (!w) return { err: 'Нет модели' }
  if (w.role === COORDINATOR_ROLE) return { err: 'Роль координатора закреплена за Гермесом' }
  if (w.task) return { err: `Нельзя сменить роль: ${w.name} в работе. Сначала заверши или сними задачу.` }
  if (!isAssignableRole(a.role)) return { err: 'Нет такой роли' }
  if (w.role === a.role) return NOOP
  w.role = a.role
  return { msg: `${w.name}: роль «${a.role}»` }
}

const setPriority: Mutator<'setPriority'> = (j, a) => {
  const t = findTask(j, a.task)
  if (!t) return { err: 'Нет задачи' }
  if (!isPriority(a.priority)) return { err: 'Приоритет должен быть 1, 2 или 3' }
  if (t.priority === a.priority) return NOOP
  t.priority = a.priority
  const w = t.assignedTo ? findWorker(j, t.assignedTo) : undefined
  return { msg: `${t.id}: приоритет ${PRIORITY_LABEL[a.priority]}${w ? `, очередь ${w.name} пересортирована` : ''}` }
}

/**
 * Задача встаёт перед целью — в том же контейнере (лоток или очередь модели),
 * берёт приоритет цели. Перед текущей задачей модели встать нельзя.
 */
const reorder: Mutator<'reorder'> = (j, a) => {
  const t = findTask(j, a.task)
  const b = findTask(j, a.before)
  if (!t || !b) return { err: 'Нет задачи' }
  if (t.id === b.id) return NOOP
  const target = b.assignedTo ? findWorker(j, b.assignedTo) : undefined
  if (target && target.task === b.id) {
    return { err: `${b.id} уже в работе у ${target.name} — перед текущей задачей встать нельзя` }
  }
  if (target && target.task === t.id) {
    return { err: `${t.id} — текущая задача ${target.name}, её нельзя переставить в собственную очередь` }
  }
  if (target) {
    const mismatch = kindMismatch(t, target)
    if (mismatch) return { err: mismatch }
  }

  if (t.assignedTo !== b.assignedTo) {
    if (target) placeOnWorker(j, t, target)
    else detach(j, t)
  }
  t.priority = b.priority
  t.order = b.order - 0.5
  renumber(j)
  return { msg: `${t.id} встала перед ${b.id}, приоритет ${PRIORITY_LABEL[t.priority]}` }
}

const complete: Mutator<'complete'> = (j, a) => {
  const w = findWorker(j, a.worker)
  const t = w?.task ? findTask(j, w.task) : undefined
  if (!w || !t) return { err: 'Нет текущей задачи' }
  j.queue = j.queue.filter((x) => x.id !== t.id)
  w.history = [t.title, ...w.history].slice(0, 6)
  w.doneCount++
  w.task = null
  const next = takeNext(j, w, 'done')
  return { msg: `${w.name} завершил «${t.title}»${next ? `, берёт ${next.id}` : ''}` }
}

/** Блок — переключатель: blocked ⇄ run. Задача остаётся текущей. */
const block: Mutator<'block'> = (j, a) => {
  const w = findWorker(j, a.worker)
  if (!w || !w.task) return { err: 'Блокировать можно только задачу в работе' }
  w.status = w.status === 'blocked' ? 'run' : 'blocked'
  return { msg: `${w.name}: ${w.status === 'blocked' ? 'блокировано' : 'снова в работе'}` }
}

const addWorker: Mutator<'addWorker'> = (j, a) => {
  const c = findCatalogEntry(a.model)
  if (!c) return { err: 'Нет модели в каталоге' }
  if (!isAssignableRole(a.role)) return { err: 'Выберите роль' }
  const id = `w${++j.seq}`
  j.workers.push({
    id,
    model: c.model,
    name: c.name,
    provider: c.provider,
    role: a.role,
    color: c.color,
    status: 'wait',
    task: null,
    doneCount: 0,
    history: [],
  })
  return { msg: `В офисе новая комната: ${c.name} — ${a.role}`, id }
}

const removeWorker: Mutator<'removeWorker'> = (j, a) => {
  const w = findWorker(j, a.worker)
  if (!w) return { err: 'Нет модели' }
  if (w.id === COORDINATOR_ID) return { err: 'Гермеса убрать нельзя' }
  if (w.task || workerQueue(j, w.id).length) {
    return { err: `Нельзя убрать ${w.name}: у модели есть задачи. Сначала заверши или верни их в лоток.` }
  }
  j.workers = j.workers.filter((x) => x.id !== w.id)
  return { msg: `${w.name} (${w.role}) покинул офис` }
}

const addTask: Mutator<'addTask'> = (j, a) => {
  const title = a.title.trim()
  if (!title) return { err: 'Введите название задачи' }
  if (!isPriority(a.priority)) return { err: 'Приоритет должен быть 1, 2 или 3' }
  const kind = a.kind ?? null
  if (kind !== null && !isAssignableRole(kind)) return { err: 'Нет такой роли' }
  const id = `T-${++j.seq}`
  j.queue.push({ id, title, priority: a.priority, order: j.seq, assignedTo: null, kind })
  return { msg: `${id} добавлена в лоток`, id }
}

function pure<K extends OpName>(mutate: Mutator<K>): Op<K> {
  return (journal, args): OpResult => {
    const draft = structuredClone(journal)
    const r = mutate(draft, args)
    return 'msg' in r ? { ...r, journal: draft } : r
  }
}

/**
 * Все мутации журнала. Каждая операция — чистая функция:
 * вход не меняется, при успехе в результате лежит новый журнал.
 */
export const OPS: { readonly [K in OpName]: Op<K> } = {
  assign: pure(assign),
  reassign: pure(reassign),
  unassign: pure(unassign),
  setRole: pure(setRole),
  setPriority: pure(setPriority),
  reorder: pure(reorder),
  complete: pure(complete),
  block: pure(block),
  addWorker: pure(addWorker),
  removeWorker: pure(removeWorker),
  addTask: pure(addTask),
}

export function applyOp<K extends OpName>(journal: Journal, name: K, args: OpArgs[K]): OpResult {
  const op: Op<K> = OPS[name]
  return op(journal, args)
}
