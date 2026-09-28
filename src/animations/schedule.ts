import { COORDINATOR_ID } from '../journal/catalog'
import type { Worker } from '../journal/types'

export const IDLE_SLOT_MS = 45_000
export const IDLE_POSES = ['walk', 'coffee', 'sleep'] as const
export type IdlePose = typeof IDLE_POSES[number]
export type IdleWorker = Pick<Worker, 'id' | 'status' | 'role'>

/**
 * 32-битный FNV-1a от id. Прежний `(hash*31+ch) % N` давал соседним `w1`, `w2` сдвиги,
 * отличающиеся на 1 мс, — все бездельники синхронно делали одно и то же.
 */
export function idHash(id: string): number {
  let hash = 0x811c9dc5
  for (const ch of id) hash = Math.imul(hash ^ ch.codePointAt(0)!, 0x01000193)
  return hash >>> 0
}

/** Stable offset within the complete three-activity cycle; time is milliseconds. */
export function idleOffset(id: string): number {
  return idHash(id) % (IDLE_SLOT_MS * 3)
}

export function canIdle(worker: IdleWorker, motion = true): boolean {
  return motion && worker.id !== COORDINATOR_ID && worker.role !== 'координатор'
    && (worker.status === 'wait' || worker.status === 'done')
}

export function idlePose(worker: IdleWorker, timeMs: number, motion = true): IdlePose | null {
  if (!canIdle(worker, motion) || !Number.isFinite(timeMs)) return null
  const slot = Math.floor((timeMs + idleOffset(worker.id)) / IDLE_SLOT_MS)
  return IDLE_POSES[((slot % 3) + 3) % 3]
}

export function nextIdleDelay(id: string, timeMs: number): number {
  const phase = ((timeMs + idleOffset(id)) % IDLE_SLOT_MS + IDLE_SLOT_MS) % IDLE_SLOT_MS
  return IDLE_SLOT_MS - phase
}
