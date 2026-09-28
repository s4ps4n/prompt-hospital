/** Полёт конверта после drop: длительность и кривые по docs/handoff/README.md, «Анимации». */
export const FLIGHT_MS = 450
/** left — плавно, top — с выносом вверх (дуга). */
export const FLIGHT_EASE = { left: 'cubic-bezier(.4,0,.2,1)', top: 'cubic-bezier(.3,-.6,.6,1)' } as const

export interface ScreenPoint {
  x: number
  y: number
}
