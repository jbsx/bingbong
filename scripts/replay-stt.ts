#!/usr/bin/env node
// The #35 replay tool (`pnpm stt:replay`): the successor of the #39 A/B
// harness's Moonshine half — replays captured utterance-dump WAVs
// (BINGBONG_AUDIO_DUMP=1 → <userData>/audio-dumps, #34) through a shipped
// streaming engine and prints per-file transcripts, the
// endpoint→transcript wall times and the peak RSS so far (#358), so
// accuracy on real voice is checked offline (spec #35: "validated on my own
// voice") and latency is compared
// against the live `stt` perf span in the same units. Frames are pushed at
// real-time cadence — the way the voice session drives the engine — so
// partial passes overlap speech exactly as they do live and finish()'s wall
// time means what the stt span means. Node runs this .ts directly via type
// stripping (needs Node ≥ 22.18, #36), so .ts-extension imports here and in
// every src file on its runtime import graph.
//
// Usage:
//   pnpm stt:replay [dumps-dir] [models-dir]
//
// Defaults: ~/.config/bingbong/audio-dumps and ~/.config/bingbong/models
// (the Moonshine export auto-fetches on first run). With no dumps present
// the script falls back to the models-dir's jfk.wav fixture. Parakeet
// replays by default (#358); set BINGBONG_STT_MODEL=small|medium|base to
// replay through a Moonshine tier (#63). Run one engine per process: the
// peak RSS is the process's, so engines sharing one would blur it.
// The decode is biased toward the Seed Lexicon as the app's is; set
// BINGBONG_STT_BIAS="Linus Tech Tips,Elon Musk" to add those as Page
// Terms (ADR 0077), standing in for the names a page would have shown.
// Set BINGBONG_STT_AT_PAUSE=<ms> to replay the final the way #443 runs it:
// the decode starts at the pause, the Endpoint comes <ms> later (the turn
// check's time), and finish() over the same audio takes that decode's words.
// Set BINGBONG_STT_SEED=<file> (a JSON array of phrases) to replay another
// seed in place of the shipped one: the other arm of a lexicon tie (#456).
// Dumps labelled with what was said are scored against it: the labels file
// is BINGBONG_STT_LABELS, else fixtures/stt-labels/audio-dumps-2026-10.json
// when it exists (#456). A label naming a ledger `stt` line (`ledger`,
// `names`) is scored on those names too: the cloud ear's pass bar (#463).
// BINGBONG_STT_MODEL=elevenlabs replays through ElevenLabs Scribe v2
// Realtime (#463) — the key from ELEVENLABS_API_KEY, e.g.
// `node --env-file=<root>/.env scripts/replay-stt.ts`; the same bias, cut
// to keyterms as the app cuts them, and no Parakeet behind it: a cloud
// fault is printed as the row's transcript; BINGBONG_STT_COMMIT_MS=<ms>
// waits that long for the commit instead of the app's 1.5 s, so a late
// commit's words are scored and its lateness read off the row's time.
// Set BINGBONG_STT_ROWS=<file>
// to keep a run's rows, and BINGBONG_STT_AGREE=<file> to compare this run
// with a kept one on the clips no label covers (grill ruling 4).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { SttModel } from '../src/core/settings/settings.ts'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import { WAKE_DUMP_PREFIX } from '../src/core/voice/utteranceDump.ts'
import { formatAgreement, formatLabelScore, formatNameScore, formatReplayReport, type LedgerNames, type ReplayRow } from '../src/core/sttAb/replayReport.ts'
import { VAD_FRAME_SAMPLES, VAD_FRAME_MS } from '../src/core/voice/vadEndpointing.ts'
import { parseMoonshineTokenizer } from '../src/core/moonshine/bpeTokenizer.ts'
import { createMoonshineTranscriber, type BiasInput } from '../src/main/moonshine/createMoonshineTranscriber.ts'
import { PAGE_TERMS_BOOST } from '../src/core/voice/biasUnion.ts'
import { ensureMoonshineModels, fsMoonshineStore, MOONSHINE_TIERS } from '../src/main/moonshine/moonshineModels.ts'
import { parseParakeetVocab } from '../src/core/parakeet/parakeetVocab.ts'
import { createParakeetTranscriber } from '../src/main/parakeet/createParakeetTranscriber.ts'
import { ensureParakeetModels } from '../src/main/parakeet/parakeetModels.ts'
import type { Transcriber } from '../src/core/ports/stt.ts'
import { cloudKeyterms } from '../src/core/voice/cloudKeyterms.ts'
import { createElevenLabsTranscriber } from '../src/main/elevenlabs/createElevenLabsTranscriber.ts'

const dumpsDir = process.argv[2] ?? join(homedir(), '.config/bingbong/audio-dumps')
const modelsDir = process.argv[3] ?? join(homedir(), '.config/bingbong/models')
// Parsed inline: importing the settings sanitizer would pull the
// extensionless main-tree module graph into Node's type-stripping runtime.
const envTier = process.env.BINGBONG_STT_MODEL
const sttModel: SttModel = envTier === 'base' || envTier === 'medium' || envTier === 'small' || envTier === 'elevenlabs' ? envTier : 'parakeet'
// The Seed Lexicon as the app builds it (#456): its command half is read
// off the command tables, whose imports carry no .ts extension — this
// type-stripping runtime follows them through a resolve hook that tries
// the .ts file first.
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
const { BIAS_LEXICON } = (await import('../src/main/moonshine/biasLexicon.ts')) as typeof import('../src/main/moonshine/biasLexicon')
const { commandHeads } = (await import('../src/core/voice/commandLexicon.ts')) as typeof import('../src/core/voice/commandLexicon')
const seedFile = process.env.BINGBONG_STT_SEED
const seedLexicon: readonly string[] = seedFile === undefined ? BIAS_LEXICON : (JSON.parse(readFileSync(seedFile, 'utf8')) as string[])
const labelsFile = process.env.BINGBONG_STT_LABELS ?? fileURLToPath(new URL('../fixtures/stt-labels/audio-dumps-2026-10.json', import.meta.url))
const labelEntries = existsSync(labelsFile) ? Object.entries((JSON.parse(readFileSync(labelsFile, 'utf8')) as { labels: Record<string, { said: string; ledger?: string; names?: string[] }> }).labels) : []
const labels: Record<string, string> = Object.fromEntries(labelEntries.map(([file, label]) => [file, label.said]))
const ledgerNames: Record<string, LedgerNames> = Object.fromEntries(
  labelEntries.flatMap(([file, label]) => (label.ledger !== undefined && label.names !== undefined ? [[file, { ledger: label.ledger, names: label.names }]] : [])),
)
const pageTerms = (process.env.BINGBONG_STT_BIAS ?? '').split(',').map((term) => term.trim()).filter((term) => term !== '')
const atPauseMs = process.env.BINGBONG_STT_AT_PAUSE === undefined ? null : Number(process.env.BINGBONG_STT_AT_PAUSE)
const biasPhrases: BiasInput = pageTerms.length === 0 ? seedLexicon : [{ phrases: seedLexicon }, { phrases: pageTerms, boost: PAGE_TERMS_BOOST }]

function wavFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.wav') && !name.startsWith(WAKE_DUMP_PREFIX))
    .sort()
    .map((name) => join(dir, name))
}

let files = wavFiles(dumpsDir)
if (files.length === 0) {
  const fixture = join(modelsDir, 'jfk.wav')
  if (!existsSync(fixture)) {
    console.error(`no .wav utterance dumps in ${dumpsDir}`)
    console.error(`capture your own: launch the app with BINGBONG_AUDIO_DUMP=1 and speak`)
    console.error(`or drop the fixture first:  curl -L -o '${fixture}' https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav`)
    process.exit(1)
  }
  console.log(`no utterance dumps in ${dumpsDir} — replaying the jfk.wav fixture instead`)
  files = [fixture]
}

// The shipped engine, wired exactly like createMainParakeetTranscriber or
// createMainMoonshineTranscriber (which stay off this script's
// type-stripping runtime graph).
async function shippedEngine(): Promise<Transcriber> {
  if (sttModel === 'elevenlabs') {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? ''
    if (apiKey === '') {
      console.error('ELEVENLABS_API_KEY is unset: run with node --env-file=<root>/.env')
      process.exit(1)
    }
    const keyterms = cloudKeyterms(biasPhrases, new Set(seedLexicon), commandHeads())
    console.log(`keyterms (${keyterms.length}): ${keyterms.join(' | ')}`)
    // The wait for the commit: the app's 1.5 s unless BINGBONG_STT_COMMIT_MS says otherwise, so the ear's words and its lateness read apart.
    const commitMs = Number(process.env.BINGBONG_STT_COMMIT_MS)
    return createElevenLabsTranscriber({ apiKey, keyterms: () => keyterms, ...(Number.isFinite(commitMs) && commitMs > 0 ? { commitTimeoutMs: commitMs } : {}) })
  }
  if (sttModel === 'parakeet') {
    const parakeet = await ensureParakeetModels(modelsDir, fsMoonshineStore)
    for (const name of parakeet.fetched) console.log(`fetched ${name}`)
    return createParakeetTranscriber({
      preprocessorPath: join(parakeet.dir, 'nemo128.onnx'),
      encoderPath: join(parakeet.dir, 'encoder-model.int8.onnx'),
      decoderJointPath: join(parakeet.dir, 'decoder_joint-model.int8.onnx'),
      loadVocab: async () => parseParakeetVocab(readFileSync(join(parakeet.dir, 'vocab.txt'), 'utf8')),
      biasPhrases,
    })
  }
  const moonshine = await ensureMoonshineModels(modelsDir, fsMoonshineStore, sttModel)
  for (const name of moonshine.fetched) console.log(`fetched ${name}`)
  const tier = MOONSHINE_TIERS[sttModel]
  return createMoonshineTranscriber({
    encoderPath: join(moonshine.dir, 'encoder_model.onnx'),
    decoderPath: join(moonshine.dir, 'decoder_model_merged.onnx'),
    loadVocab: async () =>
      parseMoonshineTokenizer(readFileSync(join(moonshine.dir, 'tokenizer.json'), 'utf8')),
    dims: tier.dims,
    frameSamples: tier.frameSamples,
    biasPhrases,
  })
}
const transcriber = await shippedEngine()
console.log(`engine ${sttModel}${atPauseMs !== null ? `; final decoded at the pause, the Endpoint ${atPauseMs} ms later` : ''}; seed lexicon ${seedLexicon.length} terms${seedFile !== undefined ? ` from ${seedFile}` : ''}${pageTerms.length > 0 ? `; page terms at ${PAGE_TERMS_BOOST}: ${pageTerms.join(' | ')}` : ''}`)

/** Real-time-paced push: partials overlap speech the way they do live. */
async function replay(file: string): Promise<ReplayRow> {
  const pcm = readUtteranceWavPcm(readFileSync(file))
  transcriber.begin()
  const start = performance.now()
  for (let offset = 0; offset + VAD_FRAME_SAMPLES <= pcm.length; offset += VAD_FRAME_SAMPLES) {
    const due = start + (offset / VAD_FRAME_SAMPLES) * VAD_FRAME_MS
    const wait = due - performance.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    transcriber.push(pcm.subarray(offset, offset + VAD_FRAME_SAMPLES))
  }
  // The pause (#443): the final's decode starts here, and the turn check runs beside it.
  if (atPauseMs !== null) {
    transcriber.pauseReached?.(pcm)
    await new Promise((resolve) => setTimeout(resolve, atPauseMs))
  }
  // The endpoint just fired: this is the stt span's measure — drain of any
  // in-flight partial, then the final full-utterance pass.
  const endpoint = performance.now()
  const transcript = (await transcriber.finish(pcm).catch((error: unknown) => `<fault: ${error instanceof Error ? error.message : String(error)}>`)).trim()
  const ms = performance.now() - endpoint
  // maxRSS is in KiB and never falls: the peak of the run so far.
  const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024)
  return { file: file.split('/').at(-1) ?? file, speechMs: (pcm.length / 16_000) * 1000, ms, transcript, peakRssMb }
}

const rows: ReplayRow[] = []
for (const file of files) rows.push(await replay(file))
console.log()
console.log(formatReplayReport(rows))
if (Object.keys(labels).length > 0) {
  console.log()
  console.log(`scored against ${labelsFile}:`)
  console.log(formatLabelScore(rows, labels))
}
if (Object.keys(ledgerNames).length > 0) {
  console.log()
  console.log(formatNameScore(rows, ledgerNames))
}
const agreeFile = process.env.BINGBONG_STT_AGREE
if (agreeFile !== undefined) {
  console.log()
  console.log(`against ${agreeFile}:`)
  console.log(formatAgreement(rows, JSON.parse(readFileSync(agreeFile, 'utf8')) as ReplayRow[], labels))
}
const rowsFile = process.env.BINGBONG_STT_ROWS
if (rowsFile !== undefined) writeFileSync(rowsFile, JSON.stringify(rows, null, 1))
