export type WorkerStatus = 'run' | 'done' | 'blocked' | 'wait'
export type Priority = 3 | 2 | 1

export type Role =
  | 'координатор'
  | 'исполнитель'
  | 'архитектор'
  | 'фулстак'
  | 'сисадмин'
  | 'дизайнер'
  | 'UX/UI'
  | 'приёмщик'
  | 'рецензент'

/** Роли, доступные для назначения (координатор закреплён за Гермесом). */
export type AssignableRole = Exclude<Role, 'координатор'>

export type WorkerId = string
export type TaskId = string

export type HairStyle = 'cap' | 'bob' | 'quiff' | 'spiky' | 'bun'
export type Accessory = 'wings' | 'glasses' | 'headset'

export interface CatalogEntry {
  model: string
  name: string
  provider: string
  hair: string
  color: string
  skin: string
  style: HairStyle
  acc?: Accessory
}

export interface Worker {
  id: WorkerId
  model: string
  name: string
  provider: string
  role: Role
  /** Журнал оркестратора (/journal) цвет не присылает — внешность берётся из каталога. */
  color?: string
  status: WorkerStatus
  task: TaskId | null
  doneCount: number
  history: string[]
}

export interface Task {
  id: TaskId
  title: string
  priority: Priority
  order: number
  assignedTo: WorkerId | null
  kind: AssignableRole | null
}

export interface OpArgs {
  assign: { task: TaskId; worker: WorkerId }
  reassign: { task: TaskId; from: WorkerId; to: WorkerId }
  unassign: { task: TaskId }
  setRole: { worker: WorkerId; role: Role }
  setPriority: { task: TaskId; priority: Priority }
  reorder: { task: TaskId; before: TaskId }
  complete: { worker: WorkerId }
  block: { worker: WorkerId }
  addWorker: { model: string; role: Role }
  removeWorker: { worker: WorkerId }
  addTask: { title: string; priority: Priority; kind?: AssignableRole | null }
}

export type OpName = keyof OpArgs

export type LogEntry = {
  [K in OpName]: { op: K; args: OpArgs[K]; at: string }
}[OpName]

export interface Journal {
  workers: Worker[]
  queue: Task[]
  log: LogEntry[]
  seq: number
}

/**
 * Результат операции. При успехе вместе с сообщением возвращается новый журнал —
 * входной журнал операция не трогает. `id` — идентификатор созданной сущности
 * (addWorker, addTask).
 */
export type OpResult =
  | { msg: string; journal: Journal; id?: string }
  | { err: string }
  | { noop: true }

export type Op<K extends OpName> = (journal: Journal, args: OpArgs[K]) => OpResult
