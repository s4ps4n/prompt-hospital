import type { Journal, Task, TaskId, Worker, WorkerId } from './types'

/** Порядок задач в очередях и лотке: приоритет по убыванию, затем order по возрастанию. */
export function compareTasks(a: Task, b: Task): number {
  return b.priority - a.priority || a.order - b.order
}

export function findTask(j: Journal, id: TaskId): Task | undefined {
  return j.queue.find((t) => t.id === id)
}

export function findWorker(j: Journal, id: WorkerId): Worker | undefined {
  return j.workers.find((w) => w.id === id)
}

/** Очередь модели — её задачи, кроме текущей, в производном порядке. */
export function workerQueue(j: Journal, workerId: WorkerId): Task[] {
  const w = findWorker(j, workerId)
  return j.queue
    .filter((t) => t.assignedTo === workerId && (!w || t.id !== w.task))
    .sort(compareTasks)
}

/** Лоток Гермеса — неназначенные задачи. */
export function trayTasks(j: Journal): Task[] {
  return j.queue.filter((t) => t.assignedTo === null).sort(compareTasks)
}

export function currentTask(j: Journal, workerId: WorkerId): Task | undefined {
  const w = findWorker(j, workerId)
  return w?.task ? findTask(j, w.task) : undefined
}

export function statusCounts(j: Journal): Record<Worker['status'], number> {
  const counts = { run: 0, done: 0, blocked: 0, wait: 0 }
  for (const w of j.workers) counts[w.status]++
  return counts
}
