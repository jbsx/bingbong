#!/usr/bin/env node
// The ear's CPU at rest (#435, `pnpm wake:cpu`): the shipped Silero VAD,
// wake monitor and openWakeWord stack, fed audio at the app's mic cadence
// (2048-sample frames) as fast as they score it, and the process CPU each
// second of audio costs. Two arms: `gated`, the ear as it ships (the wake
// stack runs only while the VAD gate is open), and `ungated`, the ear before
// #435 (the detector's skip hidden, every head scored on every chunk). The
// arms interleave, so a run is compared against its neighbour, not against
// a CPU that has since boosted. Node runs this .ts directly via type
// stripping (Node >= 22.18), so .ts-extension imports here and on the
// runtime graph.
//
// Usage:
//   pnpm wake:cpu [--seconds 30] [--repeat 3] [--arm gated|ungated|both] [--wav-dir <dir>]
//
// Audio: `silence` (digital zero), `noise` (a seeded hiss at about -60 dBFS,
// a quiet room), and with --wav-dir every .wav in it (16 kHz mono s16le),
// each line padded with 1.5 s of silence, as the ear hears a line out of a
// quiet room.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { WakeWordDetector } from '../src/core/ports/wake.ts'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import { createWakeMonitor } from '../src/core/voice/wakeMonitor.ts'
import { createSileroVad } from '../src/main/voice/createSileroVad.ts'
import { createOpenWakeWordDetector } from '../src/main/wake/createOpenWakeWordDetector.ts'

const { values } = parseArgs({
  options: {
    seconds: { type: 'string', default: '30' },
    repeat: { type: 'string', default: '3' },
    arm: { type: 'string', default: 'both' },
    'wav-dir': { type: 'string' },
    models: { type: 'string', default: join(import.meta.dirname, '../models') },
  },
})
const RATE = 16_000
const PUSH_SAMPLES = 2048
const seconds = Number(values.seconds)
const repeat = Number(values.repeat)
const arms = values.arm === 'both' ? (['ungated', 'gated'] as const) : ([values.arm] as ('gated' | 'ungated')[])
const modelsDir = values.models

function hiss(samples: number): Float32Array {
  const out = new Float32Array(samples)
  let x = 1
  for (let i = 0; i < out.length; i++) {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648
    out[i] = (x / 2_147_483_648 - 0.5) * 0.002
  }
  return out
}

function wavLines(dir: string): Float32Array {
  const pad = new Float32Array(1.5 * RATE)
  const parts = readdirSync(dir)
    .filter((name) => name.endsWith('.wav'))
    .sort()
    .flatMap((name) => [pad, readUtteranceWavPcm(readFileSync(join(dir, name)))])
  parts.push(pad)
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const sources: [string, Float32Array][] = [
  ['silence', new Float32Array(seconds * RATE)],
  ['noise', hiss(seconds * RATE)],
]
if (values['wav-dir']) sources.push(['lines', wavLines(values['wav-dir'])])

interface Reading {
  msPerSecond: number
  heard: number
  scored: number
}

async function measure(arm: 'gated' | 'ungated', audio: Float32Array): Promise<Reading> {
  const inner = createOpenWakeWordDetector({
    melspecModelPath: join(modelsDir, 'melspectrogram.onnx'),
    embeddingModelPath: join(modelsDir, 'embedding_model.onnx'),
    headModelPaths: {
      wake: join(modelsDir, 'wake', 'bing_bong.onnx'),
      abort: join(modelsDir, 'wake', 'stop_now.onnx'),
      holdOn: join(modelsDir, 'wake', 'hold_on.onnx'),
    },
  })
  let heard = 0
  let scored = 0
  const detector: WakeWordDetector = {
    // Ungated is the ear before #435: every head, every chunk.
    score: (chunk) => {
      heard += 1
      scored += 1
      return inner.score(chunk)
    },
    reset: () => inner.reset(),
    ...(arm === 'gated'
      ? {
          skip: (chunk: Float32Array) => {
            heard += 1
            inner.skip!(chunk)
          },
        }
      : {}),
  }
  const monitor = createWakeMonitor({
    vad: await createSileroVad({ modelPath: join(modelsDir, 'silero_vad.onnx') }),
    detector,
    getThreshold: () => 0.5,
    onWake: () => monitor.reset(),
    onAbort: () => {},
    onError: (message) => {
      throw new Error(message)
    },
  })
  // The models load and warm on a second of speech-free audio before the clock starts.
  for (let at = 0; at + PUSH_SAMPLES <= RATE; at += PUSH_SAMPLES) await monitor.pushAudio(new Float32Array(PUSH_SAMPLES))
  monitor.reset()
  heard = 0
  scored = 0
  const start = process.cpuUsage()
  for (let at = 0; at + PUSH_SAMPLES <= audio.length; at += PUSH_SAMPLES) await monitor.pushAudio(audio.slice(at, at + PUSH_SAMPLES))
  const used = process.cpuUsage(start)
  const cpuMs = (used.user + used.system) / 1000
  return { msPerSecond: cpuMs / (audio.length / RATE), heard, scored }
}

console.log(`wake:cpu — ${String(seconds)} s each, ${String(repeat)} interleaved runs, ms of process CPU per s of audio`)
for (const [name, audio] of sources) {
  const readings: Record<string, Reading[]> = {}
  for (let r = 0; r < repeat; r++) for (const arm of arms) (readings[arm] ??= []).push(await measure(arm, audio))
  for (const arm of arms) {
    const runs = readings[arm]
    const ms = runs.map((run) => run.msPerSecond.toFixed(1)).join(' / ')
    const { heard, scored } = runs[0]
    console.log(`${name.padEnd(10)} ${arm.padEnd(8)} ${ms} ms/s   wake chunks scored ${String(scored)} of ${String(heard)}`)
  }
}
