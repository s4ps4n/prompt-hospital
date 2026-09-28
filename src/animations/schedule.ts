import { COORDINATOR_ID } from '../journal/catalog'
import type { Worker } from '../journal/types'

export const IDLE_SLOT_MS = 45_000
export const IDLE_POSES = ['walk', 'coffee', 'sleep'] as const
export type IdlePose = typeof IDLE_POSES[number]
export type IdleWorker = Pick<Worker, 'id' | 'status' | 'role'>

/** Stable offset within the complete three-activity cycle; time is milliseconds. */
export function idleOffset(id: string): number {
  return Array.from(id).reduce((hash, ch) => (hash * 31 + ch.codePointAt(0)!) % (IDLE_SLOT_MS * 3), 0)
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
