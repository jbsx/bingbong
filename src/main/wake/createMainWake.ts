import type { WakeWordDetector } from '../../core/ports/wake'
import type { WakeConfig } from './wakeConfig'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'
import { createPythonWakeDetector } from './createPythonWakeDetector'
import { createScriptedWake } from './createScriptedWake'

/**
 * Composition root for the wake word (T10): the ONNX trio in-process by
 * default, the Python reference sidecar behind the same seam as the fallback,
 * and a scripted double for e2e — selected purely by config. Returns null
 * when the engine is 'off' (hotkey-only mode).
 */
export function createMainWake(config: WakeConfig): WakeWordDetector | null {
  if (config.engine === 'off') return null
  if (config.wakeScript) return createScriptedWake(config.wakeScript)
  if (config.engine === 'python') {
    return createPythonWakeDetector({
      pythonBin: config.pythonBin,
      scriptPath: config.sidecarScript,
      classifierModelPath: config.classifierModel,
    })
  }
  return createOpenWakeWordDetector({
    melspecModelPath: config.melspecModel,
    embeddingModelPath: config.embeddingModel,
    classifierModelPath: config.classifierModel,
  })
}
