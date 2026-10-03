import { useT } from '../i18n'
import { UI, UI_EXTRA } from '../theme/colors'
import { FONT_MONO } from './styles'

export type MessageKind = 'ok' | 'err' | 'info'
export interface Message {
  text: string
  kind: MessageKind
}

const COLOR: Record<MessageKind, string> = { ok: UI.ok, err: UI.error, info: UI.paper }

/** Строка сообщения в нижней панели: текст OpResult.msg / OpResult.err или подсказка. */
export function MessageBar({ message }: { message: Message | null }) {
  const t = useT()
  return (
    <div
      role="status"
      aria-live="polite"
      data-kind={message?.kind ?? 'hint'}
      style={{
        display: 'flex',
        alignItems: 'center',
        flex: '1 1 320px',
        minWidth: 0,
        padding: '4px 6px',
        fontFamily: FONT_MONO,
        fontSize: 12,
        fontWeight: 700,
        color: message ? COLOR[message.kind] : UI_EXTRA.hint,
        minHeight: 28,
        boxSizing: 'border-box',
      }}
    >
      ▸ {message?.text ?? t('msg.hint')}
    </div>
  )
}
