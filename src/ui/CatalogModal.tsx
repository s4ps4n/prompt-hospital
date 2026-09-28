import { useState } from 'react'
import { CATALOG, ROLES, isAssignableRole } from '../journal/catalog'
import type { AssignableRole } from '../journal/types'
import { OUTLINE, UI } from '../theme/colors'
import { Avatar } from './Avatar'
import { previewWorker } from './helpers'
import { Modal } from './Modal'
import { UI_EXTRA, button, field } from './styles'

export interface CatalogChoice {
  model: string
  role: AssignableRole
}

interface CatalogModalProps {
  initial: CatalogChoice
  onConfirm: (choice: CatalogChoice) => void
  onClose: () => void
}

/** Каталог моделей: выбор модели и роли → addWorker. */
export function CatalogModal({ initial, onConfirm, onClose }: CatalogModalProps) {
  const [choice, setChoice] = useState(initial)
  return (
    <Modal title="Каталог моделей" width={660} onClose={onClose}>
      <div style={{ fontSize: 12, color: UI_EXTRA.muted }}>
        Выберите модель и роль — в офисе появится новая комната. Одна модель может занимать несколько комнат с разными ролями.
      </div>
      <div role="listbox" aria-label="Модели" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {CATALOG.map((c) => {
          const picked = c.model === choice.model
          return (
            <div
              key={c.model}
              role="option"
              aria-selected={picked}
              data-model={c.model}
              onClick={() => setChoice((s) => ({ ...s, model: c.model }))}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '8px 6px',
                border: `${picked ? 3 : 2}px solid ${OUTLINE}`,
                borderRadius: 4,
                background: picked ? UI_EXTRA.selected : UI.paperLight,
                cursor: 'pointer',
                color: OUTLINE,
              }}
            >
              <Avatar worker={previewWorker(c)} entry={c} width={48} height={66} />
              <div style={{ fontSize: 13, fontWeight: 800 }}>{c.name}</div>
              <div style={{ fontSize: 10, color: UI_EXTRA.muted }}>{c.provider}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="ph-add-role" style={{ fontSize: 12, fontWeight: 800 }}>
          Роль:
        </label>
        <select
          id="ph-add-role"
          value={choice.role}
          onChange={(e) => {
            const role = e.target.value
            if (isAssignableRole(role)) setChoice((s) => ({ ...s, role }))
          }}
          style={{ ...field, fontSize: 13, fontWeight: 700 }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button type="button" className="ph-btn" style={button()} onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="ph-btn" style={button('primary')} onClick={() => onConfirm(choice)}>
          Добавить в офис
        </button>
      </div>
    </Modal>
  )
}
