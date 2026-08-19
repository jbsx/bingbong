#!/usr/bin/env node
// The #39 A/B harness entry point (`pnpm stt:ab`): replays captured
// utterance-dump WAVs (BINGBONG_AUDIO_DUMP=1 → <userData>/audio-dumps, #34)
// through both STT engines and prints transcript pairs plus per-file latency
// — whisper.cpp with the app's exact config (same model path, initial prompt,
// threads via resolveVoiceConfig) vs Moonshine Base on the app's
// onnxruntime-node stack, fetched into <userData>/models/moonshine-base on
// first run. The go/no-go write-up lives in docs/moonshine-ab.md. Dev tool
// only — nothing in the shipped app path imports any of this. Node runs this
// .ts directly via type stripping (needs Node ≥ 22.18, #36).
//
// Usage:
//   pnpm stt:ab [dumps-dir] [models-dir]
//
// Defaults: ~/.config/bingbong/audio-dumps and ~/.config/bingbong/models.
// With no dumps present the script falls back to the models-dir's jfk.wav
// fixture (same fetch as scripts/measure-stt-latency.mjs).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, availableParallelism, cpus } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import { formatAbReport, type AbRow } from '../src/core/sttAb/abReport.ts'
import { WAV_SAMPLE_RATE } from '../src/core/voice/utteranceDump.ts'
import { parseMoonshineTokenizer } from '../src/core/moonshine/bpeTokenizer.ts'
import { createMoonshineTranscriber } from '../src/main/moonshine/createMoonshineTranscriber.ts'
import { ensureMoonshineModels, fsMoonshineStore } from '../src/main/moonshine/moonshineModels.ts'
import { resolveVoiceConfig } from '../src/main/voice/voiceConfig.ts'

const dumpsDir = process.argv[2] ?? join(homedir(), '.config/bingbong/audio-dumps')
const modelsDir = process.argv[3] ?? join(homedir(), '.config/bingbong/models')

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

// Moonshine Base: fetch missing model files, then load the adapter.
const moonshine = await ensureMoonshineModels(modelsDir, fsMoonshineStore)
for (const name of moonshine.fetched) console.log(`fetched ${name}`)
const vocab = parseMoonshineTokenizer(readFileSync(join(moonshine.dir, 'tokenizer.json'), 'utf8'))
const moonshineTranscriber = createMoonshineTranscriber({
  encoderPath: join(moonshine.dir, 'encoder_model.onnx'),
  decoderPath: join(moonshine.dir, 'decoder_model_merged.onnx'),
  vocab,
})

// Whisper with the app's exact resolution (model path, initial prompt, env overrides).
const voice = resolveVoiceConfig(process.env, join(modelsDir, '..'))
if (!existsSync(voice.whisperModel)) {
  console.error(`whisper model missing: ${voice.whisperModel}`)
  console.error(`fetch it:  curl -L -o '${voice.whisperModel}' https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`)
  process.exit(1)
}
const { Whisper } = await import('smart-whisper')
const threads = Math.max(1, Math.floor(availableParallelism() / 2))
const whisper = new Whisper(voice.whisperModel, { gpu: false, offload: 3600 })

async function whisperTranscribe(pcm: Float32Array): Promise<string> {
  const task = await whisper.transcribe(pcm, {
    language: 'en',
    ...(voice.sttPrompt.trim() ? { initial_prompt: voice.sttPrompt.trim() } : {}),
    n_threads: threads,
    print_progress: false,
    print_realtime: false,
    print_timestamps: false,
  })
  const segments = await task.result
  return segments.map((s) => s.text).join(' ').trim()
}

// Warm both engines (first call pays model load + graph allocation).
const firstPcm = readUtteranceWavPcm(readFileSync(files[0]))
const warmStart = performance.now()
await whisperTranscribe(firstPcm.slice(0, 32_000))
const whisperLoadMs = performance.now() - warmStart
const moonStart = performance.now()
await moonshineTranscriber.transcribe(firstPcm)
const moonshineLoadMs = performance.now() - moonStart

const rows: AbRow[] = []
for (const file of files) {
  const pcm = readUtteranceWavPcm(readFileSync(file))
  const durationSec = pcm.length / WAV_SAMPLE_RATE
  const whisperStart = performance.now()
  const whisperText = await whisperTranscribe(pcm)
  const whisperMs = performance.now() - whisperStart
  const moonshineStart = performance.now()
  const moonshineText = await moonshineTranscriber.transcribe(pcm)
  const moonshineMs = performance.now() - moonshineStart
  rows.push({ file: file.split('/').pop()!, durationSec, whisperText, whisperMs, moonshineText, moonshineMs })
}

console.log('')
console.log(formatAbReport(rows, { dumpsDir }))
console.log('')
console.log(
  `first use (load + warm-up): whisper ${Math.round(whisperLoadMs)}ms | moonshine ${Math.round(moonshineLoadMs)}ms`,
)
console.log(`cpu: ${cpus()[0]?.model} | whisper threads: ${threads} | node ${process.version}`)
console.log('Decision write-up: docs/moonshine-ab.md')

// smart-whisper's native context (and ORT's pool) outlive the report — a CLI
// tool must release them or hang after the last line.
await whisper.free()
process.exit(0)
