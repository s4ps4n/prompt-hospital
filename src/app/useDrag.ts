import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskId } from '../journal/types'
import type { StartDrag } from '../ui/types'
import { DRAG_THRESHOLD, hitAt, type DropHit } from './dnd'

export interface DragState {
  task: TaskId
  x: number
  y: number
  over: DropHit | null
}

/**
 * Перетаскивание конвертов на pointer events. Слушатели move/up висят на window,
 * пока палец/кнопка не отпущены; до порога DRAG_THRESHOLD — это клик.
 */
export function useDrag(onDrop: (task: TaskId, hit: DropHit | null) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const start = useCallback<StartDrag>(
    (e, task, onClick) => {
      if (e.button > 0) return
      e.preventDefault()
      e.stopPropagation()
      stopRef.current?.()
      const sx = e.clientX
      const sy = e.clientY
      let active = false

      const move = (ev: PointerEvent) => {
        if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return
        active = true
        setDrag({ task, x: ev.clientX, y: ev.clientY, over: hitAt(ev.clientX, ev.clientY) })
      }
      const up = (ev: PointerEvent) => {
        stop()
        if (!active) {
          onClick?.()
          return
        }
        setDrag(null)
        onDrop(task, hitAt(ev.clientX, ev.clientY))
      }
      const cancel = () => {
        stop()
        setDrag(null)
      }
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        stopRef.current = null
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      stopRef.current = stop
    },
    [onDrop],
  )

  return { drag, start }
}
