import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { judgeGate, type SttBaseline, type SttCorpus } from '../src/core/sttAb/sttGate.ts'
import { commandHeads } from '../src/core/voice/commandLexicon.ts'
import { hearCorpus } from '../src/main/elevenlabs/hearCorpus.ts'

// The STT corpus as a test (#471): every labelled dump heard by the cloud
// ear with the keyterms the app builds, held against the kept run
// (`pnpm stt:gate --keep`). Valid as a test because the ear's words on a
// replayed dump are deterministic. Skips itself without ELEVENLABS_API_KEY,
// as the `*.chrome.test.ts` collector tests skip without Chrome: the unit
// suite never opens a paid socket on its own.

const apiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? ''
const root = join(import.meta.dirname, '..')
const corpus = JSON.parse(readFileSync(join(root, 'fixtures/stt-labels/audio-dumps-2026-10.json'), 'utf8')) as SttCorpus
const baseline = JSON.parse(readFileSync(join(root, 'fixtures/stt-labels/stt-gate.json'), 'utf8')) as SttBaseline

describe.skipIf(apiKey === '')('the cloud ear over the labelled dumps (#471)', () => {
  it(
    'hears every dump the kept run heard word for word, the idle page and feeling good lines among them',
    async () => {
      const rows = await hearCorpus({ apiKey, ...(process.env.BINGBONG_ELEVENLABS_URL ? { url: process.env.BINGBONG_ELEVENLABS_URL } : {}), dumpsDir: join(root, 'fixtures/stt-dumps'), corpus, heads: commandHeads() })
      const verdict = judgeGate(rows, baseline)
      expect(verdict.regressions, verdict.regressions.map((row) => `${row.file}: ${JSON.stringify(row.said)} heard ${JSON.stringify(row.heard)}`).join('; ')).toEqual([])
      // The ledger's own clips (turn-mvphyxti-vm, turn-mvphz4g8-vn, turn-mvpls2u8-v1d).
      for (const file of ['utterance-1793033700533-0030.wav', 'utterance-1793033709127-0031.wav', 'utterance-1793040098909-0071.wav']) {
        expect(rows.find((row) => row.file === file)?.errors, file).toBe(0)
      }
    },
    10 * 60_000,
  )
})
