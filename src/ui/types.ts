import type { PointerEvent } from 'react'
import type { OpArgs, OpName, OpResult, TaskId } from '../journal/types'

/** Запуск операции журнала (store.run + вывод сообщения). */
export type RunOp = <K extends OpName>(name: K, args: OpArgs[K]) => OpResult
/** Сухой прогон операции (store.check). */
export type CheckOp = RunOp

/** Начало перетаскивания конверта; без движения дальше порога — вызывается onClick. */
export type StartDrag = (e: PointerEvent<Element>, task: TaskId, onClick?: () => void) => void

/** Значение data-drop у лотка и кабинета Гермеса. */
export const TRAY_DROP = 'queue'
