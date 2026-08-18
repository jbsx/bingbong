export const VOICE_IPC = {
  /** Renderer → main: start listening (hotkey or confirmation window). */
  arm: 'voice:arm',
  /** Renderer → main: stop listening. */
  disarm: 'voice:disarm',
  /** Renderer → main: mono 16 kHz PCM chunk (multiple of 512 samples). */
  audio: 'voice:audio',
  /** Renderer → main: current voice state (monitoring starts before the renderer subscribes). */
  getState: 'voice:getState',
  /** Main → renderer: listening state changes. */
  stateChanged: 'voice:stateChanged',
  /** Main → renderer: a transcript was heard and where it went. */
  heard: 'voice:heard',
  /** Main → renderer: the voice pipeline failed (surfaced next to the orb). */
  error: 'voice:error',
} as const

export type VoiceListenReason = 'hotkey' | 'confirmation' | 'ask' | 'wake' | 'pause'

export interface VoiceState {
  listening: boolean
  reason: VoiceListenReason | null
  /** Wake-word monitoring is live — the mic stays open even while not listening. */
  monitoring: boolean
}

export interface VoiceHeardEvent {
  text: string
  routed: 'command' | 'confirmation' | 'ask' | 'abort' | 'pause' | 'resume' | 'steering' | 'ignored'
  /** Main stamps this before persistence + IPC; core session tests may omit it. */
  at?: number
}

export interface VoiceErrorEvent {
  message: string
  /** Shared by persistence and renderer hydration deduplication. */
  at: number
}
