// The goal corpus's case and its scoring (#465, ADR 0095): a case is a
// Goal Line the owner would say, the page it is said on and what
// done-right is in words (`fixtures/goal-cases/`). `pnpm goal:gate` runs
// each live under the CLI harness and hands what the run left — the final
// page and its text in view, every sentence said, the page's questions
// (declined by the gate), the Shelf and the clipboard — to one fixed judge
// model, which answers done, miss or wall with one line why. The table
// prints that per case, with seconds, and with `--repeat N` the done-right
// count across runs and the seconds p50. Zero runtime imports but the
// reply reader: the gate script runs this under node's type stripping (#36).

import { firstJsonObject } from './plannerAsk.ts'

export interface GoalCase {
  readonly id: string
  readonly transcript: string
  readonly start: string
  readonly meant: string
  readonly source: string
}

const FIELDS = ['id', 'transcript', 'start', 'meant', 'source'] as const

export function readGoalCase(raw: unknown): GoalCase | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const record = raw as Record<string, unknown>
  for (const field of FIELDS) if (typeof record[field] !== 'string' || (record[field] as string).trim() === '') return `${field} is missing`
  return { id: record.id as string, transcript: record.transcript as string, start: record.start as string, meant: record.meant as string, source: record.source as string }
}

/** What one live run of a case left, as the judge is told it. */
export interface GoalRun {
  readonly transcript: string
  readonly meant: string
  readonly start: string
  readonly url: string
  readonly title: string
  /** The final page's text in the viewport. */
  readonly textInView: string
  readonly said: readonly string[]
  /** Every question the page put; under the gate each was declined. */
  readonly asked: readonly string[]
  readonly declined: boolean
  /** The files on the Shelf after the run. */
  readonly shelf: readonly string[]
  readonly clipboard: string | null
  /** How the Task ended, from its last record; null when none was recorded. */
  readonly ended: string | null
  readonly seconds: number
  /** Still running at the 90 s bound. */
  readonly timedOut: boolean
}

/** The bound a run is given before it is read as it stands. */
export const GOAL_RUN_BOUND_S = 90

export type GoalVerdictKind = 'done' | 'miss' | 'wall'

export interface GoalVerdict {
  readonly verdict: GoalVerdictKind
  readonly why: string
}

export const GOAL_JUDGE_INSTRUCTIONS = [
  'You judge whether a voice-controlled web browser did what its user meant. You are told the Goal Line the user spoke, what done-right means for it, and everything the run left: the final page, its text in view, what the browser said aloud, what the page asked, the files on the Shelf (the appliance\'s downloads folder) and the clipboard.',
  'The gate declines every confirm the page asks, so nothing ever posts, sends or orders: when what was meant needs the user\'s yes, reaching that confirm with the right content is done-right.',
  'Where done-right is a question back to the user, the right question said aloud is done-right and a guess is not.',
  'Answer "wall" when a sign-in wall stopped the run before what was meant could be done; "done" when what was meant was done; "miss" otherwise.',
  'Reply with exactly one JSON object and nothing else: {"verdict": "done" | "miss" | "wall", "why": "<one line>"}',
].join('\n')

const quoted = (texts: readonly string[]): string => (texts.length === 0 ? 'nothing' : texts.map((text) => JSON.stringify(text)).join(' '))

/** The judge's two messages: the Goal Line and the meant outcome each on a labelled line, then the run. */
export function goalJudgeMessages(run: GoalRun): { system: string; user: string } {
  const ended = run.timedOut ? `still running at the ${GOAL_RUN_BOUND_S} s bound` : `${run.ended ?? 'no record'}, after ${run.seconds.toFixed(1)} s`
  const asked = run.asked.length === 0 ? 'nothing' : `${quoted(run.asked)}${run.declined ? ' — declined by the gate, as it declines every confirm' : ''}`
  const user = [
    `Goal Line: ${run.transcript}`,
    `Meant: ${run.meant}`,
    `Started on: ${run.start}`,
    `Final page: ${run.url} — ${JSON.stringify(run.title)}`,
    `The Task ended: ${ended}`,
    `Said aloud: ${quoted(run.said)}`,
    `The page asked: ${asked}`,
    `On the Shelf: ${run.shelf.length === 0 ? 'nothing' : run.shelf.join(', ')}`,
    `On the clipboard: ${run.clipboard === null || run.clipboard === '' ? 'nothing' : JSON.stringify(run.clipboard)}`,
    'Text in view on the final page:',
    run.textInView.trim() === '' ? '(none)' : run.textInView,
  ].join('\n')
  return { system: GOAL_JUDGE_INSTRUCTIONS, user }
}

/** The judge's reply as a verdict, or null when it is none. */
export function readGoalVerdict(content: string): GoalVerdict | null {
  const raw = firstJsonObject(content)
  if (raw === null) return null
  const verdict = raw.verdict
  if (verdict !== 'done' && verdict !== 'miss' && verdict !== 'wall') return null
  return { verdict, why: typeof raw.why === 'string' ? raw.why.replace(/\s+/g, ' ').trim() : '' }
}

/** One run as the table keeps it: the verdict, or null when the judge gave none (its reason in `why`). */
export interface GoalRunScore {
  readonly verdict: GoalVerdictKind | null
  readonly why: string
  readonly seconds: number
  readonly ended: string | null
}

export interface GoalRow {
  readonly id: string
  readonly runs: readonly GoalRunScore[]
}

/** Nearest rank, as `pnpm perf:report` reads a percentile. */
function nearestRank(values: readonly number[], percent: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)]!
}

const seconds = (value: number): string => `${value.toFixed(1)}s`

/** The table: one row per case, the arm and the judge's id in the header, the tally under it. */
export function formatGoalGate(rows: readonly GoalRow[], context: { readonly arm: string; readonly judge: string }): string {
  const repeat = Math.max(1, ...rows.map((row) => row.runs.length))
  const cells = rows.map((row) => {
    const done = row.runs.filter((run) => run.verdict === 'done').length
    const last = row.runs.at(-1)!
    const judged = row.runs.filter((run) => run.verdict !== null)
    const unjudged = row.runs.length - judged.length
    const right = repeat === 1 ? (last.verdict === 'done' ? 'yes' : last.verdict === 'wall' ? 'wall' : 'no') : `${done}/${row.runs.length}`
    const why = (judged.at(-1) ?? last).why + (repeat > 1 && unjudged > 0 ? ` (${unjudged} unjudged)` : '')
    return [row.id, right, seconds(nearestRank(row.runs.map((run) => run.seconds), 50)), last.ended ?? '—', why]
  })
  const headers = ['case', 'right', 'seconds', 'ended', 'judge']
  const widths = headers.map((header, i) => Math.max(header.length, ...cells.map((row) => row[i]!.length)))
  const line = (row: string[]): string =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : i === 2 ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd()
  const runs = rows.flatMap((row) => row.runs)
  const done = runs.filter((run) => run.verdict === 'done').length
  const walls = runs.filter((run) => run.verdict === 'wall').length
  const all = runs.map((run) => run.seconds)
  const tally = runs.length === 0 ? 'no runs' : `done-right ${done}/${runs.length}, walls ${walls} | seconds p50 ${seconds(nearestRank(all, 50))} p95 ${seconds(nearestRank(all, 95))}`
  return [`goal:gate — ${context.arm}, judge ${context.judge}, ${rows.length} cases × ${repeat}`, line(headers), ...cells.map(line), tally].join('\n')
}
