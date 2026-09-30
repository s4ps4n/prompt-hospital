// Файл OAuth-токенов (Б24 или Точки): { access_token?, refresh_token }, права 0600, не в git.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Tokens = { access_token?: string; refresh_token: string }

export function writeTokens(path: string, t: Tokens): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token }), { mode: 0o600 })
  renameSync(tmp, path)
}

export function readTokens(path: string): Tokens | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
