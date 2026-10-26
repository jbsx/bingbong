import { utilityProcess } from 'electron'
import type { ToVoiceChain, VoiceChainEvents, VoiceChainLink } from '../../core/voice/voiceChain'
import type { VoiceProcessConfig } from './voiceProcessConfig'

// Starts the voice process (#430) behind the chain's link: an Electron
// utility process, so the native ONNX runtime's memory and any crash of it
// stay out of the app's main process (owner's ruling, 2026-10-26; against a
// worker thread the spans measured a tie and the worker held ~95 MB less).

export function voiceProcessStarter(entry: string) {
  return (events: VoiceChainEvents): VoiceChainLink<VoiceProcessConfig> => {
    let stopped = false
    const child = utilityProcess.fork(entry, [], { serviceName: 'bingbong-voice' })
    child.on('message', (message) => events.message(message))
    child.on('exit', (code) => {
      if (!stopped) events.exit(`exited with code ${String(code)}`)
    })
    return {
      post: (message: ToVoiceChain<VoiceProcessConfig>) => child.postMessage(message),
      stop() {
        stopped = true
        child.kill()
      },
    }
  }
}
