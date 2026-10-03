import { useT } from '../i18n'
import type { Journal } from '../journal/types'
import { UI } from '../theme/colors'
import { MessageBar, type Message } from './MessageBar'
import { SourceBanner, type JournalSource } from './SourceBanner'
import { TaskCounters } from './TaskCounters'

interface StatusBarProps {
  journal: Journal
  message: Message | null
  source: JournalSource
}

/** Нижняя панель: сообщение/подсказка, счётчики задач и плашка источника журнала — офис не сдвигается вниз. */
export function StatusBar({ journal, message, source }: StatusBarProps) {
  const t = useT()
  return (
    <footer
      aria-label={t('status.label')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '4px 6px',
        background: UI.console,
        border: `3px solid ${UI.wood}`,
        borderRadius: 6,
        boxSizing: 'border-box',
      }}
    >
      <MessageBar message={message} />
      <TaskCounters journal={journal} />
      <SourceBanner source={source} />
    </footer>
  )
}
