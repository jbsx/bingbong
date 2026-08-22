#!/usr/bin/env node
// The #35 replay tool (`pnpm stt:replay`): the successor of the #39 A/B
// harness's Moonshine half — replays captured utterance-dump WAVs
// (BINGBONG_AUDIO_DUMP=1 → <userData>/audio-dumps, #34) through the shipped
// streaming Moonshine engine and prints per-file transcripts plus the
// endpoint→transcript wall times, so accuracy on real voice is checked
// offline (spec #35: "validated on my own voice") and latency is compared
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
// the script falls back to the models-dir's jfk.wav fixture. Set
// BINGBONG_STT_MODEL=medium to replay through the opt-in tier (#63).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { SttModel } from '../src/core/settings/settings.ts'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import { formatReplayReport, type ReplayRow } from '../src/core/sttAb/replayReport.ts'
import { VAD_FRAME_SAMPLES, VAD_FRAME_MS } from '../src/core/voice/vadEndpointing.ts'
import { parseMoonshineTokenizer } from '../src/core/moonshine/bpeTokenizer.ts'
import { createMoonshineTranscriber } from '../src/main/moonshine/createMoonshineTranscriber.ts'
import { ensureMoonshineModels, fsMoonshineStore, MOONSHINE_TIERS } from '../src/main/moonshine/moonshineModels.ts'

const dumpsDir = process.argv[2] ?? join(homedir(), '.config/bingbong/audio-dumps')
const modelsDir = process.argv[3] ?? join(homedir(), '.config/bingbong/models')
// Parsed inline: importing the settings sanitizer would pull the
// extensionless main-tree module graph into Node's type-stripping runtime.
const sttModel: SttModel = process.env.BINGBONG_STT_MODEL === 'medium' ? 'medium' : 'base'

function wavFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.wav'))
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

// The shipped engine, wired exactly like createMainMoonshineTranscriber
// (which itself stays off this script's type-stripping runtime graph).
const moonshine = await ensureMoonshineModels(modelsDir, fsMoonshineStore, sttModel)
for (const name of moonshine.fetched) console.log(`fetched ${name}`)
const tier = MOONSHINE_TIERS[sttModel]
const transcriber = createMoonshineTranscriber({
  encoderPath: join(moonshine.dir, 'encoder_model.onnx'),
  decoderPath: join(moonshine.dir, 'decoder_model_merged.onnx'),
  loadVocab: async () =>
    parseMoonshineTokenizer(readFileSync(join(moonshine.dir, 'tokenizer.json'), 'utf8')),
  dims: tier.dims,
  frameSamples: tier.frameSamples,
})

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
  // The endpoint just fired: this is the stt span's measure — drain of any
  // in-flight partial, then the final full-utterance pass.
  const endpoint = performance.now()
  const transcript = (await transcriber.finish(pcm)).trim()
  const ms = performance.now() - endpoint
  return { file: file.split('/').at(-1) ?? file, speechMs: (pcm.length / 16_000) * 1000, ms, transcript }
}

const rows: ReplayRow[] = []
for (const file of files) rows.push(await replay(file))
console.log()
console.log(formatReplayReport(rows))
