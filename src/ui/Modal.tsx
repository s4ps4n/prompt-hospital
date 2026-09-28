import type { ReactNode } from 'react'
import { useT } from '../i18n'
import { OUTLINE, UI, UI_EXTRA } from '../theme/colors'
import { miniButton, panel } from './styles'

interface ModalProps {
  title: string
  width: number
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, width, onClose, children }: ModalProps) {
  const t = useT()
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: UI_EXTRA.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...panel,
          width: `min(${width}px, 100%)`,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: `6px 6px 0 ${UI.console}`,
          padding: 16,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, flex: 1, font: 'inherit', fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: OUTLINE }}>
            {title}
          </h2>
          <button type="button" aria-label={t('modal.close')} onClick={onClose} style={{ ...miniButton, width: 28, height: 28, fontSize: 14, fontWeight: 800 }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
