// Журнал идемпотентности (ТЗ v3 §6) — единственное хранилище сервиса.
// Запись: HMAC(operationId) → { invoiceId | null, result, at }. Без сумм, ИНН, назначений.
// operationId хранится отпечатком: для идемпотентности достаточно, а в файле его нет.
// Срок хранения — 90 дней, старше — удаляется.
// fp — HMAC(юрлицо|ИНН|сумма): страховка на случай, если ключ операции в выписке не совпадёт с ключом вебхука
// (тот же платёж под другим ключом не закроет второй счёт). Сумма и ИНН из отпечатка без секрета не восстановимы.

import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** closed — закрыт; observed — уровень 1 в режиме «только пометки»; review — уровень 2; unresolved — уровень 3. */
export type JournalResult = 'closed' | 'observed' | 'review' | 'unresolved'

export type JournalEntry = { invoiceId: number | null; result: JournalResult; at: string; fp?: string }

export interface Journal {
  /** Короткий отпечаток для связи строк лога — не раскрывает operationId. */
  ref(operationId: string): string
  has(operationId: string): boolean
  /** Был ли за последние withinMs платёж с тем же отпечатком (под любым operationId). */
  seen(fingerprint: string, withinMs: number): boolean
  record(operationId: string, result: JournalResult, invoiceId: number | null, fingerprint?: string | null): void
}

const DAY = 86_400_000
export const JOURNAL_TTL_DAYS = 90

/** Секунды без миллисекунд — в файле журнала нет ничего, похожего на сумму. */
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z'

export class FileJournal implements Journal {
  private map: Record<string, JournalEntry> = {}
  private path: string | null
  private secret: string
  private now: () => number

  constructor(opts: { path: string | null; secret: string; now?: () => number }) {
    if (!opts.secret) throw new Error('journal secret required')
    this.path = opts.path
    this.secret = opts.secret
    this.now = opts.now ?? Date.now
    if (this.path && existsSync(this.path)) this.map = JSON.parse(readFileSync(this.path, 'utf8'))
    if (this.purge()) this.save()
  }

  private hash(key: string): string {
    return createHmac('sha256', this.secret).update(key).digest('hex')
  }

  private purge(): boolean {
    const cutoff = this.now() - JOURNAL_TTL_DAYS * DAY
    let removed = false
    for (const [h, e] of Object.entries(this.map)) {
      if (!(Date.parse(e.at) >= cutoff)) {
        delete this.map[h]
        removed = true
      }
    }
    return removed
  }

  private save(): void {
    if (!this.path) return
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.map), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  ref(operationId: string): string {
    return this.hash(operationId).slice(0, 12)
  }

  has(operationId: string): boolean {
    return this.hash(operationId) in this.map
  }

  seen(fingerprint: string, withinMs: number): boolean {
    const fp = this.hash(`fp:${fingerprint}`)
    const cutoff = this.now() - withinMs
    return Object.values(this.map).some((e) => e.fp === fp && Date.parse(e.at) >= cutoff)
  }

  record(operationId: string, result: JournalResult, invoiceId: number | null, fingerprint?: string | null): void {
    this.purge()
    const e: JournalEntry = { invoiceId, result, at: stamp(this.now()) }
    if (fingerprint) e.fp = this.hash(`fp:${fingerprint}`)
    this.map[this.hash(operationId)] = e
    this.save()
  }

  /** Для тестов и диагностики. */
  size(): number {
    return Object.keys(this.map).length
  }
}
