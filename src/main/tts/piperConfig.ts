import { join } from 'node:path'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'
import { shouldMuteAudio } from '../muteOffScreen'
import { installedPiperBin, piperReleaseFor, type PiperInstallPlan } from './piperInstall'

export interface PiperConfig {
  /** Piper executable: BINGBONG_PIPER_BIN, else the one the app installs, else piper on PATH. */
  bin: string
  /** Dir holding `<voice>.onnx` + `<voice>.onnx.json` files. */
  voicesDir: string
  /** Base voice; the settings page's ttsVoice overrides this at speak time. */
  voiceId: string
  /** The player spoken text streams into (#327); default aplay on PATH. The TTS e2e scripts it. */
  playerBin: string
  /** The player's ALSA device: 'null' when the run is muted (tests, agents), else aplay's default. */
  playerDevice?: string
  /** What the first launch downloads (#419): the binary unless it is one's own, and the default voice. */
  install: PiperInstallPlan
}

export function resolvePiperConfig(
  env: Record<string, string | undefined>,
  userDataDir: string,
  machine: { platform: string; arch: string } = { platform: process.platform, arch: process.arch },
): PiperConfig {
  const ownBin = env.BINGBONG_PIPER_BIN?.trim() || undefined
  const piperDir = join(userDataDir, 'piper')
  const voicesDir = env.BINGBONG_PIPER_VOICE_DIR?.trim() || join(userDataDir, 'voices')
  const release = ownBin === undefined ? piperReleaseFor(machine.platform, machine.arch) : null
  return {
    bin: ownBin ?? (release === null ? 'piper' : installedPiperBin(piperDir)),
    voicesDir,
    voiceId: env.BINGBONG_PIPER_VOICE?.trim() || DEFAULT_PIPER_VOICE,
    playerBin: env.BINGBONG_APLAY_BIN?.trim() || 'aplay',
    ...(shouldMuteAudio(env) ? { playerDevice: 'null' } : {}),
    install: { piperDir, voicesDir, release },
  }
}
