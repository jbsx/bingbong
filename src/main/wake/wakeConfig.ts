import { join } from 'node:path'

export type WakeEngine = 'node' | 'python' | 'off'

export interface WakeConfig {
  /** 'node' runs the ONNX trio in-process; 'python' spawns the reference sidecar; 'off' hotkey-only. */
  engine: WakeEngine
  melspecModel: string
  embeddingModel: string
  /** The three Colab-trained heads: "bing bong" wakes, "abort" cancels, "hold on" pauses. */
  wakeModel: string
  abortModel: string
  holdOnModel: string
  pythonBin: string
  sidecarScript: string
  /** Scripted scores (e2e double), mirroring BINGBONG_VAD_SCRIPT. */
  wakeScript?: string
}

export function resolveWakeConfig(env: Record<string, string | undefined>, userDataDir: string, appDir: string): WakeConfig {
  const engineRaw = env.BINGBONG_WAKE_ENGINE?.trim() || 'node'
  if (engineRaw !== 'node' && engineRaw !== 'python' && engineRaw !== 'off') {
    throw new Error(`BINGBONG_WAKE_ENGINE must be node, python, or off — got '${engineRaw}'`)
  }
  const modelsDir = join(userDataDir, 'models')
  return {
    engine: engineRaw,
    melspecModel: env.BINGBONG_WAKE_MELSPEC_MODEL?.trim() || join(modelsDir, 'melspectrogram.onnx'),
    embeddingModel: env.BINGBONG_WAKE_EMBEDDING_MODEL?.trim() || join(modelsDir, 'embedding_model.onnx'),
    wakeModel: env.BINGBONG_WAKE_MODEL?.trim() || join(modelsDir, 'wake', 'bing_bong.onnx'),
    abortModel: env.BINGBONG_WAKE_ABORT_MODEL?.trim() || join(modelsDir, 'wake', 'stop_now.onnx'),
    holdOnModel: env.BINGBONG_WAKE_HOLD_ON_MODEL?.trim() || join(modelsDir, 'wake', 'hold_on.onnx'),
    pythonBin: env.BINGBONG_WAKE_PYTHON_BIN?.trim() || 'python3',
    sidecarScript: env.BINGBONG_WAKE_SIDECAR_SCRIPT?.trim() || join(appDir, 'scripts', 'wake_sidecar.py'),
    wakeScript: env.BINGBONG_WAKE_SCRIPT?.trim() || undefined,
  }
}
