import { useT } from '../i18n'
import type { Worker } from '../journal/types'
import { OUTLINE, SIGN } from '../theme/colors'
import { StatusLamp } from './Status'

export interface WorkerSignProps {
  worker: Worker
  /** Resolve the task title in the host; the sign never mutates or reads a store. */
  taskTitle?: string
  x?: number
  y?: number
  width?: number
  motion?: boolean
}
const shorten = (value: string, limit: number) => {
  const chars = Array.from(value)
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : value
}

export function WorkerSign({ worker, taskTitle, x = 0, y = 0, width = 230, motion = true }: WorkerSignProps) {
  const t = useT()
  const w = Math.max(180, width)
  const task = taskTitle ?? worker.task ?? t('sign.noTask')
  const role = t.role(worker.role)
  return <g transform={`translate(${x} ${y})`} fontFamily="Verdana, Tahoma, sans-serif" strokeLinejoin="round">
    <title>{`${worker.name} — ${role} — ${task}`}</title>
    <rect x={3} y={3} width={w} height={66} rx={4} fill={SIGN.shadow} />
    <rect width={w} height={66} rx={4} fill={SIGN.bg} stroke={OUTLINE} strokeWidth={3} />
    <text x={10} y={22} fill={OUTLINE} stroke="none" fontSize={15} fontWeight={800}>{shorten(worker.name.toUpperCase(), Math.floor((w - 40) / 15))}</text>
    <text x={10} y={39} fill={SIGN.role} stroke="none" fontSize={11} fontWeight={700}>{role}</text>
    <text x={10} y={55} fill={OUTLINE} stroke="none" fontSize={11} fontWeight={700}>{shorten(task, Math.floor((w - 20) / 11))}</text>
    <StatusLamp x={w - 17} y={17} status={worker.status} motion={motion} />
  </g>
}
