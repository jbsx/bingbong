// The kept run's summary (owner, 2026-10-28: a run that stops mid run
// throws nothing away): `summary.json` in the keep dir, written after every
// point, holds each point finished so far and its verdict, the point a host
// refused for credit (kept, never counted), and what reruns it exactly — the
// commit, the seed, the points, the repeat, the arm. `--resume` reads it back
// and runs only what is missing, the refused point included; a finished
// point is one of the same commit, model, seed, points, repeat and arm.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Cell } from './report.ts'

export const SUMMARY_FILE = 'summary.json'

/** What a summary's points were run on: a point is reused only under the same. */
export interface SummaryHead {
  readonly commit: string
  readonly seed: number
  readonly points: number
  readonly repeat: number
  readonly audioOnlyMusic: boolean
}

export interface FinishedPoint {
  readonly model: string
  readonly case: string
  /** The point's index in the case (casePoints), and the run's number under --repeat. */
  readonly point: number
  readonly n: number
  readonly label: string
  readonly cell: Cell
}

export interface RefusedPoint {
  readonly model: string
  readonly case: string
  /** null for a calibration run. */
  readonly point: number | null
  readonly n: number
  readonly why: string
}

export interface Summary extends SummaryHead {
  readonly finished: readonly FinishedPoint[]
  readonly refused: RefusedPoint | null
  readonly updated: string
}

const sameHead = (a: SummaryHead, b: SummaryHead): boolean => a.commit === b.commit && a.seed === b.seed && a.points === b.points && a.repeat === b.repeat && a.audioOnlyMusic === b.audioOnlyMusic

/** The summary a resume starts from: the kept one when its head matches, else why not; a fresh one with nothing kept. */
export function resumeFrom(kept: Summary | null, head: SummaryHead): Summary | string {
  if (kept === null) return { ...head, finished: [], refused: null, updated: new Date().toISOString() }
  if (!sameHead(kept, head)) {
    return `the kept summary was run at commit ${kept.commit}, seed ${kept.seed}, points ${kept.points}, repeat ${kept.repeat}, audio-only music ${kept.audioOnlyMusic ? 'on' : 'off'}; this run is ${head.commit}, ${head.seed}, ${head.points}, ${head.repeat}, ${head.audioOnlyMusic ? 'on' : 'off'}`
  }
  // The refused point is run again: it is missing, never finished.
  return { ...kept, refused: null }
}

/** The cell a point already finished with, when it did. */
export function finishedCell(summary: Summary, at: { model: string; case: string; point: number; n: number }): Cell | undefined {
  return summary.finished.find((item) => item.model === at.model && item.case === at.case && item.point === at.point && item.n === at.n)?.cell
}

/** The summary with one point finished (a point finished again replaces its earlier cell). */
export function withFinished(summary: Summary, point: FinishedPoint): Summary {
  const finished = summary.finished.filter((item) => !(item.model === point.model && item.case === point.case && item.point === point.point && item.n === point.n))
  return { ...summary, finished: [...finished, point], updated: new Date().toISOString() }
}

export const withRefused = (summary: Summary, refused: RefusedPoint): Summary => ({ ...summary, refused, updated: new Date().toISOString() })

export function readSummary(dir: string): Summary | null {
  const path = join(dir, SUMMARY_FILE)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Summary) : null
}

/** Written whole and renamed into place, so a run killed mid write leaves the last summary standing. */
export function writeSummary(dir: string, summary: Summary): void {
  const path = join(dir, SUMMARY_FILE)
  writeFileSync(`${path}.tmp`, `${JSON.stringify(summary, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}
