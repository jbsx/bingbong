import type { PerfSpanRecord } from './perfTracer'
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

/** One process as the sampler sees it: its kind and its share of one core since the last sample. */
export interface ProcessCpu {
  type: string
  percent: number
}

/** One CPU sample: every process's share summed, and by kind, in percent of one core. */
export interface CpuSample {
  total: number
  byType: Record<string, number>
  load1: number
}

export function cpuSampleOf(processes: readonly ProcessCpu[], load1: number): CpuSample {
  const byType: Record<string, number> = {}
  let total = 0
  for (const { type, percent } of processes) {
    if (!Number.isFinite(percent)) continue
    byType[type] = round1((byType[type] ?? 0) + percent)
    total += percent
  }
  return { total: round1(total), byType, load1: round1(load1) }
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
  /** Why the record was closed: its source changed, the page left, or it ended. */
  closed: 'changed' | 'left' | 'ended'
}

export interface AppReport {
  runs: { version: string; machine: string | null; kiosk: boolean; count: number }[]
  cpu: { samples: number; p50: number; p95: number; max: number; byTypeP50: Record<string, number> } | null
  playback: {
    count: number
    neverPlayed: number
    startP50: number | null
    startP95: number | null
    stalls: number
    stallMs: number
    droppedFrames: number
    totalFrames: number
  } | null
}

export function isAppRecord(record: PerfSpanRecord): boolean {
  return record.turnId === APP_TURN_ID
}

export function buildAppReport(records: readonly PerfSpanRecord[]): AppReport {
  const runs = new Map<string, AppReport['runs'][number]>()
  const totals: number[] = []
  const byType = new Map<string, number[]>()
  const plays: PlaybackRecord[] = []
  for (const record of records) {
    if (!isAppRecord(record) || record.detail === undefined) continue
    const detail = record.detail
    if (record.stage === 'run') {
      const version = typeof detail.version === 'string' ? detail.version : '?'
      const machine = typeof detail.machine === 'string' ? detail.machine : null
      const kiosk = detail.kiosk === true
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
    }
  }
  return { runs: [...runs.values()], cpu: cpuReport(totals, byType), playback: playbackReport(plays) }
}

function cpuReport(totals: number[], byType: Map<string, number[]>): AppReport['cpu'] {
  if (totals.length === 0) return null
  const sorted = [...totals].sort((a, b) => a - b)
  const byTypeP50: Record<string, number> = {}
  for (const [type, samples] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    byTypeP50[type] = nearestRankPercentile([...samples].sort((a, b) => a - b), 50)
  }
  return { samples: sorted.length, p50: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95), max: sorted[sorted.length - 1], byTypeP50 }
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
  }
}

export function formatAppReport(report: AppReport): string[] {
  const lines: string[] = []
  if (report.runs.length > 0) {
    const runs = report.runs.map((run) => `${run.version} on ${run.machine ?? 'unnamed'}${run.kiosk ? ' (kiosk)' : ''} ×${run.count}`)
    lines.push(`runs: ${runs.join(', ')}`)
  }
  if (report.cpu !== null) {
    const types = Object.entries(report.cpu.byTypeP50).map(([type, p50]) => `${type} ${p50}%`)
    lines.push(`cpu (% of one core, ${report.cpu.samples} samples): p50 ${report.cpu.p50}% p95 ${report.cpu.p95}% max ${report.cpu.max}% | p50 by process ${types.join(', ')}`)
  }
  if (report.playback !== null) {
    const p = report.playback
    const start = p.startP50 === null || p.startP95 === null ? 'never started' : `start p50 ${formatMs(p.startP50)} p95 ${formatMs(p.startP95)}`
    const frames = p.totalFrames > 0 ? ` | dropped ${p.droppedFrames}/${p.totalFrames} frames (${round1((100 * p.droppedFrames) / p.totalFrames)}%)` : ''
    lines.push(`playback: ${p.count} played (${p.neverPlayed} never started) | ${start} | stalls ${p.stalls} for ${formatMs(p.stallMs)}${frames}`)
  }
  return lines
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
