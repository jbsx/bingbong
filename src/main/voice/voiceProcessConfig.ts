import type { WakeConfig } from '../wake/wakeConfig'
import type { VoiceConfig } from './voiceConfig'

/** The voice process's name in Electron's process metrics: the CPU sample reads its memory apart from the other utilities' (#451). */
export const VOICE_SERVICE_NAME = 'bingbong-voice'

/** What the voice process (#430) builds its models from: resolved in main from the boot env and Settings, sent at every start. */
export interface VoiceProcessConfig {
  voice: VoiceConfig
  wake: WakeConfig
  /** The utterance dumps (#34): written by the voice process, where the audio is. */
  dumps: { dir: string; enabled: boolean }
}
