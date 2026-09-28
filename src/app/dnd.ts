import type { ScreenPoint } from '../animations/flight'
import { findTask } from '../journal/selectors'
import type { Journal, OpArgs, TaskId } from '../journal/types'
import { TRAY_DROP } from '../ui/types'

/** Смещение курсора, после которого нажатие считается перетаскиванием, а не кликом. */
export const DRAG_THRESHOLD = 5

/** Что под курсором: ближайший [data-drop] и [data-task-slot]. */
export interface DropHit {
  drop: string | null
  slot: TaskId | null
}

export function hitAt(x: number, y: number, doc: Document = document): DropHit | null {
  const el = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null
  if (!el) return null
  return {
    drop: el.closest('[data-drop]')?.getAttribute('data-drop') ?? null,
    slot: el.closest('[data-task-slot]')?.getAttribute('data-task-slot') ?? null,
  }
}

const attr = (value: string) => value.replace(/["\\]/g, '\\$&')

/**
 * Куда летит конверт после drop: центр конверта-слота, иначе центр цели
 * (первый [data-drop] в документе: лоток раньше кабинета Гермеса, комната раньше карточки).
 * Без видимой цели — остаётся в точке drop.
 */
export function flightTarget(hit: DropHit, at: ScreenPoint, doc: Document = document): ScreenPoint {
  const el =
    (hit.slot && doc.querySelector(`[data-task-slot="${attr(hit.slot)}"]`)) ||
    (hit.drop && doc.querySelector(`[data-drop="${attr(hit.drop)}"]`))
  if (!el) return at
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return at
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

type DropOpName = 'assign' | 'reassign' | 'unassign' | 'reorder'
export type DropOp = { [K in DropOpName]: { name: K; args: OpArgs[K] } }[DropOpName]

export type DropDecision = { kind: 'op'; op: DropOp } | { kind: 'miss' } | { kind: 'none' }

/**
 * Какую операцию выполнить после drop'а. Решает только «куда», а допустимость
 * (роль, текущая задача) проверяет сама операция журнала.
 */
export function decideDrop(j: Journal, taskId: TaskId, hit: DropHit | null): DropDecision {
  const t = findTask(j, taskId)
  if (!t) return { kind: 'none' }
  if (!hit?.drop) return { kind: 'miss' }

  // Конверт в лотке или в очереди модели: встать перед ним (владельца и приоритет решает reorder).
  if (hit.slot) return hit.slot === t.id ? { kind: 'none' } : { kind: 'op', op: { name: 'reorder', args: { task: t.id, before: hit.slot } } }

  if (hit.drop === TRAY_DROP) {
    if (t.assignedTo) return { kind: 'op', op: { name: 'unassign', args: { task: t.id } } }
    return { kind: 'none' }
  }

  if (t.assignedTo === hit.drop) return { kind: 'none' }
  if (t.assignedTo) {
    return { kind: 'op', op: { name: 'reassign', args: { task: t.id, from: t.assignedTo, to: hit.drop } } }
  }
  return { kind: 'op', op: { name: 'assign', args: { task: t.id, worker: hit.drop } } }
}
