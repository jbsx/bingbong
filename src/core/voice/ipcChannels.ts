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
  /** Renderer → main: a wake listen's Listening has painted (#429). */
  listeningShown: 'voice:listeningShown',
  /** Renderer → main: the hearing receipt has painted (#441). */
  hearingShown: 'voice:hearingShown',
  /** Main → renderer: a transcript was heard and where it went. */
  heard: 'voice:heard',
  /** Main → renderer: the live partial transcript while the user speaks (#324); '' clears it. */
  partial: 'voice:partial',
  /** Main → renderer: the voice pipeline failed (surfaced next to the orb). */
  error: 'voice:error',
  /** Renderer → main: flip the Mic Mute (the button beside the settings cog); resolves with the new state. */
  toggleMic: 'voice:toggleMic',
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
  /**
   * Speech has started in the Utterance being taken (#441): set on the VAD
   * frame its capture begins, cleared at its Endpoint or a drop. Only ever
   * true while `listening` is, so the screen can say the ear has the line
   * before the first partial lands.
   */
  hearing: boolean
  /**
   * The app's own voice is playing (#472), main's to say from the speaking
   * gate: an Utterance started now is dropped as the app's own (#326), so an
   * open ear that has heard nothing is shown at rest — only the wake word,
   * which cuts the speech, is heard. Absent while nothing is said.
   */
  speaking?: boolean
  /** The ear hears the person over the app's voice inside a listen (#490), main's to say beside `speaking`: the open ear still listens. */
  overSpeech?: boolean
  /**
   * What the ear still waits for at its cold start (#442), main's to say:
   * `ear` until the models it hears with are in, so nothing said is heard;
   * `words` from then until the transcriber is, so a line taken is held;
   * `failed` once one of them did not load (#447), the wait ended, until a
   * retry brings it in. Absent once nothing is loading.
   */
  loading?: EarLoading
  /** When the ear's phase began, on main's wall clock (#442): the screen counts a wait's seconds from it on its own. */
  since?: number
  /**
   * The Mic Mute is on: the ear is shown shut — not listening, monitoring
   * or transcribing, so every surface says "Microphone off" — and the
   * renderer releases the microphone. Absent while it is off.
   */
  micMuted?: boolean
}

/** What a cold ear waits for (#442): the models that hear, then the one that reads the words — or that one of them failed (#447). */
export type EarLoading = 'ear' | 'words' | 'failed'

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
