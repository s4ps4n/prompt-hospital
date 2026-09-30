import type { IncomingMessage, ServerResponse } from 'node:http'
import { PayloadError } from './tochka.ts'

export function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new PayloadError('too_large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Служебная страница: только фиксированный текст, без данных; code/state из адреса не утекают через Referer. */
export function page(res: ServerResponse, code: number, text: string, extraHead = ''): void {
  res
    .writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
    .end(`<!doctype html><meta charset="utf-8"><title>Точка → Б24</title>${extraHead}<p>${text}</p>`)
}
