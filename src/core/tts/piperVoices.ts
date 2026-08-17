// Piper voice models live as `<voice>.onnx` (+ `<voice>.onnx.json` config) in
// the voices dir. Ids are the filename without the extension; a bare id like
// the default resolves to its quality-suffixed file.

export const DEFAULT_PIPER_VOICE = 'en_US-ryan'
export const DEFAULT_PIPER_SAMPLE_RATE = 22050

const MODEL_SUFFIX = '.onnx'

/**
 * Find the model file for a voice id: exact match first, then `<id>-*`
 * quality variants with medium preferred, otherwise the alphabetically first.
 */
export function resolveVoiceFile(files: string[], voiceId: string): string | null {
  const exact = `${voiceId}${MODEL_SUFFIX}`
  if (files.includes(exact)) return exact

  const variants = files
    .filter((file) => file.startsWith(`${voiceId}-`) && file.endsWith(MODEL_SUFFIX))
    .sort()
  return variants.find((file) => file.includes('-medium')) ?? variants[0] ?? null
}

/** Installed voice ids, for the settings picker. */
export function voiceIdsFromFiles(files: string[]): string[] {
  return files
    .filter((file) => file.endsWith(MODEL_SUFFIX))
    .map((file) => file.slice(0, -MODEL_SUFFIX.length))
    .sort()
}

/** `audio.sample_rate` from the voice's .onnx.json; default when unreadable. */
export function sampleRateFromVoiceConfig(config: unknown): number {
  if (typeof config !== 'object' || config === null) return DEFAULT_PIPER_SAMPLE_RATE
  const audio = (config as { audio?: unknown }).audio
  if (typeof audio !== 'object' || audio === null) return DEFAULT_PIPER_SAMPLE_RATE
  const rate = (audio as { sample_rate?: unknown }).sample_rate
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PIPER_SAMPLE_RATE
}
