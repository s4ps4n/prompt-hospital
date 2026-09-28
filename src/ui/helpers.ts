import { CATALOG } from '../journal/catalog'
import { compareTasks } from '../journal/selectors'
import type { CatalogEntry, Journal, Worker, WorkerStatus } from '../journal/types'

/** Модель из каталога в виде worker'а — для превью в модалке. */
export function previewWorker(entry: CatalogEntry, status: WorkerStatus = 'wait'): Worker {
  return {
    id: `preview-${entry.model}`,
    model: entry.model,
    name: entry.name,
    provider: entry.provider,
    role: 'исполнитель',
    color: entry.color,
    status,
    task: null,
    doneCount: 0,
    history: [],
  }
}

/** Дамп журнала в формате прототипа: модели, каталог, задачи, последние операции. */
export function journalDump(j: Journal): string {
  return JSON.stringify(
    {
      workers: j.workers,
      catalog: CATALOG.map((c) => ({ model: c.model, name: c.name, provider: c.provider, color: c.color })),
      queue: j.queue.slice().sort(compareTasks),
      operations: j.log.slice(0, 20),
    },
    null,
    2,
  )
}
