import { COORDINATOR_ID, findCatalogEntry } from './catalog'
import type { Journal, Role, Worker } from './types'

function makeWorker(id: string, model: string, role: Role, extra: Partial<Worker> = {}): Worker {
  const c = findCatalogEntry(model)
  if (!c) throw new Error(`Нет модели в каталоге: ${model}`)
  return {
    id,
    model: c.model,
    name: c.name,
    provider: c.provider,
    role,
    color: c.color,
    status: 'wait',
    task: null,
    doneCount: 0,
    history: [],
    ...extra,
  }
}

/** Стартовый состав офиса — как в референсе дизайнера. */
export function initialJournal(): Journal {
  return {
    workers: [
      makeWorker(COORDINATOR_ID, 'deepseek', 'координатор', { name: 'Гермес' }),
      makeWorker('w1', 'claude', 'исполнитель', {
        status: 'run',
        task: 'T-07',
        doneCount: 3,
        history: ['обновить README движка', 'поправить линтер', 'миграция prisma'],
      }),
      makeWorker('w2', 'gpt5', 'архитектор'),
      makeWorker('w3', 'gemini', 'фулстак'),
      makeWorker('w4', 'qwen', 'сисадмин', {
        status: 'blocked',
        task: 'T-09',
        doneCount: 1,
        history: ['ротация логов'],
      }),
      makeWorker('w5', 'mistral', 'дизайнер'),
      makeWorker('w6', 'grok', 'UX/UI', {
        status: 'done',
        doneCount: 2,
        history: ['аудит формы оплаты', 'прототип онбординга'],
      }),
      makeWorker('w7', 'llama', 'приёмщик'),
    ],
    queue: [
      { id: 'T-07', title: 'рефакторинг роутера admin-api', priority: 2, order: 1, assignedTo: 'w1', kind: null },
      { id: 'T-08', title: 'тесты корзины', priority: 1, order: 2, assignedTo: 'w1', kind: null },
      { id: 'T-09', title: 'обновить сертификаты', priority: 3, order: 3, assignedTo: 'w4', kind: 'сисадмин' },
      { id: 'T-12', title: 'починить смоук karkas', priority: 3, order: 4, assignedTo: null, kind: null },
      { id: 'T-13', title: 'схема БД для заказов', priority: 2, order: 5, assignedTo: null, kind: 'архитектор' },
      { id: 'T-14', title: 'иконки для дашборда', priority: 2, order: 6, assignedTo: null, kind: 'дизайнер' },
      { id: 'T-16', title: 'форма входа: адаптив', priority: 2, order: 7, assignedTo: null, kind: 'UX/UI' },
      { id: 'T-15', title: 'проверить релиз 2.4', priority: 1, order: 8, assignedTo: null, kind: 'приёмщик' },
      { id: 'T-17', title: 'API поиска товаров', priority: 1, order: 9, assignedTo: null, kind: 'фулстак' },
    ],
    log: [],
    seq: 20,
  }
}
