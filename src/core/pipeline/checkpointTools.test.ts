import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// #294: the two names are written once, in checkpointTools.ts. That they are
// the tools flagged `checkpoint: true` is pinned beside the catalog, in
// toolSurface.test.ts; this file pins that nothing else lists them.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const HOLDER = 'src/core/pipeline/checkpointTools.ts'

/** The two names in one list or one union, in either order, whatever sits between them. */
const LISTED = /'record_(evidence|candidate)'(\s*[,|]\s*'[a-z_]+')*\s*[,|]\s*'record_(evidence|candidate)'/

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourcesUnder(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('the checkpoint tool names (#294)', () => {
  it('are listed nowhere but in their holder', () => {
    const files = [...sourcesUnder('src'), 'e2e/live/audit.ts', 'e2e/eval/jev/shadow.ts']
    expect(files).toContain(HOLDER)
    const listing = files.filter((path) => LISTED.test(readFileSync(join(ROOT, path), 'utf8')))
    expect(listing).toEqual([HOLDER])
  })
})
