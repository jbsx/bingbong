import { createVoiceChainHost, type FromVoiceChain, type ToVoiceChain } from '../../core/voice/voiceChain'
import { createUtteranceDumper } from '../../core/voice/utteranceDump'
import { setFaultSink } from '../../core/trace/fault'
import { setModelLoadSink } from '../perf/modelLoads'
import { createMainWake } from '../wake/createMainWake'
import { createMainVoice } from './createMainVoice'
import { fsUtteranceDumpWriter } from './utteranceDumpWriter'
import type { VoiceProcessConfig } from './voiceProcessConfig'
import { createThreadTranscriber } from './sttThread'
import { join } from 'node:path'

// The voice process (#430): every voice model — Silero VAD, the openWakeWord
// trio, Smart Turn and the STT engine — and the voice session over them run
// here, off Electron's main thread (the STT engine on a thread of its own,
// sttThread.ts), and main only routes the mic's frames in and
// the session's results out (src/core/voice/voiceChain.ts). Its faults and
// model loads go to main's logs; it has none of its own.

const parent = process.parentPort
const port = {
  post: (message: FromVoiceChain): void => parent.postMessage(message),
  listen: (handler: (message: ToVoiceChain<VoiceProcessConfig>) => void): void => {
    parent.on('message', (event: Electron.MessageEvent) => handler(event.data as ToVoiceChain<VoiceProcessConfig>))
  },
}
setFaultSink((report) => port.post({ type: 'fault', report }))
setModelLoadSink((load) => port.post({ type: 'modelLoad', load: { model: load.model, durMs: load.durMs, failed: load.failed } }))

const host = createVoiceChainHost<VoiceProcessConfig>({
  send: (message) => port.post(message),
  epochNow: () => performance.timeOrigin + performance.now(),
  async build(config, bias) {
    // The STT engine runs on a thread of its own (#430): a Parakeet pass or
    // its load never holds the VAD, the wake trio or the turn check. A
    // scripted engine (e2e) has nothing to hold them with and stays here.
    const sttElsewhere =
      config.voice.sttScript === undefined
        ? createThreadTranscriber(join(import.meta.dirname, 'sttThread.js'), config.voice, bias, (message) => port.post(message))
        : undefined
    const voice = await createMainVoice(config.voice, () => bias() ?? [], sttElsewhere)
    return {
      ...voice,
      wake: createMainWake(config.wake),
      dumper: createUtteranceDumper({ dir: config.dumps.dir, writer: fsUtteranceDumpWriter, enabled: config.dumps.enabled }),
    }
  },
})
port.listen((message) => host.receive(message))
