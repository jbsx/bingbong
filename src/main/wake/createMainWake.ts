import type { WakeWordDetector } from '../../core/ports/wake'
import type { WakeConfig } from './wakeConfig'
import { createOpenWakeWordDetector } from './createOpenWakeWordDetector'
import { createPythonWakeDetector } from './createPythonWakeDetector'
import { createScriptedWake } from './createScriptedWake'

/**
 * Composition root for the wake word: the shared ONNX feature stack plus the
 * three heads ("bing bong" / "abort" / "hold on") in-process by default, the
 * Python reference sidecar (wake head only) behind the same seam as the
 * fallback, and a scripted double for e2e — selected purely by config.
 * Returns null when the engine is 'off' (hotkey-only mode).
 */
export function createMainWake(config: WakeConfig): WakeWordDetector | null {
  if (config.engine === 'off') return null
  if (config.wakeScript) return createScriptedWake(config.wakeScript)
  if (config.engine === 'python') {
    return createPythonWakeDetector({
      pythonBin: config.pythonBin,
      scriptPath: config.sidecarScript,
      wakeModelPath: config.wakeModel,
    })
  }
  return createOpenWakeWordDetector({
    melspecModelPath: config.melspecModel,
    embeddingModelPath: config.embeddingModel,
    headModelPaths: { wake: config.wakeModel, abort: config.abortModel, holdOn: config.holdOnModel },
  })
}
