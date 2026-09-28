import { useEffect, useState } from 'react'
import { canIdle, nextIdleDelay, type IdleWorker } from './schedule'

/**
 * Общие часы сцены для IdleDirector: один timeout до ближайшей границы занятия
 * среди бездельников. `fixed` — детерминированное время (тесты, снимки); без
 * бездельников или при motion=false таймер не заводится.
 */
export function useIdleClock(workers: readonly IdleWorker[], motion = true, fixed?: number): number {
  const [now, setNow] = useState(() => Date.now())
  const idle = workers.filter((w) => canIdle(w, motion)).map((w) => w.id).join(' ')
  useEffect(() => {
    if (fixed !== undefined || !idle) return
    const ids = idle.split(' ')
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const t = Date.now()
      setNow(t)
      timer = setTimeout(tick, Math.min(...ids.map((id) => nextIdleDelay(id, t))))
    }
    tick()
    return () => clearTimeout(timer)
  }, [idle, fixed])
  return fixed ?? now
}
