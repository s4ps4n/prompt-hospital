import { useCallback, useRef, useState } from 'react'
import { zoomBy, type Zoom } from '../scene'

/**
 * Зум сцены — состояние интерфейса, в журнал не попадает. Старт — «вписать»;
 * −/＋ шагают от фактического масштаба (его сообщает сцена через onScale).
 */
export function useZoom() {
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(1)

  const onScale = useCallback((k: number) => {
    scaleRef.current = k
    setScale(k)
  }, [])
  const step = useCallback((dir: 1 | -1) => setZoom((z) => zoomBy(z === 'fit' ? scaleRef.current : z, dir)), [])
  const zoomIn = useCallback(() => step(1), [step])
  const zoomOut = useCallback(() => step(-1), [step])
  const zoomFit = useCallback(() => setZoom('fit'), [])

  return { zoom, scale, onScale, zoomIn, zoomOut, zoomFit }
}
