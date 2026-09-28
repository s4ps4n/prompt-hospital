import { useCallback, useState } from 'react'
import {
  JOURNAL_POLL_MS,
  OFFLINE_ERR,
  READ_ONLY_ERR,
  ROLES,
  createJournalStore,
  findTask,
  findWorker,
  opArgList,
  opUrlFor,
  postOp,
  type JournalStore,
  type OpArgs,
  type OpName,
  type OpResult,
  type TaskId,
} from '../journal'
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
import { LanguageProvider, useT } from '../i18n'
import { UI_EXTRA } from '../theme/colors'
import { decideDrop, flightTarget, type DropHit } from './dnd'
import { useDrag } from './useDrag'
import { useFlights } from './useFlights'
import { useJournal, useMessage, useRemoteJournal } from './useJournal'
import { useZoom } from './useZoom'
import './app.css'

export interface AppProps {
  /** Стор журнала; по умолчанию — localStorage. Подменяется в тестах. */
  store?: JournalStore
  /** false — отключает все анимации: idle-график, пульсы, полёт конверта (операция применяется сразу). */
  motion?: boolean
  /** URL журнала оркестратора; по умолчанию — VITE_JOURNAL_URL, пусто — локальный режим. */
  journalUrl?: string
  /** URL записи операций (POST /op); по умолчанию — рядом с journalUrl (`…/journal` → `…/op`). */
  opUrl?: string
  /** Период опроса journalUrl, мс; 0 — только при старте. */
  pollMs?: number
}

/** Приложение целиком: офис внутри контекста языка интерфейса. */
export default function App(props: AppProps) {
  return (
    <LanguageProvider>
      <Office {...props} />
    </LanguageProvider>
  )
}

/**
 * Офис. Всё, что относится к офису, читается из журнала;
 * локально — только состояние интерфейса (выделение, модалки, drag, сообщение, зум, язык).
 */
function Office({
  store: injected,
  motion = true,
  journalUrl = import.meta.env.VITE_JOURNAL_URL,
  pollMs = JOURNAL_POLL_MS,
  opUrl = journalUrl ? opUrlFor(journalUrl) : '',
}: AppProps) {
  const t = useT()
  const [store] = useState(() => injected ?? createJournalStore())
  useRemoteJournal(store, journalUrl, pollMs)
  const journal = useJournal(store)
  const [message, say] = useMessage()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogChoice | null>(null)
  const [journalOpen, setJournalOpen] = useState(false)
  const { zoom, scale, onScale, zoomIn, zoomOut, zoomFit } = useZoom()

  /**
   * Журнал оркестратора: check() локально → POST /op → журнал из ответа. Возвращается сухой прогон
   * (UI сразу закрывает форму/выделяет новую комнату), сообщение — по ответу сервера.
   * API недоступен — офис становится монитором (read-only).
   */
  const post = useCallback(
    <K extends OpName>(name: K, args: OpArgs[K]): OpResult => {
      const dry = store.check(name, args)
      if ('err' in dry) say(dry.err, 'err')
      if (!('msg' in dry)) return dry
      void postOp(opUrl, name, opArgList(name, args)).then((r) => {
        if (r.ok) {
          store.loadRemote(r.journal)
          say(dry.msg, 'ok')
        } else if ('err' in r) {
          say(r.err, 'err')
        } else {
          store.setReadOnly()
          say(OFFLINE_ERR, 'err')
        }
      })
      return dry
    },
    [store, say, opUrl],
  )
  const run = useCallback(
    <K extends OpName>(name: K, args: OpArgs[K]): OpResult => {
      if (store.isRemote() && opUrl) return post(name, args)
      const r = store.run(name, args)
      if ('err' in r) say(r.err, 'err')
      else if ('msg' in r) say(r.msg, 'ok')
      return r
    },
    [store, say, opUrl, post],
  )
  const check = useCallback(<K extends OpName>(name: K, args: OpArgs[K]): OpResult => store.check(name, args), [store])

  const { flights, launch } = useFlights()

  // Сухой прогон до анимации: отказ — сразу, без полёта; иначе операция применяется по приземлении
  // (в режиме оркестратора — POST /op по приземлении).
  const onDrop = useCallback(
    (task: TaskId, hit: DropHit | null, at: ScreenPoint) => {
      const d = decideDrop(store.getJournal(), task, hit)
      if (d.kind === 'miss') say(t('msg.miss'), 'info')
      if (d.kind !== 'op' || !hit) return
      const { name, args } = d.op
      const dry = motion ? check(name, args) : null
      if (!dry || !('msg' in dry)) {
        run(name, args)
        return
      }
      launch(task, at, flightTarget(hit, at), () => run(name, args))
    },
    [store, run, check, say, motion, launch, t],
  )
  const { drag, start } = useDrag(onDrop)

  // Выделение — производное: удалённая модель просто перестаёт находиться.
  const selected = selectedId ? findWorker(journal, selectedId) : undefined
  const dragTask = drag ? findTask(journal, drag.task) : undefined
  const overDrop = drag?.over?.drop ?? null

  // Стабильные колбэки: SceneView мемоизирована и не пересобирается на drag/сообщениях/модалках.
  const openCatalog = useCallback(() => setCatalog({ model: 'claude', role: ROLES[0] }), [])
  const reset = () => {
    if (store.isReadOnly()) {
      say(READ_ONLY_ERR, 'err')
      return
    }
    if (store.isRemote()) {
      say(t('msg.resetRemote'), 'info')
      return
    }
    if (typeof window.confirm === 'function' && !window.confirm(t('msg.resetConfirm'))) return
    store.reset()
    setSelectedId(null)
    say(t('msg.resetDone'), 'ok')
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
        scale={scale}
        onAddModel={openCatalog}
        onZoomOut={zoomOut}
        onZoomFit={zoomFit}
        onZoomIn={zoomIn}
        onJournal={() => setJournalOpen(true)}
        onReset={reset}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch', flex: 1, minHeight: 'calc(100vh - 128px)' }}>
        <Tray journal={journal} over={overDrop === TRAY_DROP} run={run} onStartDrag={start} />
        <SceneView
          journal={journal}
          selectedId={selected?.id ?? null}
          overDrop={overDrop}
          zoom={zoom}
          onScale={onScale}
          motion={motion}
          onSelect={setSelectedId}
          onStartDrag={start}
          onAddRoom={openCatalog}
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
