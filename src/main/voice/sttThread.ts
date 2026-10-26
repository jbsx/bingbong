import { parentPort, Worker, workerData } from 'node:worker_threads'
import type { Transcriber } from '../../core/ports/stt'
import type { ChainBias, FromVoiceChain } from '../../core/voice/voiceChain'
import { reportFault, setFaultSink } from '../../core/trace/fault'
import { setModelLoadSink } from '../perf/modelLoads'
import { createMainVoiceTranscriber } from './createMainVoice'
import type { VoiceConfig } from './voiceConfig'

// The STT engine on a thread of its own inside the voice process (#430): one
// thread for the whole chain let the Parakeet load at boot hold the VAD and
// the wake trio for 1.8–3.4 s and a pass hold the turn check, measured worse
// than this. The voice process talks to it through a Transcriber; this file
// is both the thread's entry and that Transcriber. Its faults and model
// loads are relayed through the voice process to main's logs.

type ToStt =
  | { type: 'init'; config: VoiceConfig; bias: ChainBias | null }
  | { type: 'begin' }
  | { type: 'push'; frame: Float32Array }
  | { type: 'cancel' }
  | { type: 'finish'; id: number; pcm: Float32Array }
  | { type: 'prepare'; id: number }
  | { type: 'bias'; bias: ChainBias | null }

type FromStt =
  | { type: 'partial'; text: string }
  | { type: 'done'; id: number; text?: string; error?: string }
  | { type: 'relay'; message: FromVoiceChain }

/** The voice process's side: a Transcriber whose engine runs on the STT thread. */
export function createThreadTranscriber(entry: string, config: VoiceConfig, bias: () => ChainBias | null, relay: (message: FromVoiceChain) => void): Transcriber {
  const worker = new Worker(entry, { name: 'bingbong-stt', workerData: { sttThread: true } })
  const listeners = new Set<(text: string) => void>()
  const waiting = new Map<number, { resolve(text: string): void; reject(error: Error): void }>()
  let seq = 0
  let sent = bias()
  worker.postMessage({ type: 'init', config, bias: sent } satisfies ToStt)
  const syncBias = (): void => {
    const now = bias()
    if (now === sent) return
    sent = now
    worker.postMessage({ type: 'bias', bias: now } satisfies ToStt)
  }
  worker.on('message', (message: FromStt) => {
    if (message.type === 'partial') for (const listener of listeners) listener(message.text)
    else if (message.type === 'relay') relay(message.message)
    else {
      const waiter = waiting.get(message.id)
      waiting.delete(message.id)
      if (message.error !== undefined) waiter?.reject(new Error(message.error))
      else waiter?.resolve(message.text ?? '')
    }
  })
  // A dead STT thread takes the voice process with it: main reports that as a fault and starts the whole chain again.
  const died = (detail: string): void => {
    reportFault('voice.sttThread.exit', new Error(`the STT thread ended: ${detail}`))
    for (const waiter of waiting.values()) waiter.reject(new Error('the STT thread ended'))
    waiting.clear()
    process.exit(1)
  }
  worker.on('error', (error: unknown) => died(error instanceof Error ? error.message : String(error)))
  worker.on('exit', (code) => died(`exited with code ${String(code)}`))
  const ask = (build: (id: number) => ToStt): Promise<string> => {
    seq += 1
    const id = seq
    const done = new Promise<string>((resolve, reject) => waiting.set(id, { resolve, reject }))
    worker.postMessage(build(id))
    return done
  }
  return {
    engine: config.sttEngine,
    begin: () => {
      syncBias()
      worker.postMessage({ type: 'begin' } satisfies ToStt)
    },
    push: (frame) => worker.postMessage({ type: 'push', frame } satisfies ToStt),
    onPartial(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    finish: (pcm) => {
      syncBias()
      return ask((id) => ({ type: 'finish', id, pcm }))
    },
    cancel: () => worker.postMessage({ type: 'cancel' } satisfies ToStt),
    prepare: async () => {
      await ask((id) => ({ type: 'prepare', id }))
    },
  }
}

// The thread's own side.
if (parentPort !== null && (workerData as { sttThread?: boolean } | null)?.sttThread === true) {
  const port = parentPort
  const post = (message: FromStt): void => port.postMessage(message)
  setFaultSink((report) => post({ type: 'relay', message: { type: 'fault', report } }))
  setModelLoadSink((load) => post({ type: 'relay', message: { type: 'modelLoad', load: { model: load.model, durMs: load.durMs, failed: load.failed } } }))
  let bias: ChainBias | null = null
  let transcriber: Transcriber | null = null
  const reply = (id: number, work: Promise<string>): void => {
    work.then(
      (text) => post({ type: 'done', id, text }),
      (error: unknown) => post({ type: 'done', id, error: error instanceof Error ? error.message : String(error) }),
    )
  }
  port.on('message', (message: ToStt) => {
    if (message.type === 'init') {
      bias = message.bias
      transcriber = createMainVoiceTranscriber(message.config, () => bias ?? [])
      transcriber.onPartial((text) => post({ type: 'partial', text }))
      return
    }
    if (transcriber === null) return
    if (message.type === 'bias') bias = message.bias
    else if (message.type === 'begin') transcriber.begin()
    else if (message.type === 'push') transcriber.push(message.frame)
    else if (message.type === 'cancel') transcriber.cancel()
    else if (message.type === 'finish') reply(message.id, transcriber.finish(message.pcm))
    else reply(message.id, (transcriber.prepare?.() ?? Promise.resolve()).then(() => ''))
  })
}
