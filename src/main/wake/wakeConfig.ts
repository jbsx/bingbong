import { join } from 'node:path'

export type WakeEngine = 'node' | 'python' | 'off'

export interface WakeConfig {
  /** 'node' runs the ONNX trio in-process; 'python' spawns the reference sidecar; 'off' hotkey-only. */
  engine: WakeEngine
  melspecModel: string
  embeddingModel: string
  /** Interim hey_jarvis_v0.1.onnx; point at a custom bing_bong model once trained. */
  classifierModel: string
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
    classifierModel: env.BINGBONG_WAKE_CLASSIFIER_MODEL?.trim() || join(modelsDir, 'hey_jarvis_v0.1.onnx'),
    pythonBin: env.BINGBONG_WAKE_PYTHON_BIN?.trim() || 'python3',
    sidecarScript: env.BINGBONG_WAKE_SIDECAR_SCRIPT?.trim() || join(appDir, 'scripts', 'wake_sidecar.py'),
    wakeScript: env.BINGBONG_WAKE_SCRIPT?.trim() || undefined,
  }
}
