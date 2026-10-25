import { cpus, loadavg } from 'node:os'
import type { WebContents } from 'electron'
import { APP_TURN_ID, CPU_SAMPLE_MS, cpuSampleOf, type ProcessCpu, type RunStamp } from '../../core/perf/appTelemetry'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createPlaybackTracker, type PlaybackPoll } from '../../core/perf/playbackTracker'
import { reportFault } from '../../core/trace/fault'
import { PLAYBACK_SCRIPT } from './playbackScript'

// The app's own records in the perf log (kiosk telemetry 2026-10-25, see
// src/core/perf/appTelemetry.ts): the run's stamp at boot, a CPU sample of
// every process every 15 s, and one Playback Record per piece of media the
// pane played. Advisory like every perf write: a failure is a fault, never
// the app's.

/** How often the pane's media is read. */
const PLAYBACK_POLL_MS = 5_000

function write(tracer: PerfTracer, stage: string, detail: Record<string, unknown>, site: string): void {
  try {
    tracer.span(APP_TURN_ID, stage, 0, detail)
  } catch (error) {
    reportFault(site, error)
  }
}

/** The run's stamp: which build, on which machine. */
export function writeRunStamp(tracer: PerfTracer, stamp: Omit<RunStamp, 'platform' | 'arch' | 'cpuModel' | 'cpus'>): void {
  const cores = cpus()
  const full: RunStamp = { ...stamp, platform: process.platform, arch: process.arch, cpuModel: cores[0]?.model.trim() ?? '?', cpus: cores.length }
  write(tracer, 'run', { ...full }, 'perf.appTelemetry.runStamp')
}

/** Every process's CPU every 15 s; the returned stop ends it. */
export function startCpuSampler(tracer: PerfTracer, metrics: () => readonly { type: string; cpu: { percentCPUUsage: number } }[]): () => void {
  // Electron's shares are since the previous call: the first one primes them.
  metrics()
  const timer = setInterval(() => {
    try {
      const processes: ProcessCpu[] = metrics().map((metric) => ({ type: metric.type, percent: metric.cpu.percentCPUUsage }))
      write(tracer, 'cpu', { ...cpuSampleOf(processes, loadavg()[0] ?? 0) }, 'perf.appTelemetry.cpu')
    } catch (error) {
      reportFault('perf.appTelemetry.cpu', error)
    }
  }, CPU_SAMPLE_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

function pollOf(value: unknown): PlaybackPoll | null {
  if (value === null || typeof value !== 'object') return null
  const { items, closed } = value as { items?: unknown; closed?: unknown }
  return Array.isArray(items) && Array.isArray(closed) ? ({ items, closed } as PlaybackPoll) : null
}

/** The pane's media read every 5 s, its script installed on each document as it is ready; the returned stop ends it and closes what is open. */
export function attachPlaybackWatch(tracer: PerfTracer, contents: WebContents): () => void {
  const tracker = createPlaybackTracker((record) => write(tracer, 'playback', { ...record }, 'perf.appTelemetry.playback'))
  const read = async (): Promise<void> => {
    if (contents.isDestroyed()) return
    // A document going or not yet parsed answers nothing: nothing is closed for it.
    const value: unknown = await contents.executeJavaScript(PLAYBACK_SCRIPT).catch(() => null)
    tracker.observe(pollOf(value))
  }
  const onReady = (): void => {
    void read()
  }
  contents.on('dom-ready', onReady)
  const timer = setInterval(() => {
    read().catch((error: unknown) => reportFault('perf.appTelemetry.playback', error))
  }, PLAYBACK_POLL_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    if (!contents.isDestroyed()) contents.removeListener('dom-ready', onReady)
    tracker.flush()
  }
}
