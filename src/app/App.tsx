import { useCallback, useState } from 'react'
import { ROLES, createJournalStore, findTask, findWorker, type JournalStore, type OpArgs, type OpName, type OpResult, type TaskId } from '../journal'
import {
  CatalogModal,
  DragGhost,
  FONT_UI,
  JournalModal,
  MessageBar,
  SceneView,
  TRAY_DROP,
  TopBar,
  Tray,
  WorkerCard,
  type CatalogChoice,
} from '../ui'
import type { ScreenPoint } from '../animations'
import { UI_EXTRA } from '../theme/colors'
import { decideDrop, flightTarget, type DropHit } from './dnd'
import { useDrag } from './useDrag'
import { useFlights } from './useFlights'
import { useJournal, useMessage } from './useJournal'
import './app.css'

export interface AppProps {
  /** Стор журнала; по умолчанию — localStorage. Подменяется в тестах. */
  store?: JournalStore
  /** false — отключает все анимации: idle-график, пульсы, полёт конверта (операция применяется сразу). */
  motion?: boolean
}

/**
 * Приложение целиком. Всё, что относится к офису, читается из журнала;
 * локально — только состояние интерфейса (выделение, модалки, drag, сообщение).
 */
export default function App({ store: injected, motion = true }: AppProps) {
  const [store] = useState(() => injected ?? createJournalStore())
  const journal = useJournal(store)
  const [message, say] = useMessage()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogChoice | null>(null)
  const [journalOpen, setJournalOpen] = useState(false)

  const run = useCallback(
    <K extends OpName>(name: K, args: OpArgs[K]): OpResult => {
      const r = store.run(name, args)
      if ('err' in r) say(r.err, 'err')
      else if ('msg' in r) say(r.msg, 'ok')
      return r
    },
    [store, say],
  )
  const check = useCallback(<K extends OpName>(name: K, args: OpArgs[K]): OpResult => store.check(name, args), [store])

  const { flights, launch } = useFlights()

  // Сухой прогон до анимации: отказ — сразу, без полёта; иначе операция применяется по приземлении.
  const onDrop = useCallback(
    (task: TaskId, hit: DropHit | null, at: ScreenPoint) => {
      const d = decideDrop(store.getJournal(), task, hit)
      if (d.kind === 'miss') say('Мимо — задача осталась на месте', 'info')
      if (d.kind !== 'op' || !hit) return
      const { name, args } = d.op
      const dry = motion ? check(name, args) : null
      if (!dry || !('msg' in dry)) {
        run(name, args)
        return
      }
      launch(task, at, flightTarget(hit, at), () => run(name, args))
    },
    [store, run, check, say, motion, launch],
  )
  const { drag, start } = useDrag(onDrop)

  // Выделение — производное: удалённая модель просто перестаёт находиться.
  const selected = selectedId ? findWorker(journal, selectedId) : undefined
  const dragTask = drag ? findTask(journal, drag.task) : undefined
  const overDrop = drag?.over?.drop ?? null

  const zoomStub = () => say('Зум появится в этапе 7 — пока сцена вписывается в окно', 'info')
  const reset = () => {
    if (typeof window.confirm === 'function' && !window.confirm('Сбросить офис к стартовому составу?')) return
    store.reset()
    setSelectedId(null)
    say('Офис сброшен к стартовому составу', 'ok')
  }
  const addWorker = (c: CatalogChoice) => {
    const r = run('addWorker', c)
    if ('msg' in r) {
      setCatalog(null)
      setSelectedId(r.id ?? null)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        boxSizing: 'border-box',
        background: UI_EXTRA.backdrop,
        fontFamily: FONT_UI,
      }}
    >
      <TopBar
        journal={journal}
        onAddModel={() => setCatalog({ model: 'claude', role: ROLES[0] })}
        onZoomOut={zoomStub}
        onZoomFit={zoomStub}
        onZoomIn={zoomStub}
        onJournal={() => setJournalOpen(true)}
        onReset={reset}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch', flex: 1, minHeight: 'calc(100vh - 128px)' }}>
        <Tray journal={journal} over={overDrop === TRAY_DROP} run={run} onStartDrag={start} />
        <SceneView
          journal={journal}
          selectedId={selected?.id ?? null}
          overDrop={overDrop}
          motion={motion}
          onSelect={setSelectedId}
          onStartDrag={start}
          onAddRoom={() => setCatalog({ model: 'claude', role: ROLES[0] })}
        />
        {selected && (
          <WorkerCard
            key={selected.id}
            journal={journal}
            worker={selected}
            run={run}
            check={check}
            onDenied={(err) => say(err, 'err')}
            onStartDrag={start}
            onClose={() => setSelectedId(null)}
            onClone={(model, role) => setCatalog({ model, role })}
          />
        )}
      </div>
      <MessageBar message={message} />

      {catalog && <CatalogModal initial={catalog} onConfirm={addWorker} onClose={() => setCatalog(null)} />}
      {journalOpen && <JournalModal journal={journal} onClose={() => setJournalOpen(false)} />}
      {drag && dragTask && <DragGhost task={dragTask} x={drag.x} y={drag.y} />}
      {flights.map((f) => {
        const t = findTask(journal, f.task)
        return t && <DragGhost key={f.id} task={t} x={f.from.x} y={f.from.y} to={f.to} />
      })}
    </main>
  )
}
