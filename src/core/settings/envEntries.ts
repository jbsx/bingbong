// The `.env` on the Settings page: what the file holds, shown as entries,
// and the one edit the page makes to it — set or remove a key — done on the
// text so every comment, blank line and commented-out example survives.
// Pure, beside dotEnv.ts; only the read and write live in the main process.

import { parseDotEnv } from './dotEnv'

/** One key of the `.env` as the Settings page shows it. */
export interface EnvEntry {
  key: string
  /** The value, or for a secret only its last four characters (the whole of a secret never leaves main). */
  value: string
  secret: boolean
  /** The process env sets this key too, so the file's value is not the one the app reads. */
  shadowed: boolean
}

export interface EnvFileView {
  path: string
  /** False while the file does not exist yet; the first set creates it. */
  exists: boolean
  entries: EnvEntry[]
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Credentials by name: the key says what it holds, never the value. */
const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?)$/i

export function isEnvKey(key: string): boolean {
  return ENV_KEY.test(key)
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key) && !/_ENV$/i.test(key)
}

/** The tail a masked secret shows, so two keys can be told apart without showing either. */
export function secretTail(value: string): string {
  return value.length <= 8 ? '' : value.slice(-4)
}

export function envEntries(text: string, processEnv: Record<string, string | undefined>): EnvEntry[] {
  return Object.entries(parseDotEnv(text)).map(([key, value]) => {
    const secret = isSecretKey(key)
    return { key, value: secret ? secretTail(value) : value, secret, shadowed: processEnv[key] !== undefined && processEnv[key] !== value }
  })
}

/** A value written back so parseDotEnv reads exactly it: bare when that is safe, else double-quoted. */
function quoteValue(value: string): string {
  if (value === '' || /^[^\s"'#\\]+$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/**
 * Set `key` to `value` in the `.env` text, or remove it when `value` is
 * null. Every live line for the key is replaced by one (the first keeps its
 * place; a key not yet there is appended); comments and other keys stay as
 * they were.
 */
export function setEnvValue(text: string, key: string, value: string | null): string {
  if (!isEnvKey(key)) throw new Error(`not an env var name: ${key}`)
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text === '' ? [] : text.split(/\r?\n/)
  const assigns = new RegExp(`^\\s*(export\\s+)?${key}=`)
  const next: string[] = []
  let placed = false
  for (const line of lines) {
    if (!assigns.test(line)) {
      next.push(line)
      continue
    }
    if (value !== null && !placed) next.push(`${line.match(/^\s*(export\s+)?/)![0]}${key}=${quoteValue(value)}`)
    placed = true
  }
  if (value !== null && !placed) {
    // Appended before the file's final newline, so the file still ends with one.
    if (next.length > 0 && next[next.length - 1] === '') next.splice(next.length - 1, 0, `${key}=${quoteValue(value)}`)
    else next.push(`${key}=${quoteValue(value)}`, '')
  }
  return next.join(newline)
}
