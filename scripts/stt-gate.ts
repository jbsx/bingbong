#!/usr/bin/env node
// `pnpm stt:gate [--only a.wav,b.wav] [--keyterms app|none|<file>] [--keep]
// [--baseline <file>] [--concurrency n]` (#471): every labelled dump in
// `fixtures/stt-dumps/` heard again by the cloud ear with the keyterms the
// app would build for it — the logged list where the dump's label has one,
// else the corpus' Learned Terms and the grammar's heads — scored by word
// errors against `fixtures/stt-labels/audio-dumps-2026-10.json`, and held
// against the kept run in `fixtures/stt-labels/stt-gate.json`: the dumps
// whose words changed are printed, a dump that passed and no longer does
// is a regression and the exit is non-zero, as on `pnpm jev:gate`. The
// ear's words on a replayed dump are deterministic, so one hearing is
// exact. `--keep` writes this run as the kept one; `--keyterms none` is
// the no-bias arm, `--keyterms <file>` a JSON list asked of every dump.
// The key is ELEVENLABS_API_KEY from the root .env (the pnpm script loads
// it); `pnpm logs:pull` brings the kiosk's new dumps, to be labelled and
// copied in. Node runs this .ts directly via type stripping (#36).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { formatGate, judgeGate, toBaseline, type SttBaseline, type SttCorpus } from '../src/core/sttAb/sttGate.ts'
import { hearCorpus } from '../src/main/elevenlabs/hearCorpus.ts'

// The heads are read off the command tables, whose imports carry no .ts
// extension: the resolve hook tries the .ts file first (as stt:replay does).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) return nextResolve(specifier, context)
    try {
      return nextResolve(`${specifier}.ts`, context)
    } catch {
      return nextResolve(specifier, context)
    }
  },
})
const { commandHeads } = (await import('../src/core/voice/commandLexicon.ts')) as typeof import('../src/core/voice/commandLexicon')

const args = process.argv.slice(2)
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}
const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))
const dumpsDir = valueOf('--dumps') ?? here('../fixtures/stt-dumps')
const labelsFile = valueOf('--labels') ?? here('../fixtures/stt-labels/audio-dumps-2026-10.json')
const baselineFile = valueOf('--baseline') ?? here('../fixtures/stt-labels/stt-gate.json')
const only = valueOf('--only')?.split(',').map((file) => file.trim()).filter((file) => file !== '')
const keytermsArm = valueOf('--keyterms') ?? 'app'
const concurrency = Number(valueOf('--concurrency') ?? 3)

const apiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? ''
if (apiKey === '') {
  console.error('stt:gate: ELEVENLABS_API_KEY is unset: put it in the root .env (the pnpm script loads it)')
  process.exit(1)
}
const corpusAsLabelled = JSON.parse(readFileSync(labelsFile, 'utf8')) as SttCorpus
// The arm: the app's keyterms, none, or one fixed list asked of every dump (a logged list on a label still wins: it is what was asked live).
const corpus: SttCorpus =
  keytermsArm === 'app'
    ? corpusAsLabelled
    : {
        ...corpusAsLabelled,
        learned: [],
        labels: Object.fromEntries(
          Object.entries(corpusAsLabelled.labels).map(([file, label]) => [file, { ...label, keyterms: label.keyterms ?? (keytermsArm === 'none' ? [] : (JSON.parse(readFileSync(keytermsArm, 'utf8')) as string[])) }]),
        ),
      }
const heads = keytermsArm === 'app' ? commandHeads() : []
const baseline: SttBaseline = existsSync(baselineFile) ? (JSON.parse(readFileSync(baselineFile, 'utf8')) as SttBaseline) : {}
const total = Object.keys(corpus.labels).length

console.log(`stt:gate: ${only?.length ?? total} of ${total} labelled dumps in ${dumpsDir}, keyterms ${keytermsArm}${keytermsArm === 'app' ? ` (${corpus.learned?.length ?? 0} learned + ${heads.length} heads, cut at the cap)` : ''}, against ${baselineFile}`)
const started = Date.now()
const rows = await hearCorpus({
  apiKey,
  ...(process.env.BINGBONG_ELEVENLABS_URL ? { url: process.env.BINGBONG_ELEVENLABS_URL } : {}),
  dumpsDir,
  corpus,
  heads,
  ...(only !== undefined ? { only } : {}),
  concurrency,
  onRow: (row) => console.log(`  ${row.file}  ${row.errors}  ${row.said}${row.errors > 0 ? `  ← ${row.heard}` : ''}`),
})
const verdict = judgeGate(rows, baseline)
console.log()
console.log(formatGate(verdict, total))
console.log(`${Math.round((Date.now() - started) / 1000)} s`)
if (args.includes('--keep')) {
  const kept = { ...baseline, ...toBaseline(rows) }
  writeFileSync(baselineFile, `${JSON.stringify(kept, null, 1)}\n`)
  console.log(`kept as ${baselineFile}`)
}
process.exit(verdict.regressions.length === 0 ? 0 : 1)
