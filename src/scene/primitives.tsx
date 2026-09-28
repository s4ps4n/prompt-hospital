import { FACE_SHADE, FURNITURE, OUTLINE, OUTLINE_WIDTH, shade } from '../theme/colors'
import { P, boxFaces, pts, type Pt } from './iso'

interface PolyProps {
  points: readonly Pt[]
  fill: string
  strokeWidth?: number
  opacity?: number
}

export function Poly({ points, fill, strokeWidth = OUTLINE_WIDTH, opacity }: PolyProps) {
  return (
    <polygon
      points={pts(points)}
      fill={fill}
      stroke={strokeWidth > 0 ? OUTLINE : 'none'}
      strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
      strokeLinejoin="round"
      opacity={opacity}
    />
  )
}

interface BoxProps {
  x: number
  y: number
  z?: number
  w: number
  d: number
  h: number
  color: string
  /** Переопределения граней (цвет или url(#pattern)). */
  top?: string
  left?: string
  right?: string
}

/** Коробка: верх = цвет, левая (+y) ×0.84, правая (+x) ×0.68. */
export function Box({ x, y, z = 0, w, d, h, color, top, left, right }: BoxProps) {
  const f = boxFaces(x, y, z, w, d, h)
  return (
    <g>
      <Poly points={f.left} fill={left ?? shade(color, FACE_SHADE.left)} />
      <Poly points={f.right} fill={right ?? shade(color, FACE_SHADE.right)} />
      <Poly points={f.top} fill={top ?? color} />
    </g>
  )
}

/** Растение в горшке 16×16 с углом в (x, y). */
export function Plant({ x, y }: { x: number; y: number }) {
  const [cx, cy] = P(x + 8, y + 8, 15)
  const [dark, mid, light] = FURNITURE.leaves
  const leaves: [number, number, number, string][] = [
    [-9, -7, 8, dark],
    [9, -8, 8, dark],
    [0, -13, 9, mid],
    [-6, -23, 7, mid],
    [7, -21, 7, light],
    [0, -31, 6, light],
  ]
  return (
    <g>
      <Box x={x} y={y} w={16} d={16} h={15} color={FURNITURE.pot} />
      {leaves.map(([dx, dy, r, fill], k) => (
        <circle key={k} cx={cx + dx} cy={cy + dy} r={r} fill={fill} stroke={OUTLINE} strokeWidth={OUTLINE_WIDTH} />
      ))}
    </g>
  )
}
