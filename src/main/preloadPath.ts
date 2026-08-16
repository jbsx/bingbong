import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CANDIDATES = ['index.mjs', 'index.js'] as const

export function resolvePreloadPath(preloadDir: string): string {
  for (const name of CANDIDATES) {
    const path = join(preloadDir, name)
    if (existsSync(path)) return path
  }
  throw new Error(`preload not found in ${preloadDir} (looked for: ${CANDIDATES.join(', ')})`)
}
