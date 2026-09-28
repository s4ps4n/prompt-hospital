import { UI } from '../theme/colors'
import { FONT_MONO, UI_EXTRA } from './styles'

export type MessageKind = 'ok' | 'err' | 'info'
export interface Message {
  text: string
  kind: MessageKind
}

const COLOR: Record<MessageKind, string> = { ok: UI.ok, err: UI.error, info: UI.paper }
const HINT = 'Перетащите конверт из лотка Гермеса на комнату модели. Клик по комнате открывает карточку.'

/** Нижняя строка: текст OpResult.msg / OpResult.err или подсказка. */
export function MessageBar({ message }: { message: Message | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-kind={message?.kind ?? 'hint'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: UI.console,
        border: `3px solid ${UI.wood}`,
        borderRadius: 6,
        fontFamily: FONT_MONO,
        fontSize: 13,
        fontWeight: 700,
        color: message ? COLOR[message.kind] : UI_EXTRA.hint,
        minHeight: 40,
        boxSizing: 'border-box',
      }}
    >
      ▸ {message?.text ?? HINT}
    </div>
  )
}
