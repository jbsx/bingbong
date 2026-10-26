import { reportFault } from '../../core/trace/fault.ts'

// Each model's load timed (#429): the ONNX sessions load in the voice
// process (#430) — the VAD and the wake word on the first audio, Smart Turn
// as a prefetch, the STT once boot is ready — so a load is timed where it
// happens and recorded in the app's perf log, not at a boot step.
// The app names the sink once; a node script that loads the same models
// (stt:replay) names none and pays nothing.
// Since #451 each load also carries what it added to the process's RSS:
// the voice process's memory breakdown, model by model.

export interface ModelLoad {
  model: string
  durMs: number
  /** The first load of this model that succeeded in this process. */
  first: boolean
  failed: boolean
  /** The process's RSS when the load ended, in MB (#451). */
  rssMb?: number
  /**
   * What the process's RSS grew by over the load, in MB (#451). The whole
   * process is read, so a load beside another on any thread (the STT thread,
   * #430) counts both; the report judges overlap from the loads' windows.
   */
  rssDeltaMb?: number
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

/** A load as the voice process and the STT thread pass it to main, where `first` is judged again. */
export function relayedLoad(load: ModelLoad): Omit<ModelLoad, 'first'> {
  const { model, durMs, failed, rssMb, rssDeltaMb } = load
  return { model, durMs, failed, rssMb, rssDeltaMb }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

/** The whole process's RSS in MB: a load on the STT thread (#430) reads the same process as one on the voice process's main thread. */
const rssMb = (): number => round1(process.memoryUsage.rss() / 1_048_576)

/** Times one load of `model` and passes it through unchanged. */
export function timeModelLoad<T>(model: string, load: Promise<T>): Promise<T> {
  if (sink === null) return load
  const start = performance.now()
  const rssBefore = rssMb()
  const report = (failed: boolean): void => {
    const rssAfter = rssMb()
    recordModelLoad({ model, durMs: performance.now() - start, failed, rssMb: rssAfter, rssDeltaMb: round1(rssAfter - rssBefore) })
  }
  load.then(
    () => report(false),
    () => report(true),
  )
  return load
}
