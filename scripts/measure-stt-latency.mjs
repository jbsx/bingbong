#!/usr/bin/env node
// T9 validation gate: measure whisper STT latency on this CPU and report the
// numbers behind the model-size decision (docs/stt-latency.md).
//
// Usage:
//   node scripts/measure-stt-latency.mjs [models-dir]
//
// Models-dir defaults to ~/.config/bingbong/models (where the app looks).
// Expects ggml-base.en.bin and ggml-tiny.en.bin plus sample-en.wav (fetched
// automatically on first run from the whisper.cpp repo).

import { existsSync, readFileSync } from 'node:fs'
import { homedir, availableParallelism } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const modelsDir = process.argv[2] ?? join(homedir(), '.config/bingbong/models')
const samplePath = join(modelsDir, 'sample-en.wav')
const sampleUrl = 'https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav'
const models = ['ggml-tiny.en.bin', 'ggml-base.en.bin']
const durations = [2, 5, 10]
// Same default the app's transcriber adapter uses: physical cores.
const threads = Math.max(1, Math.floor(availableParallelism() / 2))

function pcmFromWav(buffer) {
  const dataOffset = buffer.indexOf(Buffer.from('data'))
  const samples = buffer.subarray(dataOffset + 8)
  const pcm = new Float32Array(samples.length / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = samples.readInt16LE(i * 2) / 32768
  return pcm
}

function sampleOf(durationSec, source) {
  const need = Math.round(durationSec * 16000)
  const out = new Float32Array(need)
  // Repeat/trim the sample to the requested duration.
  for (let i = 0; i < need; i++) out[i] = source[i % source.length]
  return out
}

if (!existsSync(samplePath)) {
  console.error(`sample missing: ${samplePath}`)
  console.error(`fetch it first:  curl -L -o '${samplePath}' ${sampleUrl}`)
  process.exit(1)
}
const sample = pcmFromWav(readFileSync(samplePath))

const { Whisper } = await import('smart-whisper')

console.log(`models dir: ${modelsDir}`)
console.log(`threads: ${threads}`)
console.log('')
for (const model of models) {
  const path = join(modelsDir, model)
  if (!existsSync(path)) {
    console.log(`${model}: not found, skipped`)
    continue
  }

  const loadStart = performance.now()
  const whisper = new Whisper(path, { gpu: false, offload: 3600 })
  await whisper.load()
  const loadMs = performance.now() - loadStart

  // Warm-up decode (first call pays encoder graph allocation).
  await (await whisper.transcribe(sampleOf(2, sample), { language: "en", n_threads: threads })).result

  const cells = [`load ${Math.round(loadMs)}ms (first use only)`]
  for (const duration of durations) {
    const pcm = sampleOf(duration, sample)
    const start = performance.now()
    await (await whisper.transcribe(pcm, { language: "en", n_threads: threads })).result
    const ms = performance.now() - start
    cells.push(`${duration}s → ${Math.round(ms)}ms (${((duration * 1000) / ms).toFixed(1)}x realtime)`)
  }
  console.log(`${model}: ${cells.join(' | ')}`)
  await whisper.free()
}
console.log('')
console.log('Decision recorded in docs/stt-latency.md.')
