import { useCallback, useEffect, useRef, useState } from 'react'
import { FLIGHT_MS, type ScreenPoint } from '../animations/flight'
import type { TaskId } from '../journal/types'

export interface Flight {
  id: number
  task: TaskId
  from: ScreenPoint
  to: ScreenPoint
}

/**
 * Конверты в полёте после drop. `land` вызывается по приземлении (через FLIGHT_MS),
 * до этого журнал не меняется. Несколько полётов могут идти одновременно.
 */
export function useFlights() {
  const [flights, setFlights] = useState<Flight[]>([])
  const seq = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])

  const launch = useCallback((task: TaskId, from: ScreenPoint, to: ScreenPoint, land: () => void) => {
    const id = ++seq.current
    setFlights((f) => [...f, { id, task, from, to }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setFlights((f) => f.filter((x) => x.id !== id))
      land()
    }, FLIGHT_MS)
    timers.current.add(timer)
  }, [])

  return { flights, launch }
}
