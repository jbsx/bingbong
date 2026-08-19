import { availableParallelism } from 'node:os'
import type { Transcriber } from '../../core/ports/stt'
import { finalOnlyTranscriber } from '../../core/voice/finalOnlyTranscriber'

/**
 * smart-whisper (whisper.cpp) transcription, CPU-only per the target
 * hardware. The model loads lazily on the first utterance and stays warm
 * (offload disabled), so the first spoken command pays the load cost, not
 * every one. English-only .en models per the spec. A batch engine behind the
 * streaming port (#40): no partials, the whole utterance transcribes at the
 * endpoint.
 */

interface WhisperLike {
  transcribe(
    pcm: Float32Array,
    params?: Record<string, unknown>,
  ): Promise<{ result: Promise<Array<{ text: string }>> }>
  free(): Promise<void>
}

export interface SmartWhisperDeps {
  modelPath: string
  /** Vocabulary biasing passed as whisper's initial_prompt; skips the param when empty. */
  initialPrompt?: string
  /** Injectable for tests; defaults to the smart-whisper import. */
  loadLib?: () => Promise<{ Whisper: new (file: string, config?: Record<string, unknown>) => WhisperLike }>
  threads?: number
}

export function createSmartWhisperTranscriber(deps: SmartWhisperDeps): Transcriber {
  // whisper.cpp saturates on physical cores — half the SMT count measured
  // fastest on the 5600G (see docs/stt-latency.md).
  const threads = deps.threads ?? Math.max(1, Math.floor(availableParallelism() / 2))
  const loadLib =
    deps.loadLib ??
    (async () => {
      const lib = await import('smart-whisper')
      return { Whisper: lib.Whisper as unknown as new (file: string, config?: Record<string, unknown>) => WhisperLike }
    })
  let whisperReady: Promise<WhisperLike> | null = null

  function ensureWhisper(): Promise<WhisperLike> {
    whisperReady ??= loadLib().then((lib) => {
      const whisper = new lib.Whisper(deps.modelPath, { gpu: false, offload: 3600 })
      return whisper
    })
    return whisperReady
  }

  return finalOnlyTranscriber(async (pcm) => {
    const whisper = await ensureWhisper()
    const task = await whisper.transcribe(pcm, {
      language: 'en',
      ...(deps.initialPrompt?.trim() ? { initial_prompt: deps.initialPrompt.trim() } : {}),
      n_threads: threads,
      print_progress: false,
      print_realtime: false,
      print_timestamps: false,
    })
    const segments = await task.result
    return segments
      .map((segment) => segment.text)
      .join(' ')
      .trim()
  })
}
