import { join } from 'node:path'

export type WakeEngine = 'node' | 'python' | 'off'

export interface WakeConfig {
  /** 'node' runs the ONNX trio in-process; 'python' spawns the reference sidecar; 'off' hotkey-only. */
  engine: WakeEngine
  melspecModel: string
  embeddingModel: string
  /** The three Colab-trained heads: "bing bong" wakes, "abort" cancels, "hold on" is scored but unwired (ADR 0024). */
  wakeModel: string
  abortModel: string
  holdOnModel: string
  pythonBin: string
  sidecarScript: string
  /** Scripted scores (e2e double), mirroring BINGBONG_VAD_SCRIPT. */
  wakeScript?: string
}

/** Where the shipped wake models and the sidecar script sit: inside the package, outside its archive (ADR 0090). */
export interface WakeDirs {
  bundledModelsDir: string
  scriptsDir: string
}

export function resolveWakeConfig(env: Record<string, string | undefined>, dirs: WakeDirs): WakeConfig {
  const engineRaw = env.BINGBONG_WAKE_ENGINE?.trim() || 'node'
  if (engineRaw !== 'node' && engineRaw !== 'python' && engineRaw !== 'off') {
    throw new Error(`BINGBONG_WAKE_ENGINE must be node, python, or off — got '${engineRaw}'`)
  }
  // The front end and the heads ship with the app and are read in place, never copied to the profile.
  const modelsDir = dirs.bundledModelsDir
  return {
    engine: engineRaw,
    melspecModel: env.BINGBONG_WAKE_MELSPEC_MODEL?.trim() || join(modelsDir, 'melspectrogram.onnx'),
    embeddingModel: env.BINGBONG_WAKE_EMBEDDING_MODEL?.trim() || join(modelsDir, 'embedding_model.onnx'),
    wakeModel: env.BINGBONG_WAKE_MODEL?.trim() || join(modelsDir, 'wake', 'bing_bong.onnx'),
    abortModel: env.BINGBONG_WAKE_ABORT_MODEL?.trim() || join(modelsDir, 'wake', 'stop_now.onnx'),
    holdOnModel: env.BINGBONG_WAKE_HOLD_ON_MODEL?.trim() || join(modelsDir, 'wake', 'hold_on.onnx'),
    pythonBin: env.BINGBONG_WAKE_PYTHON_BIN?.trim() || 'python3',
    sidecarScript: env.BINGBONG_WAKE_SIDECAR_SCRIPT?.trim() || join(dirs.scriptsDir, 'wake_sidecar.py'),
    wakeScript: env.BINGBONG_WAKE_SCRIPT?.trim() || undefined,
  }
}
