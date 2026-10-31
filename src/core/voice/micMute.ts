import type { VoiceState } from './ipcChannels'

/**
 * The ear as the screen is shown it under the Mic Mute: shut, whatever the
 * session is doing, so the Voice Prompt and the capsule say "Microphone
 * off" and never invite speech, and the renderer closes the microphone
 * (it opens only for a listen, a read or a monitor). A cold ear's wait is
 * not shown either: nothing said would be heard however it ends.
 */
export function micMutedState(state: VoiceState): VoiceState {
  const shown: VoiceState = { ...state, listening: false, reason: null, monitoring: false, transcribing: false, hearing: false, micMuted: true }
  delete shown.loading
  delete shown.since
  delete shown.captureFailed
  delete shown.speaking
  return shown
}
