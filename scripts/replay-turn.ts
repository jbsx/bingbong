#!/usr/bin/env node
// The #357 replay (`pnpm turn:replay`): beside scripts/replay-stt.ts, it
// runs captured utterance dumps (BINGBONG_AUDIO_DUMP=1 → <userData>/audio-dumps,
// #34) through the shipped Endpoint — Silero VAD, the endpointer, Smart
// Turn — and reports where the turn check would have fired. Each dump is
// one Utterance the old 700 ms timer cut, so it ends ~640 ms after its last
// speech; 2.2 s of silence is appended so the pause cap can fire too. A
// check that reads finished before the last speech frame is a split: the
// new Endpoint would have cut that line in two. Node runs this .ts directly
// via type stripping (Node ≥ 22.18, #36), so .ts-extension imports here and
// on the runtime graph.
//
// Usage:
//   pnpm turn:replay [dumps-dir] [models-dir]
//
// Defaults: ~/.config/bingbong/audio-dumps and ~/.config/bingbong/models
// (Smart Turn auto-fetches into <models-dir>/smart-turn on first run;
// Silero is read from <models-dir>/silero_vad.onnx).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import { createUtteranceEndpointer, vadDefaults, VAD_FRAME_MS, VAD_FRAME_SAMPLES, type UtteranceEnd } from '../src/core/voice/vadEndpointing.ts'
import { createSileroVad } from '../src/main/voice/createSileroVad.ts'
import { createSmartTurn } from '../src/main/voice/createSmartTurn.ts'

const dumpsDir = process.argv[2] ?? join(homedir(), '.config/bingbong/audio-dumps')
const modelsDir = process.argv[3] ?? join(homedir(), '.config/bingbong/models')
const TAIL_MS = 2_200

const files = existsSync(dumpsDir)
  ? readdirSync(dumpsDir)
      .filter((name) => name.endsWith('.wav'))
      .sort()
  : []
if (files.length === 0) {
  console.error(`no .wav utterance dumps in ${dumpsDir} — capture some with BINGBONG_AUDIO_DUMP=1`)
  process.exit(1)
}

const vad = await createSileroVad({ modelPath: join(modelsDir, 'silero_vad.onnx') })
const smartTurn = createSmartTurn({ modelsDir, prefetch: false })
await smartTurn.load()
const config = vadDefaults()

interface Check {
  atMs: number
  probability: number
  ms: number
}

interface Row {
  file: string
  durMs: number
  lastSpeechMs: number
  checks: Check[]
  ends: (UtteranceEnd & { atMs: number })[]
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)}s`

async function replay(file: string): Promise<Row> {
  const pcm = readUtteranceWavPcm(readFileSync(join(dumpsDir, file)))
  const audio = new Float32Array(pcm.length + (TAIL_MS / 1000) * 16_000)
  audio.set(pcm)
  vad.reset()
  let frameIndex = 0
  const checks: Check[] = []
  const endpointer = createUtteranceEndpointer(undefined, {
    now: () => performance.now(),
    turn: {
      async score(utterance) {
        const startedAt = performance.now()
        const probability = await smartTurn.score(utterance)
        checks.push({ atMs: (frameIndex + 1) * VAD_FRAME_MS, probability, ms: performance.now() - startedAt })
        return probability
      },
    },
  })
  const ends: Row['ends'] = []
  let lastSpeechMs = 0
  for (; (frameIndex + 1) * VAD_FRAME_SAMPLES <= audio.length; frameIndex++) {
    const frame = audio.subarray(frameIndex * VAD_FRAME_SAMPLES, (frameIndex + 1) * VAD_FRAME_SAMPLES)
    const prob = await vad.score(frame)
    if (prob >= config.speechThreshold && frameIndex * VAD_FRAME_SAMPLES < pcm.length) lastSpeechMs = (frameIndex + 1) * VAD_FRAME_MS
    const end = await endpointer.push(prob, frame)
    if (end) ends.push({ ...end, atMs: (frameIndex + 1) * VAD_FRAME_MS })
  }
  return { file, durMs: (pcm.length / 16_000) * 1000, lastSpeechMs, checks, ends }
}

const rows: Row[] = []
for (const file of files) rows.push(await replay(file))

const LEGACY_ENDPOINT_MS = 700
let byTurn = 0
let byCap = 0
let splits = 0
const savedMs: number[] = []
console.log(`Smart Turn replay: ${rows.length} dumps from ${dumpsDir}; check at ${config.turnCheckFrames * VAD_FRAME_MS} ms of silence, pause cap ${config.endFrames * VAD_FRAME_MS} ms`)
console.log()
for (const row of rows) {
  const checks = row.checks.map((check) => `${seconds(check.atMs)}:${check.probability.toFixed(2)}`).join(' ')
  const early = row.ends.filter((end) => end.atMs < row.lastSpeechMs)
  const last = row.ends.at(-1)
  let verdict: string
  if (early.length > 0) {
    splits += 1
    verdict = `SPLIT at ${early.map((end) => seconds(end.atMs)).join(', ')}`
  } else if (last?.endedBy === 'turn') {
    byTurn += 1
    // The old Endpoint fired 700 ms after the last speech; this one fired here.
    const saved = row.lastSpeechMs + LEGACY_ENDPOINT_MS - last.atMs
    savedMs.push(saved)
    verdict = `turn at ${seconds(last.atMs)} (${Math.round(saved)} ms sooner than 700 ms)`
  } else if (last?.endedBy === 'cap') {
    byCap += 1
    verdict = `cap at ${seconds(last.atMs)} (${Math.round(last.atMs - row.lastSpeechMs - LEGACY_ENDPOINT_MS)} ms later than 700 ms)`
  } else {
    verdict = 'no Endpoint (blip)'
  }
  console.log(`${row.file}  ${seconds(row.durMs)}  last speech ${seconds(row.lastSpeechMs)}  checks [${checks}]  → ${verdict}`)
}

const checkMs = rows.flatMap((row) => row.checks.map((check) => check.ms)).sort((a, b) => a - b)
const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length)
console.log()
console.log(`fired by Smart Turn at the final pause: ${byTurn}/${rows.length} (mean ${Math.round(mean(savedMs))} ms sooner than the 700 ms timer)`)
console.log(`fired by the 2 s cap: ${byCap}/${rows.length}`)
console.log(`split mid-line (finished read before the last speech): ${splits}/${rows.length}`)
console.log(`checks ${checkMs.length}; score ms p50 ${Math.round(checkMs[Math.floor(checkMs.length / 2)] ?? 0)} max ${Math.round(checkMs.at(-1) ?? 0)}`)
