import type { CSSProperties } from 'react'
import { PRIORITY_LABEL } from '../journal/catalog'
import type { Priority, WorkerStatus } from '../journal/types'
import { LAMP, OUTLINE, PRIORITY_COLORS, SCREEN, UI, UI_EXTRA } from '../theme/colors'

export const FONT_UI = 'Verdana, Tahoma, sans-serif'
export const FONT_MONO = "'Courier New', monospace"

export const STATUS_META: Record<WorkerStatus, { label: string; color: string; screen: string }> = {
  run: { label: 'в работе', color: LAMP.run, screen: SCREEN.run },
  blocked: { label: 'блокировано', color: LAMP.blocked, screen: SCREEN.blocked },
  wait: { label: 'ожидает', color: LAMP.wait, screen: SCREEN.wait },
  done: { label: 'выполнено', color: LAMP.done, screen: SCREEN.done },
}
export const STATUS_ORDER: readonly WorkerStatus[] = ['run', 'blocked', 'wait', 'done']

export const priorityColor = (p: Priority) => PRIORITY_COLORS[p]
export const priorityLabel = (p: Priority) => PRIORITY_LABEL[p]

/** Соседний приоритет или null, если упёрлись в границу. */
export function bumpPriority(p: Priority, delta: 1 | -1): Priority | null {
  const next = p + delta
  return next === 1 || next === 2 || next === 3 ? next : null
}

export function pluralTasks(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} задача`
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} задачи`
  return `${n} задач`
}

type ButtonVariant = 'primary' | 'paper' | 'danger' | 'ok'
const BUTTON_BG: Record<ButtonVariant, string> = {
  primary: UI.button,
  paper: UI.paper,
  danger: UI.danger,
  ok: UI_EXTRA.complete,
}

export function button(variant: ButtonVariant = 'paper', small = false): CSSProperties {
  return {
    padding: small ? '6px 9px' : '6px 10px',
    font: 'inherit',
    fontSize: small ? 11 : 12,
    fontWeight: 800,
    background: BUTTON_BG[variant],
    border: `2px solid ${OUTLINE}`,
    borderRadius: 4,
    boxShadow: `0 ${small ? 2 : 3}px 0 ${OUTLINE}`,
    cursor: 'pointer',
    color: variant === 'danger' ? '#fff' : OUTLINE,
  }
}

export const miniButton: CSSProperties = {
  width: 22,
  height: 18,
  padding: 0,
  fontSize: 9,
  background: UI.paper,
  border: `1.5px solid ${OUTLINE}`,
  borderRadius: 3,
  cursor: 'pointer',
  color: OUTLINE,
}

export const panel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: UI.paper,
  border: `3px solid ${OUTLINE}`,
  borderRadius: 6,
  color: OUTLINE,
  boxSizing: 'border-box',
}

export const sectionLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: UI_EXTRA.muted,
}

export const field: CSSProperties = {
  padding: '6px 8px',
  font: 'inherit',
  fontSize: 12,
  border: `2px solid ${OUTLINE}`,
  borderRadius: 4,
  background: UI.paperLight,
  color: OUTLINE,
  minWidth: 0,
}

export const taskRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '7px 8px',
  background: UI.paperLight,
  border: `2px solid ${OUTLINE}`,
  borderRadius: 4,
}

export function flag(p: Priority, height = 24): CSSProperties {
  return { flex: '0 0 auto', width: 10, height, background: priorityColor(p), border: `2px solid ${OUTLINE}` }
}
