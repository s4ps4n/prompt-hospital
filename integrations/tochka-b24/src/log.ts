// Журнал без платёжных данных. Типом разрешены только служебные поля:
// ни сумм, ни номеров счетов/р.с., ни назначений, ни ИНН, ни текстов ошибок
// (в сообщениях fetch бывает URL входящего вебхука Б24 с секретом).

export type LogFields = {
  /** Короткий HMAC-отпечаток платежа — чтобы связать строки лога, не раскрывая id. */
  ref?: string
  level?: 1 | 2 | 3
  reason?: string
  candidates?: number
  status?: string
  error?: string
}

export type Logger = (event: string, fields?: LogFields) => void

const ALLOWED = new Set(['ref', 'level', 'reason', 'candidates', 'status', 'error'])

export function makeLogger(write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  return (event, fields = {}) => {
    const safe: Record<string, unknown> = { t: new Date().toISOString(), event }
    for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k) && v !== undefined) safe[k] = v
    write(JSON.stringify(safe))
  }
}

/** Для ошибок — только имя класса/код, без message. */
export function errCode(e: unknown): string {
  if (e instanceof B24Error) return `b24:${e.code}`
  if (e instanceof TochkaError) return `tochka:${e.code}`
  if (e instanceof Error) return e.name
  return 'unknown'
}

export class B24Error extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'B24Error'
    this.code = code
  }
}

export class TochkaError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'TochkaError'
    this.code = code
  }
}
