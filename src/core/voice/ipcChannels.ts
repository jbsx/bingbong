export const VOICE_IPC = {
  /** Renderer → main: start listening (hotkey or confirmation window). */
  arm: 'voice:arm',
  /** Renderer → main: stop listening. */
  disarm: 'voice:disarm',
  /** Renderer → main: mono 16 kHz PCM chunk (multiple of 512 samples). */
  audio: 'voice:audio',
  /** Main → renderer: listening state changes. */
  stateChanged: 'voice:stateChanged',
  /** Main → renderer: a transcript was heard and where it went. */
  heard: 'voice:heard',
  /** Main → renderer: the voice pipeline failed (surfaced next to the orb). */
  error: 'voice:error',
} as const

export type VoiceListenReason = 'hotkey' | 'confirmation'

export interface VoiceState {
  listening: boolean
  reason: VoiceListenReason | null
}

export interface VoiceHeardEvent {
  text: string
  routed: 'command' | 'confirmation' | 'ignored'
}
