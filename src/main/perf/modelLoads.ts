import { reportFault } from '../../core/trace/fault.ts'

// Each model's load timed (#429): the ONNX sessions load in the voice
// process (#430) — the VAD and the wake word on the first audio, Smart Turn
// as a prefetch, the STT once boot is ready — so a load is timed where it
// happens and recorded in the app's perf log, not at a boot step.
// The app names the sink once; a node script that loads the same models
// (stt:replay) names none and pays nothing.

export interface ModelLoad {
  model: string
  durMs: number
  /** The first load of this model that succeeded in this process. */
  first: boolean
  failed: boolean
}

let sink: ((load: ModelLoad) => void) | null = null
const loadedOnce = new Set<string>()

/** Where every load goes from now on; the app's perf log. */
export function setModelLoadSink(next: ((load: ModelLoad) => void) | null): void {
  sink = next
}

/**
 * One finished load into the sink, `first` judged in this process: the
 * voice process's loads (#430) are timed there and recorded here, so a
 * restarted voice process's reload is not a first load of the run.
 */
export function recordModelLoad(load: Omit<ModelLoad, 'first'>): void {
  if (sink === null) return
  const first = !load.failed && !loadedOnce.has(load.model)
  if (first) loadedOnce.add(load.model)
  try {
    sink({ ...load, first })
  } catch (error) {
    // Advisory: a perf write never breaks a model load.
    reportFault('perf.modelLoads.sink', error)
  }
}

/** Times one load of `model` and passes it through unchanged. */
export function timeModelLoad<T>(model: string, load: Promise<T>): Promise<T> {
  if (sink === null) return load
  const start = performance.now()
  const report = (failed: boolean): void => recordModelLoad({ model, durMs: performance.now() - start, failed })
  load.then(
    () => report(false),
    () => report(true),
  )
  return load
}
