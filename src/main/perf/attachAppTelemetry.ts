import { readFile } from 'node:fs/promises'
import { cpus, freemem, loadavg } from 'node:os'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { WebContents } from 'electron'
import { APP_TURN_ID, CPU_SAMPLE_MS, cpuSampleOf, type ProcessCpu, type RunStamp } from '../../core/perf/appTelemetry'
import {
  LONG_TASKS_SCRIPT,
  createBootClock,
  createLagMeter,
  createWakeGateMeter,
  createQuitTrace,
  parseMeminfo,
  type BootClock,
  type LongTasks,
  type MachineMemory,
  type QuitTrace,
} from '../../core/perf/lifecycleTelemetry'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createPlaybackTracker, type PlaybackPoll } from '../../core/perf/playbackTracker'
import { reportFault } from '../../core/trace/fault'
import { setModelLoadSink } from './modelLoads'
import { PLAYBACK_SCRIPT } from './playbackScript'

// The app's own records in the perf log (kiosk telemetry 2026-10-25, see
// src/core/perf/appTelemetry.ts): the run's stamp at boot, a CPU sample of
// every process every 15 s, and one Playback Record per piece of media the
// pane played; since #429 also the boot milestones, each model's load, the
// quit step by step, and memory, loop delay and long tasks in each sample.
// Advisory like every perf write: a failure is a fault, never the app's.

/** How often the pane's media is read. */
const PLAYBACK_POLL_MS = 5_000

function write(tracer: PerfTracer, stage: string, detail: Record<string, unknown>, site: string, durMs = 0): void {
  try {
    tracer.span(APP_TURN_ID, stage, durMs, detail)
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

/** How long a surface's long-task read may take before the sample is written without it. */
const LONG_TASKS_DEADLINE_MS = 1_000

/** How far the voice chain runs behind the audio handed to it (#429): fed by the ears, drained by each sample. */
export const vadLag = createLagMeter()

/** The ear's wake chunks heard and scored (#435): the gate-open share, fed by the voice chain, drained by each sample. */
export const wakeGate = createWakeGateMeter()

/** The surfaces whose renderers the sample names and reads long tasks in (#429); dropped once destroyed. */
const surfaces = new Map<string, WebContents>()

/** Names a renderer in the sample: `dashboard`, `pane`. */
export function trackSurface(name: string, contents: WebContents): void {
  surfaces.set(name, contents)
}

function liveSurfaces(): [string, WebContents][] {
  for (const [name, contents] of surfaces) if (contents.isDestroyed()) surfaces.delete(name)
  return [...surfaces.entries()]
}

function surfaceNames(): Map<number, string> {
  const names = new Map<number, string>()
  for (const [name, contents] of liveSurfaces()) {
    const pid = contents.getOSProcessId()
    if (pid > 0) names.set(pid, name)
  }
  return names
}

/** Each surface's long tasks since the last read; null for one busy past the deadline, navigating, or gone. */
async function readLongTasks(): Promise<Record<string, LongTasks | null>> {
  const reads = liveSurfaces().map(async ([name, contents]): Promise<[string, LongTasks | null]> => {
    const answer = contents.executeJavaScript(LONG_TASKS_SCRIPT).catch(() => null) as Promise<unknown>
    const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), LONG_TASKS_DEADLINE_MS).unref?.())
    const value = await Promise.race([answer, late])
    const seen = value as Partial<LongTasks> | null
    return [name, seen !== null && typeof seen?.count === 'number' && typeof seen.ms === 'number' ? { count: seen.count, ms: seen.ms } : null]
  })
  return Object.fromEntries(await Promise.all(reads))
}

async function readMachineMemory(): Promise<MachineMemory | null> {
  if (process.platform !== 'linux') return { availableMb: Math.round(freemem() / 1_048_576), swapUsedMb: 0 }
  return parseMeminfo(await readFile('/proc/meminfo', 'utf8').catch(() => ''))
}

/** One process as Electron's metrics give it: its kind, its pid, its CPU since the last call, its working set in KB. */
export interface ProcessMetric {
  type: string
  pid: number
  cpu: { percentCPUUsage: number }
  memory?: { workingSetSize: number }
}

/**
 * Every process's CPU and memory every 15 s, with the main loop's delay, the
 * machine's memory, each surface's long tasks and the voice chain's lag
 * (#429); the returned stop ends it.
 */
export function startCpuSampler(tracer: PerfTracer, metrics: () => readonly ProcessMetric[]): () => void {
  // Electron's shares are since the previous call: the first one primes them.
  metrics()
  const loop = monitorEventLoopDelay({ resolution: 20 })
  loop.enable()
  const ms = (ns: number): number => Math.round(ns / 1e5) / 10
  const sample = async (): Promise<void> => {
    // The CPU and the loop are read on the tick, the slower reads after: each covers the same 15 s.
    const names = surfaceNames()
    const processes: ProcessCpu[] = metrics().map((metric) => ({
      type: names.get(metric.pid) ?? metric.type,
      percent: metric.cpu.percentCPUUsage,
      ...(metric.memory ? { memoryMb: metric.memory.workingSetSize / 1024 } : {}),
    }))
    const delay = { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) }
    loop.reset()
    const lag = vadLag.drain()
    const gate = wakeGate.drain()
    const [memory, longTasks] = await Promise.all([readMachineMemory(), readLongTasks()])
    write(tracer, 'cpu', { ...cpuSampleOf(processes, loadavg()[0] ?? 0, { loop: delay, memory, longTasks, vadLag: lag, wakeGate: gate }) }, 'perf.appTelemetry.cpu')
  }
  const timer = setInterval(() => {
    sample().catch((error: unknown) => reportFault('perf.appTelemetry.cpu', error))
  }, CPU_SAMPLE_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    loop.disable()
  }
}

/** The run's boot milestones (#429), each in ms since the process started; `ready` once every one in `readyWhen` is in. */
export function startBootClock(tracer: PerfTracer, readyWhen: readonly string[], onReady?: () => void): BootClock {
  const boot = createBootClock((detail) => write(tracer, 'boot', { ...detail }, 'perf.appTelemetry.boot'), () => process.uptime() * 1000, readyWhen, onReady)
  // Each model's load, wherever it happens; the first of each is a boot milestone too.
  setModelLoadSink((load) => {
    write(tracer, 'model-load', { model: load.model, first: load.first, ...(load.failed ? { failed: true } : {}), sinceStartMs: Math.round(process.uptime() * 1000) }, 'perf.appTelemetry.modelLoad', load.durMs)
    if (load.first) boot.mark(`${load.model}-loaded`)
  })
  return boot
}

/** The quit step by step (#429), each record on disk the moment it happens. */
export function startQuitTrace(tracer: PerfTracer): QuitTrace {
  return createQuitTrace((durMs, detail) => write(tracer, 'quit', detail, 'perf.appTelemetry.quit', durMs), () => performance.now())
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
