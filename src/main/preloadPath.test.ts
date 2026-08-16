import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolvePreloadPath } from './preloadPath'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function dirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'bingbong-preload-'))
  dirs.push(dir)
  for (const file of files) writeFileSync(join(dir, file), '')
  return dir
}

describe('resolvePreloadPath', () => {
  it('prefers the ESM artifact (.mjs) when present', () => {
    const dir = dirWith(['index.mjs'])
    expect(resolvePreloadPath(dir)).toBe(join(dir, 'index.mjs'))
  })

  it('falls back to the CJS artifact (.js)', () => {
    const dir = dirWith(['index.js'])
    expect(resolvePreloadPath(dir)).toBe(join(dir, 'index.js'))
  })

  it('throws when no preload artifact exists', () => {
    const dir = dirWith([])
    expect(() => resolvePreloadPath(dir)).toThrow(/preload not found/)
  })
})
