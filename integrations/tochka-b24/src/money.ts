// Деньги считаем в копейках целыми числами — никакой плавающей точки в сравнении сумм.

export function toKopecks(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null
    const k = Math.round(v * 100)
    return Number.isSafeInteger(k) ? k : null
  }
  if (typeof v !== 'string') return null
  const s = v.replace(/\s/g, '').replace(',', '.')
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const k = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(k) && k > 0 ? k : null
}

const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8]
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]

function control(d: number[], w: number[]): number {
  return (w.reduce((s, wi, i) => s + wi * d[i], 0) % 11) % 10
}

/** ИНН → только цифры, с проверкой контрольной суммы. Мусор, нули, пусто → null (как «ИНН нет»). */
export function normalizeInn(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).replace(/\D/g, '')
  if (/^0*$/.test(s)) return null
  const d = [...s].map(Number)
  if (s.length === 10) return control(d, W10) === d[9] ? s : null
  if (s.length === 12) return control(d, W11) === d[10] && control(d, W12) === d[11] ? s : null
  return null
}
