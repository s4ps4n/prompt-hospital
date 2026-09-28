import type { CSSProperties } from 'react'

export interface IdlePoint { x: number; y: number }
export interface IdleLane { from: IdlePoint; to: IdlePoint }
export type LaneStyle = CSSProperties & Record<'--x0' | '--y0' | '--x1' | '--y1', string>
export function laneStyle(lane: IdleLane): LaneStyle {
  return { '--x0': `${lane.from.x}px`, '--y0': `${lane.from.y}px`, '--x1': `${lane.to.x}px`, '--y1': `${lane.to.y}px` }
}

