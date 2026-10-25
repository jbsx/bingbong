import { reportFault } from '../../core/trace/fault'

// Each model's load timed (#429): the ONNX sessions load lazily (the VAD and
// the wake word on the first audio, the STT on the first line, Smart Turn as
// a prefetch), so a load is recorded where it happens, not at a boot step.
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

/** Times one load of `model` and passes it through unchanged. */
export function timeModelLoad<T>(model: string, load: Promise<T>): Promise<T> {
  if (sink === null) return load
  const start = performance.now()
  const report = (failed: boolean): void => {
    const first = !failed && !loadedOnce.has(model)
    if (first) loadedOnce.add(model)
    try {
      sink?.({ model, durMs: performance.now() - start, first, failed })
    } catch (error) {
      // Advisory: a perf write never breaks a model load.
      reportFault('perf.modelLoads.sink', error)
    }
  }
  load.then(
    () => report(false),
    () => report(true),
  )
  return load
}
