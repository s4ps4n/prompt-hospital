import { describe, expect, it } from 'vitest'
import { initialJournal } from './initial'
import { OPS } from './ops'
import { taskCounts } from './selectors'
import type { Journal, Task, Worker } from './types'

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, priority: 2, order: 1, assignedTo: null, kind: null, ...extra,
})
const worker = (id: string, extra: Partial<Worker> = {}): Worker => ({
  id, model: 'claude', name: id, provider: 'Anthropic', role: 'исполнитель',
  status: 'wait', task: null, doneCount: 0, history: [], ...extra,
})
const journal = (workers: Worker[], queue: Task[]): Journal => ({ workers, queue, log: [], seq: 0 })

describe('taskCounts — счётчики шапки считают задачи, а не модели', () => {
  it('3 задачи в очереди и 2 модели в статусе done: ожидают 3, модели в счёт не идут', () => {
    const j = journal(
      [worker('w1', { status: 'done', doneCount: 4 }), worker('w2', { status: 'done', doneCount: 1 })],
      [task('T-1'), task('T-2'), task('T-3')],
    )
    expect(taskCounts(j)).toEqual({ run: 0, blocked: 0, wait: 3 })
  })

  it('модели без задач (wait) не дают ни одного «ожидает»', () => {
    const j = journal([worker('w1'), worker('w2'), worker('w3')], [])
    expect(taskCounts(j)).toEqual({ run: 0, blocked: 0, wait: 0 })
  })

  it('в работе — текущая задача модели; задача в личной очереди модели — ожидает', () => {
    const j = journal(
      [worker('w1', { status: 'run', task: 'T-1' })],
      [task('T-1', { assignedTo: 'w1' }), task('T-2', { assignedTo: 'w1' }), task('T-3')],
    )
    expect(taskCounts(j)).toEqual({ run: 1, blocked: 0, wait: 2 })
  })

  it('заблокировано — текущая задача заблокированной модели и задача, снятая с ротации (blocked)', () => {
    const j = journal(
      [worker('w1', { status: 'blocked', task: 'T-1' })],
      [task('T-1', { assignedTo: 'w1' }), task('T-2', { blocked: true }), task('T-3', { blocked: false })],
    )
    expect(taskCounts(j)).toEqual({ run: 0, blocked: 2, wait: 1 })
  })

  it('стартовый журнал: 1 в работе, 1 заблокирована, 7 ожидают (лоток 6 + очередь Claude 1)', () => {
    expect(taskCounts(initialJournal())).toEqual({ run: 1, blocked: 1, wait: 7 })
  })

  it('complete убирает задачу из журнала: в работе становится следующая, «ожидают» уменьшается', () => {
    const r = OPS.complete(initialJournal(), { worker: 'w1' })
    if (!('msg' in r)) throw new Error(JSON.stringify(r))
    expect(taskCounts(r.journal)).toEqual({ run: 1, blocked: 1, wait: 6 })
  })
})
