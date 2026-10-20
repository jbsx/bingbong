export const VOICE_IPC = {
  /** Renderer → main: start listening (hotkey). */
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
  /** Main → renderer: the live partial transcript while the user speaks (#324); '' clears it. */
  partial: 'voice:partial',
  /** Main → renderer: the voice pipeline failed (surfaced next to the orb). */
  error: 'voice:error',
} as const

export type VoiceListenReason = 'hotkey' | 'wake'

export interface VoiceState {
  listening: boolean
  reason: VoiceListenReason | null
  /** Wake-word monitoring is live — the mic stays open even while not listening. */
  monitoring: boolean
  /**
   * The endpoint fired: a finished utterance is being transcribed (#38).
   * `listening` is false for the whole STT window — the UI must not claim
   * the ear is open while it thinks.
   */
  transcribing: boolean
}

export interface VoiceHeardEvent {
  text: string
  routed: 'command' | 'abort' | 'ignored'
  /** Main stamps this before IPC; core session tests may omit it. */
  at?: number
}

export interface VoiceErrorEvent {
  message: string
  at: number
}

/** The live partial transcript (#324): what the Status Capsule or the Voice Prompt (#359) shows while the user speaks. */
export interface VoicePartialEvent {
  text: string
  at: number
  /** The Page Terms in force (ADR 0077), for the Voice Prompt to mark the ones the words carry. */
  terms?: readonly string[]
}
