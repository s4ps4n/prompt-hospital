import { useT } from '../i18n'
import type { Journal } from '../journal/types'
import { UI, UI_EXTRA } from '../theme/colors'
import { journalDump } from './helpers'
import { Modal } from './Modal'
import { FONT_MONO } from './styles'

export function JournalModal({ journal, onClose }: { journal: Journal; onClose: () => void }) {
  const t = useT()
  return (
    <Modal title={t('journal.title')} width={760} onClose={onClose}>
      <pre
        style={{
          margin: 0,
          minHeight: 0,
          overflow: 'auto',
          padding: 10,
          background: UI.console,
          color: UI_EXTRA.json,
          fontFamily: FONT_MONO,
          fontSize: 11,
          lineHeight: 1.45,
          borderRadius: 4,
        }}
      >
        {journalDump(journal)}
      </pre>
    </Modal>
  )
}
