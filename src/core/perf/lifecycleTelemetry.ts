import type { PerfSpanRecord } from './perfTracer'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The run from start to quit in the perf log (#429): when each part of the
// app came up, how long each model took to load, each step of the quit, and
// what the machine was doing between lines. Advisory like every perf record:
// the shapes and their report live here, the Electron glue in
// src/main/perf/attachAppTelemetry.ts.

/** The milestone written once everything the run waits for is up. */
export const BOOT_READY = 'ready'

export interface BootClock {
  /** Records the milestone once, with its ms since the process started; later marks of it are dropped. */
  mark(milestone: string): void
}

/**
 * The run's boot milestones. `ready` is written once every milestone in
 * `readyWhen` is marked: the run is usable from there.
 */
export function createBootClock(write: (detail: { milestone: string; sinceStartMs: number }) => void, sinceStartMs: () => number, readyWhen: readonly string[]): BootClock {
  const marked = new Set<string>()
  const record = (milestone: string): void => {
    marked.add(milestone)
    write({ milestone, sinceStartMs: Math.round(sinceStartMs()) })
  }
  return {
    mark(milestone) {
      if (marked.has(milestone) || milestone === BOOT_READY) return
      record(milestone)
      if (!marked.has(BOOT_READY) && readyWhen.every((needed) => marked.has(needed))) record(BOOT_READY)
    },
  }
}

export interface QuitTrace {
  /** One of the app's quit events (`before-quit`, `will-quit`, `quit`, `exit`), stamped from the first. */
  event(step: string): void
  /** Wraps a quit hook so its own time is recorded beside the events. */
  hook<A extends unknown[]>(name: string, fn: (...args: A) => void): (...args: A) => void
}

/**
 * The quit, step by step. Each record is written the moment it happens, so a
 * quit that hangs or is killed still leaves every step it reached.
 */
export function createQuitTrace(write: (durMs: number, detail: Record<string, unknown>) => void, now: () => number): QuitTrace {
  let askedAt: number | null = null
  const counts = new Map<string, number>()
  const since = (at: number): number => Math.round(at - (askedAt ?? at))
  return {
    event(step) {
      const at = now()
      askedAt ??= at
      const n = (counts.get(step) ?? 0) + 1
      counts.set(step, n)
      write(0, { step, sinceAskedMs: since(at), ...(n > 1 ? { n } : {}) })
    },
    hook(name, fn) {
      return (...args) => {
        const start = now()
        try {
          fn(...args)
        } finally {
          const end = now()
          write(end - start, { step: 'hook', hook: name, sinceAskedMs: since(end) })
        }
      }
    },
  }
}

export interface LagSummary {
  count: number
  p50: number
  max: number
}

export interface LagMeter {
  record(ms: number): void
  /** What was recorded since the last drain; null when nothing was. */
  drain(): LagSummary | null
}

/** Durations gathered between two samples. */
export function createLagMeter(): LagMeter {
  let samples: number[] = []
  return {
    record(ms) {
      if (Number.isFinite(ms)) samples.push(ms)
    },
    drain() {
      if (samples.length === 0) return null
      const sorted = samples.sort((a, b) => a - b)
      samples = []
      return { count: sorted.length, p50: round1(nearestRankPercentile(sorted, 50)), max: round1(sorted[sorted.length - 1]) }
    },
  }
}

export interface MachineMemory {
  availableMb: number
  swapUsedMb: number
}

/** The machine's available memory and swap in use, from `/proc/meminfo`; null when either is missing. */
export function parseMeminfo(text: string): MachineMemory | null {
  const kb = (name: string): number | null => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, 'm').exec(text)
    return match === null ? null : Number(match[1])
  }
  const available = kb('MemAvailable')
  const swapTotal = kb('SwapTotal')
  const swapFree = kb('SwapFree')
  if (available === null || swapTotal === null || swapFree === null) return null
  return { availableMb: Math.round(available / 1024), swapUsedMb: Math.round((swapTotal - swapFree) / 1024) }
}

/** Long tasks in one surface since the last sample. */
export interface LongTasks {
  count: number
  ms: number
}

/**
 * Evaluated in a page at each sample: installs a long-task observer once and
 * answers what it saw since the last evaluate. By kind, on any page.
 */
export const LONG_TASKS_SCRIPT = String.raw`(() => {
  let s = window.__bingbongLongTasks
  if (s === undefined) {
    s = window.__bingbongLongTasks = { count: 0, ms: 0 }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          s.count += 1
          s.ms += entry.duration
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch {}
  }
  const seen = { count: s.count, ms: Math.round(s.ms) }
  s.count = 0
  s.ms = 0
  return seen
})()`

export interface LifecycleReport {
  /** Each milestone's ms since start across runs, in boot order. */
  boot: { milestone: string; runs: number; p50: number; max: number }[]
  /** Each model's load, the first in a run apart from later ones. */
  models: { model: string; first: boolean; count: number; p50: number; max: number; failed: number }[]
  /** The latest quit's steps; how many quits reached `exit`, and how many runs left no quit at all. */
  quit: { quits: number; exited: number; runsWithoutQuit: number; latest: { step: string; sinceAskedMs: number; durMs: number }[] } | null
  /** From the `cpu` samples. */
  steady: {
    loopP99: { p50: number; p95: number; max: number } | null
    memoryP50: Record<string, number>
    memoryMax: Record<string, number>
    availableMinMb: number | null
    swapMaxMb: number | null
    longTasks: Record<string, { count: number; ms: number; worstSampleMs: number }>
    vadLag: { p50: number; max: number } | null
  } | null
  wakeToListening: { count: number; p50: number; p95: number } | null
}

const isApp = (record: PerfSpanRecord, stage: string): boolean => record.turnId === 'app' && record.stage === stage && record.detail !== undefined

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function percentiles(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95), max: sorted[sorted.length - 1] }
}

export function buildLifecycleReport(records: readonly PerfSpanRecord[]): LifecycleReport {
  return { boot: bootReport(records), models: modelReport(records), quit: quitReport(records), steady: steadyReport(records), wakeToListening: wakeReport(records) }
}

function bootReport(records: readonly PerfSpanRecord[]): LifecycleReport['boot'] {
  const byMilestone = new Map<string, number[]>()
  for (const record of records) {
    if (!isApp(record, 'boot')) continue
    const milestone = record.detail?.milestone
    const since = num(record.detail?.sinceStartMs)
    if (typeof milestone !== 'string' || since === null) continue
    const list = byMilestone.get(milestone) ?? []
    list.push(since)
    byMilestone.set(milestone, list)
  }
  return [...byMilestone.entries()]
    .map(([milestone, values]) => {
      const { p50, max } = percentiles(values)
      return { milestone, runs: values.length, p50, max }
    })
    .sort((a, b) => a.p50 - b.p50)
}

function modelReport(records: readonly PerfSpanRecord[]): LifecycleReport['models'] {
  const groups = new Map<string, { model: string; first: boolean; loads: number[]; failed: number }>()
  for (const record of records) {
    if (!isApp(record, 'model-load')) continue
    const model = record.detail?.model
    if (typeof model !== 'string') continue
    const first = record.detail?.first === true
    const key = `${model}|${first}`
    const group = groups.get(key) ?? { model, first, loads: [], failed: 0 }
    if (record.detail?.failed === true) group.failed += 1
    else group.loads.push(record.durMs)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(({ model, first, loads, failed }) => {
      const { p50, max } = loads.length > 0 ? percentiles(loads) : { p50: 0, max: 0 }
      return { model, first, count: loads.length, p50, max, failed }
    })
    .sort((a, b) => a.model.localeCompare(b.model) || Number(b.first) - Number(a.first))
}

function quitReport(records: readonly PerfSpanRecord[]): LifecycleReport['quit'] {
  const ordered = records.filter((record) => isApp(record, 'quit') || isApp(record, 'run')).sort((a, b) => a.at - b.at)
  let runs = 0
  let quits = 0
  let exited = 0
  let runsWithoutQuit = 0
  let quitInRun = false
  let current: { step: string; sinceAskedMs: number; durMs: number }[] = []
  let latest: typeof current = []
  for (const record of ordered) {
    if (record.stage === 'run') {
      if (runs > 0 && !quitInRun) runsWithoutQuit += 1
      runs += 1
      quitInRun = false
      continue
    }
    const step = record.detail?.step
    if (typeof step !== 'string') continue
    if (step === 'before-quit' && record.detail?.n === undefined) {
      quits += 1
      quitInRun = true
      current = []
      latest = current
    }
    if (step === 'exit') exited += 1
    const label = step === 'hook' && typeof record.detail?.hook === 'string' ? `hook ${record.detail.hook}` : record.detail?.n !== undefined ? `${step} #${String(record.detail.n)}` : step
    current.push({ step: label, sinceAskedMs: num(record.detail?.sinceAskedMs) ?? 0, durMs: record.durMs })
  }
  if (quits === 0) return null
  return { quits, exited, runsWithoutQuit, latest }
}

function steadyReport(records: readonly PerfSpanRecord[]): LifecycleReport['steady'] {
  const loop: number[] = []
  const memory = new Map<string, number[]>()
  const available: number[] = []
  const swap: number[] = []
  const tasks = new Map<string, { count: number; ms: number; worstSampleMs: number }>()
  const lagP50: number[] = []
  let lagMax: number | null = null
  let samples = 0
  for (const record of records) {
    if (!isApp(record, 'cpu')) continue
    const detail = record.detail ?? {}
    const p99 = num((detail.loop as { p99?: unknown } | undefined)?.p99)
    if (p99 !== null) loop.push(p99)
    const byType = detail.memoryMb
    if (byType !== null && typeof byType === 'object') {
      for (const [type, mb] of Object.entries(byType)) {
        if (num(mb) === null) continue
        const list = memory.get(type) ?? []
        list.push(mb as number)
        memory.set(type, list)
      }
    }
    const availableMb = num(detail.availableMb)
    if (availableMb !== null) available.push(availableMb)
    const swapMb = num(detail.swapUsedMb)
    if (swapMb !== null) swap.push(swapMb)
    const longTasks = detail.longTasks
    if (longTasks !== null && typeof longTasks === 'object') {
      for (const [surface, seen] of Object.entries(longTasks)) {
        const count = num((seen as LongTasks | null)?.count)
        const ms = num((seen as LongTasks | null)?.ms)
        if (count === null || ms === null) continue
        const total = tasks.get(surface) ?? { count: 0, ms: 0, worstSampleMs: 0 }
        total.count += count
        total.ms += ms
        total.worstSampleMs = Math.max(total.worstSampleMs, ms)
        tasks.set(surface, total)
      }
    }
    const lag = detail.vadLag as LagSummary | null | undefined
    if (lag !== null && lag !== undefined && num(lag.p50) !== null) {
      lagP50.push(lag.p50)
      lagMax = Math.max(lagMax ?? 0, num(lag.max) ?? 0)
    }
    samples += 1
  }
  if (samples === 0 || (loop.length === 0 && memory.size === 0 && available.length === 0 && tasks.size === 0 && lagP50.length === 0)) return null
  const memoryP50: Record<string, number> = {}
  const memoryMax: Record<string, number> = {}
  for (const [type, values] of [...memory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { p50, max } = percentiles(values)
    memoryP50[type] = p50
    memoryMax[type] = max
  }
  return {
    loopP99: loop.length > 0 ? percentiles(loop) : null,
    memoryP50,
    memoryMax,
    availableMinMb: available.length > 0 ? Math.min(...available) : null,
    swapMaxMb: swap.length > 0 ? Math.max(...swap) : null,
    longTasks: Object.fromEntries([...tasks.entries()].sort(([a], [b]) => a.localeCompare(b))),
    vadLag: lagP50.length > 0 ? { p50: percentiles(lagP50).p50, max: lagMax ?? 0 } : null,
  }
}

function wakeReport(records: readonly PerfSpanRecord[]): LifecycleReport['wakeToListening'] {
  const spans = records.filter((record) => record.turnId === 'app' && record.stage === 'wake-to-listening').map((record) => record.durMs)
  if (spans.length === 0) return null
  const { p50, p95 } = percentiles(spans)
  return { count: spans.length, p50, p95 }
}

export function formatLifecycleReport(report: LifecycleReport): string[] {
  const lines: string[] = []
  if (report.boot.length > 0) {
    lines.push(`boot (ms since start, p50/max): ${report.boot.map((b) => `${b.milestone} ${formatMs(b.p50)}/${formatMs(b.max)}`).join(', ')}`)
  }
  if (report.models.length > 0) {
    const models = report.models.map((m) => `${m.model}${m.first ? '' : ' (again)'} ×${m.count} p50 ${formatMs(m.p50)} max ${formatMs(m.max)}${m.failed > 0 ? ` (${m.failed} failed)` : ''}`)
    lines.push(`model loads: ${models.join(', ')}`)
  }
  if (report.quit !== null) {
    const q = report.quit
    const steps = q.latest.map((s) => `${s.step} +${formatMs(s.sinceAskedMs)}${s.durMs > 0 ? ` (${formatMs(s.durMs)})` : ''}`)
    lines.push(`quit: ${q.quits} quits, ${q.exited} reached exit, ${q.runsWithoutQuit} runs left no quit | latest: ${steps.join(' → ')}`)
  }
  if (report.steady !== null) {
    const s = report.steady
    const parts: string[] = []
    if (s.loopP99 !== null) parts.push(`main loop delay p99 p50 ${formatMs(s.loopP99.p50)} p95 ${formatMs(s.loopP99.p95)} max ${formatMs(s.loopP99.max)}`)
    const mem = Object.keys(s.memoryP50).map((type) => `${type} ${s.memoryP50[type]}/${s.memoryMax[type]}MB`)
    if (mem.length > 0) parts.push(`memory p50/max ${mem.join(', ')}`)
    if (s.availableMinMb !== null || s.swapMaxMb !== null) parts.push(`machine available min ${s.availableMinMb ?? '?'}MB, swap max ${s.swapMaxMb ?? '?'}MB`)
    const tasks = Object.entries(s.longTasks).map(([surface, t]) => `${surface} ${t.count} for ${formatMs(t.ms)} (worst sample ${formatMs(t.worstSampleMs)})`)
    if (tasks.length > 0) parts.push(`long tasks ${tasks.join(', ')}`)
    if (s.vadLag !== null) parts.push(`vad lag p50 ${formatMs(s.vadLag.p50)} max ${formatMs(s.vadLag.max)}`)
    lines.push(`steady: ${parts.join(' | ')}`)
  }
  if (report.wakeToListening !== null) {
    const w = report.wakeToListening
    lines.push(`wake-to-listening: ×${w.count} p50 ${formatMs(w.p50)} p95 ${formatMs(w.p95)}`)
  }
  return lines
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
