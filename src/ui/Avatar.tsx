import { Character } from '../characters'
import type { CatalogEntry, Worker } from '../journal/types'

interface AvatarProps {
  worker: Worker
  entry: CatalogEntry
  width: number
  height: number
}

/** Персонаж без мебели в отдельном SVG (карточка, каталог). */
export function Avatar({ worker, entry, width, height }: AvatarProps) {
  return (
    <svg viewBox="-36 -76 66 90" width={width} height={height} style={{ display: 'block' }} aria-hidden>
      <Character worker={worker} catalogEntry={entry} furniture={false} />
    </svg>
  )
}
