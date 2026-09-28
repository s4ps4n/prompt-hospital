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
import { decideDrop, type DropHit } from './dnd'
import { useDrag } from './useDrag'
import { useJournal, useMessage } from './useJournal'
import './app.css'

export interface AppProps {
  /** Стор журнала; по умолчанию — localStorage. Подменяется в тестах. */
  store?: JournalStore
}

/**
 * Приложение целиком. Всё, что относится к офису, читается из журнала;
 * локально — только состояние интерфейса (выделение, модалки, drag, сообщение).
 */
export default function App({ store: injected }: AppProps) {
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

  const onDrop = useCallback(
    (task: TaskId, hit: DropHit | null) => {
      const d = decideDrop(store.getJournal(), task, hit)
      if (d.kind === 'miss') say('Мимо — задача осталась на месте', 'info')
      else if (d.kind === 'op') run(d.op.name, d.op.args)
    },
    [store, run, say],
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
        background: '#2b2117',
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
            onClose={() => setSelectedId(null)}
            onClone={(model, role) => setCatalog({ model, role })}
          />
        )}
      </div>
      <MessageBar message={message} />

      {catalog && <CatalogModal initial={catalog} onConfirm={addWorker} onClose={() => setCatalog(null)} />}
      {journalOpen && <JournalModal journal={journal} onClose={() => setJournalOpen(false)} />}
      {drag && dragTask && <DragGhost task={dragTask} x={drag.x} y={drag.y} />}
    </main>
  )
}
