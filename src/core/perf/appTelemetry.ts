import type { PerfSpanRecord } from './perfTracer'
import { buildLifecycleReport, formatLifecycleReport, type LagSummary, type LifecycleReport, type LongTasks, type MachineMemory, type WakeGateCount } from './lifecycleTelemetry.ts'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The app's own records in the perf log, beside the turns' (kiosk telemetry
// 2026-10-25): which build ran on which machine, how busy its processes
// were, and how each piece of media in the pane played. They ride the
// perf log under one id that is no turn, so `pnpm perf:report` reads them
// from the same files and keeps them out of the stage table.

/** The id the app's own records carry in place of a turn's. */
export const APP_TURN_ID = 'app'

/** How often the processes' CPU is sampled. */
export const CPU_SAMPLE_MS = 15_000

/** One run's stamp: written once at boot, so a log says which build wrote it. */
export interface RunStamp {
  version: string
  machine: string | null
  kiosk: boolean
  platform: string
  arch: string
  cpuModel: string
  cpus: number
  electron: string
}

/**
 * One process as the sampler sees it: its kind and its CPU share since the last
 * sample, as Electron's `percentCPUUsage` gives it — percent of ALL the
 * machine's logical CPUs (Electron divides by the CPU count), not of one core:
 * on the kiosk's 4 CPUs a process `top` shows at 19 % reads 4.7. The run stamp's
 * `cpus` converts.
 */
export interface ProcessCpu {
  /** Its kind, or the surface it renders (`dashboard`, `pane`) when the sampler knows it (#429). */
  type: string
  percent: number
  /** Its working set (#429); absent when unread. */
  memoryMb?: number
}

/** The main process's event-loop delay over one sample (#429), in ms. */
export interface LoopDelay {
  p50: number
  p99: number
  max: number
}

/** What the sample carries beside the CPU (#429); each part absent when unread. */
export interface SampleExtras {
  loop?: LoopDelay
  memory?: MachineMemory | null
  /** Long tasks per surface since the last sample; null for a surface that did not answer. */
  longTasks?: Record<string, LongTasks | null>
  /** How far the voice chain ran behind the audio it was handed. */
  vadLag?: LagSummary | null
  /** The wake chunks heard and scored (#435): the gate-open share. */
  wakeGate?: WakeGateCount | null
}

/** One CPU sample: every process's share summed, and by kind, in percent of all the machine's CPUs (see ProcessCpu). */
export interface CpuSample {
  total: number
  byType: Record<string, number>
  load1: number
  memoryMb?: Record<string, number>
  availableMb?: number
  swapUsedMb?: number
  loop?: LoopDelay
  longTasks?: Record<string, LongTasks | null>
  vadLag?: LagSummary | null
  wakeGate?: WakeGateCount | null
}

export function cpuSampleOf(processes: readonly ProcessCpu[], load1: number, extras: SampleExtras = {}): CpuSample {
  const byType: Record<string, number> = {}
  const memoryMb: Record<string, number> = {}
  let total = 0
  for (const { type, percent, memoryMb: mb } of processes) {
    if (typeof mb === 'number' && Number.isFinite(mb)) memoryMb[type] = Math.round((memoryMb[type] ?? 0) + mb)
    if (!Number.isFinite(percent)) continue
    byType[type] = round1((byType[type] ?? 0) + percent)
    total += percent
  }
  return {
    total: round1(total),
    byType,
    load1: round1(load1),
    ...(Object.keys(memoryMb).length > 0 ? { memoryMb } : {}),
    ...(extras.memory ? { availableMb: extras.memory.availableMb, swapUsedMb: extras.memory.swapUsedMb } : {}),
    ...(extras.loop ? { loop: extras.loop } : {}),
    ...(extras.longTasks ? { longTasks: extras.longTasks } : {}),
    ...(extras.vadLag !== undefined ? { vadLag: extras.vadLag } : {}),
    ...(extras.wakeGate !== undefined ? { wakeGate: extras.wakeGate } : {}),
  }
}

/** One piece of media's playing, as the pane's own media events told it (by kind: any audio or video element). */
export interface PlaybackRecord {
  /** The page it played on, without its query. */
  page: string
  kind: 'video' | 'audio'
  /** Ms from the element's load start to its first `playing`; null when it never played, or was already playing when first seen. */
  startMs: number | null
  /** It was already playing when the page was first read: its start was not seen. */
  joined?: boolean
  /** Ms it was played for, its stalls excluded. */
  playedMs: number
  /** `waiting` events after it first played, and the ms they held it. */
  stalls: number
  stallMs: number
  /** Video frames dropped of those decoded; null for audio. */
  droppedFrames: number | null
  totalFrames: number | null
  /** The picture's height; null for audio. */
  height: number | null
  /**
   * The codecs the page asked Media Source for (`vp09.00.51.08 / opus`), or
   * the `<source>` type's; 'unknown' when neither named one, as for media
   * set up before the watch ran. Absent on records written before #425's
   * 2026-10-26 change.
   */
  codec?: string
  /** Why the record was closed: its source changed, the page left, or it ended. */
  closed: 'changed' | 'left' | 'ended'
}

export interface AppReport {
  runs: { version: string; machine: string | null; kiosk: boolean; count: number }[]
  cpu: {
    samples: number
    p50: number
    p95: number
    max: number
    byTypeP50: Record<string, number>
    /** The logical CPUs the shares are of, when every run stamp in the logs names the same count; else null. */
    cpus: number | null
  } | null
  playback: {
    count: number
    neverPlayed: number
    startP50: number | null
    startP95: number | null
    stalls: number
    stallMs: number
    droppedFrames: number
    totalFrames: number
    /** How many records named each codec, by its leading part (`vp09`, `av01`, `opus`, `unknown`). */
    codecs: Record<string, number>
  } | null
  /** The Player's song starts by the road each took (#488, #502), from the `media-start` spans; null when none. */
  songs: SongsReport | null
  /** Boot, model loads, quit and the steady state (#429). */
  lifecycle: LifecycleReport
}

/** One road's song starts (#502): how many, how many played, from landing to start. */
export interface RoadStarts {
  count: number
  started: number
  startP50: number | null
  startP95: number | null
}

/**
 * The Player's song starts by road (#502): the watch page's and the audio
 * road's apart, the road's lookup times, and how often the watch page stood
 * in for the road. A start logged before #502 carries no road: a page's.
 */
export interface SongsReport {
  page: RoadStarts
  audio: RoadStarts
  /** The lookups that ran: a remembered address's (#516) is no lookup, and would flatter them. */
  lookupP50: number | null
  lookupP95: number | null
  /** Starts on a remembered address (#516), and those it did not play. */
  remembered: number
  rememberedRefused: number
  /** Starts whose line ended still on an ad (#549): not yet played, and not refused or unstarted either. */
  onAd: number
  /** Starts by the client that answered their lookup (#516), and how many of them the first ask failed: a stream that would not start and its fallback are one lookup and two starts. */
  visionos: number
  defaultClients: number
  firstFailed: number
  /** Page starts that were the audio road's fallback. */
  fallbacks: number
}

export function isAppRecord(record: PerfSpanRecord): boolean {
  return record.turnId === APP_TURN_ID
}

export function buildAppReport(records: readonly PerfSpanRecord[]): AppReport {
  const runs = new Map<string, AppReport['runs'][number]>()
  const totals: number[] = []
  const byType = new Map<string, number[]>()
  const plays: PlaybackRecord[] = []
  const cpuCounts = new Set<number | null>()
  const starts: SongStart[] = []
  for (const record of records) {
    if (!isAppRecord(record) || record.detail === undefined) continue
    const detail = record.detail
    if (record.stage === 'run') {
      const version = typeof detail.version === 'string' ? detail.version : '?'
      const machine = typeof detail.machine === 'string' ? detail.machine : null
      const kiosk = detail.kiosk === true
      cpuCounts.add(typeof detail.cpus === 'number' ? detail.cpus : null)
      const key = `${version}|${machine}|${kiosk}`
      const run = runs.get(key) ?? { version, machine, kiosk, count: 0 }
      run.count += 1
      runs.set(key, run)
    } else if (record.stage === 'cpu' && typeof detail.total === 'number') {
      totals.push(detail.total)
      const types = detail.byType
      if (types !== null && typeof types === 'object') {
        for (const [type, percent] of Object.entries(types)) {
          if (typeof percent !== 'number') continue
          const samples = byType.get(type)
          if (samples === undefined) byType.set(type, [percent])
          else samples.push(percent)
        }
      }
    } else if (record.stage === 'playback') {
      plays.push(detail as unknown as PlaybackRecord)
    } else if (record.stage === 'media-start') {
      const asked = detail.asked !== null && typeof detail.asked === 'object' ? (detail.asked as { client?: unknown; failedFirst?: unknown }) : null
      starts.push({ road: detail.road === 'audio' ? 'audio' : 'page', started: detail.started === true, ms: record.durMs, lookup: typeof detail.lookup === 'number' ? detail.lookup : null, fallback: detail.fallback === true, remembered: detail.remembered === true, onAd: detail.onAd != null, client: typeof asked?.client === 'string' ? asked.client : null, firstFailed: asked?.failedFirst != null })
    }
  }
  return { runs: [...runs.values()], cpu: cpuReport(totals, byType, cpuCounts.size === 1 ? [...cpuCounts][0] : null), playback: playbackReport(plays), songs: songsReport(starts), lifecycle: buildLifecycleReport(records) }
}

interface SongStart {
  road: 'page' | 'audio'
  started: boolean
  ms: number
  lookup: number | null
  fallback: boolean
  remembered: boolean
  onAd: boolean
  client: string | null
  firstFailed: boolean
}

const percentileOf = (samples: readonly number[], p: number): number | null => (samples.length === 0 ? null : nearestRankPercentile([...samples].sort((a, b) => a - b), p))

function songsReport(starts: readonly SongStart[]): SongsReport | null {
  if (starts.length === 0) return null
  const onRoad = (road: 'page' | 'audio'): RoadStarts => {
    const mine = starts.filter((start) => start.road === road)
    const ms = mine.filter((start) => start.started).map((start) => start.ms)
    return { count: mine.length, started: ms.length, startP50: percentileOf(ms, 50), startP95: percentileOf(ms, 95) }
  }
  const lookups = starts.flatMap((start) => (start.lookup === null || start.remembered ? [] : [start.lookup]))
  const remembered = starts.filter((start) => start.remembered)
  return { page: onRoad('page'), audio: onRoad('audio'), lookupP50: percentileOf(lookups, 50), lookupP95: percentileOf(lookups, 95), remembered: remembered.length, rememberedRefused: remembered.filter((start) => !start.started && !start.onAd).length, onAd: starts.filter((start) => start.onAd).length, visionos: starts.filter((start) => start.client === 'visionos').length, defaultClients: starts.filter((start) => start.client === 'default').length, firstFailed: starts.filter((start) => start.firstFailed).length, fallbacks: starts.filter((start) => start.road === 'page' && start.fallback).length }
}

function formatRoadStarts(name: string, road: RoadStarts): string {
  const start = road.startP50 === null || road.startP95 === null ? 'none started' : `start p50 ${formatMs(road.startP50)} p95 ${formatMs(road.startP95)}`
  return `${name} ${road.count} (${road.started} started, ${start})`
}

function cpuReport(totals: number[], byType: Map<string, number[]>, cpus: number | null): AppReport['cpu'] {
  if (totals.length === 0) return null
  const sorted = [...totals].sort((a, b) => a - b)
  const byTypeP50: Record<string, number> = {}
  for (const [type, samples] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    byTypeP50[type] = nearestRankPercentile([...samples].sort((a, b) => a - b), 50)
  }
  return { samples: sorted.length, p50: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95), max: sorted[sorted.length - 1], byTypeP50, cpus }
}

function playbackReport(plays: readonly PlaybackRecord[]): AppReport['playback'] {
  if (plays.length === 0) return null
  const starts = plays.flatMap((play) => (typeof play.startMs === 'number' ? [play.startMs] : [])).sort((a, b) => a - b)
  const sum = (field: 'stalls' | 'stallMs' | 'droppedFrames' | 'totalFrames'): number => plays.reduce((n, play) => n + (typeof play[field] === 'number' ? play[field] : 0), 0)
  return {
    count: plays.length,
    neverPlayed: plays.filter((play) => play.startMs === null && play.joined !== true).length,
    startP50: starts.length > 0 ? nearestRankPercentile(starts, 50) : null,
    startP95: starts.length > 0 ? nearestRankPercentile(starts, 95) : null,
    stalls: sum('stalls'),
    stallMs: sum('stallMs'),
    droppedFrames: sum('droppedFrames'),
    totalFrames: sum('totalFrames'),
    codecs: codecTally(plays),
  }
}

function codecTally(plays: readonly PlaybackRecord[]): Record<string, number> {
  const tally: Record<string, number> = {}
  for (const play of plays) {
    if (typeof play.codec !== 'string') continue
    for (const codec of play.codec.split(' / ')) {
      const lead = codec.split('.')[0]
      tally[lead] = (tally[lead] ?? 0) + 1
    }
  }
  return tally
}

export function formatAppReport(report: AppReport): string[] {
  const lines: string[] = []
  if (report.runs.length > 0) {
    const runs = report.runs.map((run) => `${run.version} on ${run.machine ?? 'unnamed'}${run.kiosk ? ' (kiosk)' : ''} ×${run.count}`)
    lines.push(`runs: ${runs.join(', ')}`)
  }
  if (report.cpu !== null) {
    const types = Object.entries(report.cpu.byTypeP50).map(([type, p50]) => `${type} ${p50}%`)
    const of = report.cpu.cpus === null ? 'all CPUs' : `all ${report.cpu.cpus} CPUs, × ${report.cpu.cpus} for one core`
    lines.push(`cpu (% of ${of}, ${report.cpu.samples} samples): p50 ${report.cpu.p50}% p95 ${report.cpu.p95}% max ${report.cpu.max}% | p50 by process ${types.join(', ')}`)
  }
  if (report.playback !== null) {
    const p = report.playback
    const start = p.startP50 === null || p.startP95 === null ? 'never started' : `start p50 ${formatMs(p.startP50)} p95 ${formatMs(p.startP95)}`
    const frames = p.totalFrames > 0 ? ` | dropped ${p.droppedFrames}/${p.totalFrames} frames (${round1((100 * p.droppedFrames) / p.totalFrames)}%)` : ''
    const tally = Object.entries(p.codecs)
    const codecs = tally.length > 0 ? ` | codecs ${tally.map(([codec, count]) => `${codec} ×${count}`).join(', ')}` : ''
    lines.push(`playback: ${p.count} played (${p.neverPlayed} never started) | ${start} | stalls ${p.stalls} for ${formatMs(p.stallMs)}${frames}${codecs}`)
  }
  if (report.songs !== null) {
    const s = report.songs
    const lookup = s.lookupP50 === null || s.lookupP95 === null ? '' : ` | lookup p50 ${formatMs(s.lookupP50)} p95 ${formatMs(s.lookupP95)}`
    const remembered = s.remembered === 0 ? '' : ` | remembered ${s.remembered} (${s.rememberedRefused} refused)`
    const clients = s.visionos + s.defaultClients === 0 ? '' : ` | answered by visionos ${s.visionos}, default ${s.defaultClients} (first ask failed ${s.firstFailed})`
    lines.push(`songs by road: ${formatRoadStarts('page', s.page)} | ${formatRoadStarts('audio', s.audio)}${lookup}${remembered}${clients} | fell back to the page ${s.fallbacks}${s.onAd === 0 ? '' : ` | line ended on an ad ${s.onAd}`}`)
  }
  lines.push(...formatLifecycleReport(report.lifecycle))
  return lines
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
