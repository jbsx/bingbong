import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEEK_SETTLE_MS as PAGE_SEEK_SETTLE_MS } from '../browser/pageMediaScript'
import { SEEK_SETTLE_MS } from './youtubeScripts'

// One settle for the Player and a media ref (#506): the Player's poll and a
// media op's page-side listener read a seek's pause by the same window.
describe('the Seek Mark’s settle', () => {
  it('is the page’s own, imported by the Player’s scripts, never a copy to drift', () => {
    expect(SEEK_SETTLE_MS).toBe(PAGE_SEEK_SETTLE_MS)
    const source = readFileSync(join(__dirname, 'youtubeScripts.ts'), 'utf8')
    expect(source).not.toMatch(/const SEEK_SETTLE_MS\s*=/)
  })
})
