// A Failed Line (#371): one spoken or typed line that did not do what was
// meant, kept as one file in the Failed Lines ledger (fixtures/failed-lines)
// with the first stage of the pipeline that failed it. The unit is the
// observed line, never the hypothesis about it: the cause is what
// `pnpm bugs` lets the reader derive by looking at the whole pile grouped by
// stage — nine lines under one stage is a strategy problem, one is a
// one-off. An issue that fixes behaviour claims the entries it covers;
// closing it marks each fixed, guarded by a corpus case or e2e test, or
// ruled. Zero runtime imports: the bugs:* scripts run this under node's
// type stripping (#36).

/**
 * The first failing stage, in the pipeline's order: the wake-word/STT
 * transcript; the turn split; the Local Match; Jev's reading (a wrong pick
 * among options that existed); a missing option (no Capability, op or
 * verb could do it); the runner's hop policy (cap, unchanged, undo,
 * Verdict); the Player; the page itself (a stale label, late hydration).
 */
export const FAILED_LINE_STAGES = ['stt', 'turn', 'local_match', 'reading', 'missing_option', 'runner', 'player', 'page'] as const
export type FailedLineStage = (typeof FAILED_LINE_STAGES)[number]

export const STAGE_MEANING: Readonly<Record<FailedLineStage, string>> = {
  stt: 'the words heard were not the words said',
  turn: 'the Utterance was cut or joined in the wrong place',
  local_match: 'the Local Match fired the wrong thing, or fired where Jev should have read',
  reading: 'Jev picked wrong among options that existed',
  missing_option: 'no Capability, op or verb could do what was meant',
  runner: 'the hop policy: the cap, unchanged, undo, the Verdict, what was said',
  player: 'the Player did the wrong thing with the right op',
  page: 'the page itself: a stale label, late hydration, a wall',
}

export interface FailedLine {
  /** Hop 0's turn id, or a `pm-<date>-<n>` id for a line whose logs are gone. */
  readonly turnId: string
  readonly transcript: string
  /** Wall-clock epoch ms when the line fired. */
  readonly at: number
  readonly source: 'spoken' | 'typed'
  /** The decision log file the line was read from, when it still exists. */
  readonly log?: string
  readonly stage: FailedLineStage
  /** One line each: what the app did, and what the user meant. */
  readonly happened: string
  readonly meant: string
  /** The issue that claims to cover it: `#371`. */
  readonly claimedBy?: string
  /** The commit that fixed it. */
  readonly fixedBy?: string
  /** The Jev corpus case, or e2e test, that guards it. */
  readonly case?: string
  /** An owner ruling that closes it without a fix. */
  readonly ruled?: string
}

export type FailedLineStatus = 'open' | 'fixed' | 'ruled'

export const statusOf = (line: FailedLine): FailedLineStatus => (line.fixedBy !== undefined ? 'fixed' : line.ruled !== undefined ? 'ruled' : 'open')

export const isStage = (value: unknown): value is FailedLineStage => typeof value === 'string' && (FAILED_LINE_STAGES as readonly string[]).includes(value)

const OPTIONAL_KEYS = ['log', 'claimedBy', 'fixedBy', 'case', 'ruled'] as const

/** The entry a ledger file holds, or why it is not one. */
export function readFailedLine(raw: unknown): FailedLine | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'not an object'
  const record = raw as Record<string, unknown>
  for (const key of ['turnId', 'transcript', 'happened', 'meant'] as const) {
    if (typeof record[key] !== 'string' || (record[key] as string).trim() === '') return `${key} is not a non-empty string`
  }
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return 'at is not a number'
  if (record.source !== 'spoken' && record.source !== 'typed') return 'source is not spoken or typed'
  if (!isStage(record.stage)) return `stage is not one of ${FAILED_LINE_STAGES.join(', ')}`
  const line: { -readonly [K in keyof FailedLine]: FailedLine[K] } = {
    turnId: record.turnId as string,
    transcript: record.transcript as string,
    at: record.at,
    source: record.source,
    stage: record.stage,
    happened: record.happened as string,
    meant: record.meant as string,
  }
  for (const key of OPTIONAL_KEYS) {
    const value = record[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') return `${key} is not a non-empty string`
    line[key] = value
  }
  if (line.claimedBy !== undefined && !/^#\d+$/.test(line.claimedBy)) return 'claimedBy is not #<issue>'
  return line
}

/** Where a line sorts: open and unclaimed first, open and claimed, then fixed and ruled; newest first within each. */
const rankOf = (line: FailedLine): number => (statusOf(line) === 'open' ? (line.claimedBy === undefined ? 0 : 1) : 2)

export function orderFailedLines(lines: readonly FailedLine[]): FailedLine[] {
  return [...lines].sort((a, b) => rankOf(a) - rankOf(b) || b.at - a.at)
}

export interface StageCount {
  readonly stage: FailedLineStage
  readonly open: number
  readonly claimed: number
  readonly fixed: number
  readonly ruled: number
}

/** Every stage with a line in it, most open lines first — the widest-net view. */
export function countByStage(lines: readonly FailedLine[]): StageCount[] {
  const counts = new Map<FailedLineStage, { open: number; claimed: number; fixed: number; ruled: number }>()
  for (const line of lines) {
    const count = counts.get(line.stage) ?? { open: 0, claimed: 0, fixed: 0, ruled: 0 }
    const status = statusOf(line)
    if (status === 'open') {
      count.open += 1
      if (line.claimedBy !== undefined) count.claimed += 1
    } else count[status] += 1
    counts.set(line.stage, count)
  }
  return [...counts]
    .map(([stage, count]): StageCount => ({ stage, ...count }))
    .sort((a, b) => b.open - a.open || b.fixed + b.ruled - (a.fixed + a.ruled) || FAILED_LINE_STAGES.indexOf(a.stage) - FAILED_LINE_STAGES.indexOf(b.stage))
}

const pad = (text: string, width: number): string => text.padEnd(width)

const two = (n: number): string => String(n).padStart(2, '0')

/** `2026-10-21 11:53`, in local time. */
export const whenOf = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** The claim column: unclaimed, claimed by an issue, fixed by a commit (and guarded by what), or ruled. */
export function claimOf(line: FailedLine): string {
  const guard = line.case !== undefined ? `, guarded by ${line.case}` : ''
  if (line.fixedBy !== undefined) return `fixed ${line.fixedBy}${line.claimedBy !== undefined ? ` (${line.claimedBy})` : ''}${guard}`
  if (line.ruled !== undefined) return `ruled: ${line.ruled}`
  return line.claimedBy !== undefined ? `claimed by ${line.claimedBy}${guard}` : 'unclaimed'
}

/** `pnpm bugs`: the stage counts, then every line under its stage, open and unclaimed first. */
export function formatLedger(lines: readonly FailedLine[], dir: string): string {
  if (lines.length === 0) return `no failed lines in ${dir}\nadd one: pnpm bugs:add <turnId> --stage <stage> --happened "…" --meant "…"`
  const open = lines.filter((line) => statusOf(line) === 'open')
  const unclaimed = open.filter((line) => line.claimedBy === undefined).length
  const fixed = lines.filter((line) => statusOf(line) === 'fixed').length
  const ruled = lines.filter((line) => statusOf(line) === 'ruled').length
  const out = [`${lines.length} failed lines in ${dir}: ${open.length} open (${unclaimed} unclaimed), ${fixed} fixed, ${ruled} ruled`, '']
  const counts = countByStage(lines)
  out.push(`${pad('stage', 16)}${pad('open', 7)}${pad('claimed', 9)}${pad('fixed', 7)}ruled`)
  for (const count of counts) out.push(`${pad(count.stage, 16)}${pad(String(count.open), 7)}${pad(String(count.claimed), 9)}${pad(String(count.fixed), 7)}${count.ruled}`)
  for (const count of counts) {
    out.push('', `## ${count.stage} — ${STAGE_MEANING[count.stage]} — ${count.open} open`)
    for (const line of orderFailedLines(lines.filter((line) => line.stage === count.stage))) {
      out.push(`${line.turnId}  ${whenOf(line.at)}  ${line.source}  "${line.transcript}"`)
      out.push(`  happened: ${line.happened}`)
      out.push(`  meant:    ${line.meant}`)
      out.push(`  ${claimOf(line)}`)
    }
  }
  return out.join('\n')
}
