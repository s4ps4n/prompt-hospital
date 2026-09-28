import { useEffect, useRef, useState } from 'react'
import { initialJournal } from './journal'
import { DEFAULT_COLS, OfficeScene, fitScale, layoutOffice, sceneBounds } from './scene'

const journal = initialJournal()

function App() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 900, height: 600 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = fitScale(box, sceneBounds(layoutOffice(journal.workers, DEFAULT_COLS)))

  return (
    <main
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        boxSizing: 'border-box',
        background: '#2b2117',
        color: '#f6edd6',
        fontFamily: 'Verdana, Tahoma, sans-serif',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, color: '#f7d23a', letterSpacing: '.06em' }}>PROMPT HOSPITAL</h1>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ width: 'fit-content', margin: '0 auto' }}>
          <OfficeScene journal={journal} cols={DEFAULT_COLS} scale={scale} />
        </div>
      </div>
    </main>
  )
}

export default App
