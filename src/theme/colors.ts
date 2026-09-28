import type { Priority, Role, WorkerStatus } from '../journal/types'

/** Палитра Prompt Hospital — по docs/handoff/README.md, раздел «Визуальная система». */

/** Контур всех объектов: 2px в единицах сцены, round joins. */
export const OUTLINE = '#241a0c'
export const OUTLINE_WIDTH = 2

/** Множители граней коробки: верх = цвет, левая (+y) ×0.84, правая (+x) ×0.68. */
export const FACE_SHADE = { left: 0.84, right: 0.68 } as const

export const ROLE_COLORS: Record<Role, string> = {
  координатор: '#cf5d5d',
  исполнитель: '#e89b98',
  архитектор: '#a99ae0',
  фулстак: '#88b4ea',
  сисадмин: '#8fd0a0',
  дизайнер: '#f0c07a',
  'UX/UI': '#e6a2d2',
  приёмщик: '#c9b98e',
}
export const ROLE_FALLBACK = '#cccccc'

/** Панель на стене комнаты — цвет ковра ×0.8 (стена вдоль y) / ×0.9 (стена вдоль x). */
export const PANEL_SHADE = { alongY: 0.8, alongX: 0.9 } as const

export const WALL = { face: '#f3ead2', top: '#d9c79c' } as const

export const OUTER_WALL = {
  cap: '#c9784a',
  inner: '#efe2c6',
  brickX: { brick: '#b5623a', seam: '#e2b48a' },
  brickY: { brick: '#a9573a', seam: '#dba882' },
} as const

export const CORRIDOR_TILES = { light: '#d3d3de', dark: '#babbcc' } as const
export const GRASS = { light: '#4dae3e', dark: '#44a236' } as const
export const HEDGE = '#3e9a3a'

export const FURNITURE = {
  desk: '#b9773f',
  chair: '#3f63d6',
  crt: '#e2d9bf',
  mousepad: '#8f8a7c',
  keyboard: '#d9d5c9',
  window: '#92d6f4',
  frame: '#fffdf5',
  radiator: '#eef1f4',
  bookshelf: '#8a5a30',
  books: ['#d04a3a', '#3a6ad0', '#e8b840', '#3a9a5a', '#8a4ac0'],
  coffeeMachine: '#5a6470',
  coffeeButton: '#e0402e',
  cup: '#ffffff',
  paper: '#f4efe2',
  bench: '#5cc070',
  cooler: '#e6eef4',
  water: '#8fd0f4',
  pot: '#c8703c',
  leaves: ['#3f9a3a', '#56b848', '#6cc85a'],
} as const

/** Экран ЭЛТ по статусу модели. */
export const SCREEN: Record<WorkerStatus, string> = {
  run: '#4cb8ff',
  done: '#52e07a',
  blocked: '#8c1616',
  wait: '#1d2532',
}

/** Лампочка на вывеске по статусу. */
export const LAMP: Record<WorkerStatus, string> = {
  run: '#2f86e0',
  done: '#2f9e4f',
  blocked: '#c8322a',
  wait: '#77705f',
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  3: '#e0402e',
  2: '#f2c230',
  1: '#a3a3a3',
}

export const SIGN = { bg: '#f7d23a', role: '#6a4a10', shadow: 'rgba(36,26,12,.45)' } as const

export const CHARACTER = {
  white: '#ffffff',
  blush: '#f28a86',
  mouth: '#8a2a1a',
  headset: '#3a3a44',
  lenses: 'rgba(255,255,255,.2)',
} as const

export const UI = {
  paper: '#f6edd6',
  paperLight: '#fffaf0',
  button: '#f7d23a',
  danger: '#e0584a',
  wood: '#6b4220',
  console: '#120c05',
  ok: '#8fe07a',
  error: '#ff7a6a',
} as const

/** Дополнительные цвета UI из прототипа: подписи, подсветки, конверты, фоны. */
export const UI_EXTRA = {
  muted: '#7a6a4e',
  dashed: '#c9b58a',
  history: '#4a3a22',
  locked: '#e6dcc2',
  selected: '#ffe978',
  complete: '#6fd08a',
  highlight: '#e0402e',
  envelope: '#f3e6c4',
  envelopeCurrent: '#ffffff',
  ghost: '#fdf6e3',
  lawn: '#45a236',
  json: '#bfe6a0',
  hint: '#c9b58a',
  woodLight: '#8a5a30',
  overlay: 'rgba(18,12,5,.6)',
  backdrop: '#2b2117',
} as const

/** Умножает каналы #rrggbb на `f` с отсечкой в [0, 255]. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  const rgb = (cl((n >> 16) & 255) << 16) | (cl((n >> 8) & 255) << 8) | cl(n & 255)
  return '#' + ((1 << 24) | rgb).toString(16).slice(1)
}

/** Относительная яркость по WCAG 2.x. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Более контрастный из белого и тёмного (контурного) текста на фоне `bg`. */
export function readableText(bg: string): string {
  return contrastRatio(bg, '#ffffff') > contrastRatio(bg, OUTLINE) ? '#ffffff' : OUTLINE
}

export function roleColor(role: string): string {
  return (ROLE_COLORS as Record<string, string | undefined>)[role] ?? ROLE_FALLBACK
}
