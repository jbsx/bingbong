import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SeedResult {
  copied: number
  skipped: number
}

const PARTIAL_SUFFIX = '.seed-partial'

function listFilesRecursive(root: string, relative = ''): string[] {
  const entries = readdirSync(join(root, relative))
  const files: string[] = []
  for (const entry of entries) {
    const rel = relative ? join(relative, entry) : entry
    if (statSync(join(root, rel)).isDirectory()) {
      files.push(...listFilesRecursive(root, rel))
    } else {
      files.push(rel)
    }
  }
  return files
}

export function applySeed(bakedRoot: string, userDataDir: string): SeedResult {
  const result: SeedResult = { copied: 0, skipped: 0 }
  if (!existsSync(bakedRoot)) return result

  for (const rel of listFilesRecursive(bakedRoot)) {
    const dest = join(userDataDir, rel)
    if (existsSync(dest)) {
      result.skipped += 1
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    // Copy-then-rename so a killed container never leaves a half-written file
    // the next boot would treat as present; rename is atomic within a mount.
    const partial = `${dest}${PARTIAL_SUFFIX}`
    cpSync(join(bakedRoot, rel), partial)
    renameSync(partial, dest)
    result.copied += 1
  }
  return result
}
