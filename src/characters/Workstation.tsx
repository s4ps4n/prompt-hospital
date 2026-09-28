import { FACE_SHADE, FURNITURE, OUTLINE, OUTLINE_WIDTH, shade } from '../theme/colors'
import { StatusScreen, type StatusProps } from './Status'

/** Local seat origin matches Character; keyboard lies under the two hands. */
export function Workstation({ status, motion = true, x = 0, y = 0 }: StatusProps) {
  return <g transform={`translate(${x} ${y})`} stroke={OUTLINE} strokeWidth={OUTLINE_WIDTH} strokeLinejoin="round">
    <path d="M-62,0 L35,17 L35,39 L-62,22 Z" fill={shade(FURNITURE.desk, FACE_SHADE.left)} />
    <path d="M-62,0 L-43,-12 L35,2 L35,17 Z" fill={FURNITURE.desk} />
    <path d="M-42,-4 L-12,1 L-3,11 L-34,6 Z" fill={FURNITURE.keyboard} />
    <path d="M-36,-1 L-14,3 M-32,3 L-10,7" fill="none" strokeWidth={1} />
    <path d="M-60,-7 L-40,-3 L-32,-7 L-52,-11 Z" fill={FURNITURE.mousepad} />
    <path d="M-64,-39 L-55,-44 L-27,-38 L-27,-9 L-36,-4 L-64,-10 Z" fill={shade(FURNITURE.crt, FACE_SHADE.right)} />
    <path d="M-64,-39 L-36,-33 L-36,-4 L-64,-10 Z" fill={FURNITURE.crt} />
    <StatusScreen status={status} motion={motion} x={-61} y={-35} />
  </g>
}
