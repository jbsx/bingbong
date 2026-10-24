import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isStage, readFailedLine, whenOf, type FailedLine, type FailedLineStage } from '../../core/bugs/failedLine.ts'
import type { CommandLogRecord, DecisionRecord, FlagRecord, MisfireSignal, TaskEnded } from '../../core/command/decisionRecord'
import { toErrorMessage } from '../../core/errors.ts'
import { reportFault } from '../../core/trace/fault.ts'
import { FLAGS_DIR, flagDirOf } from '../logs/flagKeeper.ts'
import { collectDecisionRecords } from '../perf/collectDecisionRecords.ts'
import { DECISION_FILE_PATTERN } from '../perf/perfFiles.ts'

// The Failed Lines ledger on disk (#371): a folder of entry files, one per
// line that did not do what was meant, which `pnpm bugs` prints grouped by
// first failing stage. `pnpm bugs:candidates` finds the lines in the
// decision logs that look failed and are not yet in it; `pnpm bugs:add`
// writes one from its logged record. Imports carry .ts extensions (#36):
// the bugs:* scripts run this unbundled under node's type stripping.

/** The ledger folder in the repo. */
export const FAILED_LINES_DIR = fileURLToPath(new URL('../../../fixtures/failed-lines/', import.meta.url))

export interface LedgerEntry {
  readonly name: string
  readonly line: FailedLine | string
}

export function readLedger(dir: string): LedgerEntry[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file): LedgerEntry => {
      const name = file.slice(0, -'.json'.length)
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      } catch (error) {
        return { name, line: `not an entry: ${toErrorMessage(error)}` }
      }
      const read = readFailedLine(raw)
      return { name, line: typeof read === 'string' ? `not an entry: ${read}` : read }
    })
}

/** The entries that read, and one line per file that did not. */
export function ledgerLines(entries: readonly LedgerEntry[]): { lines: FailedLine[]; problems: string[] } {
  const lines: FailedLine[] = []
  const problems: string[] = []
  for (const entry of entries) {
    if (typeof entry.line === 'string') problems.push(`${entry.name}.json: ${entry.line}`)
    else lines.push(entry.line)
  }
  return { lines, problems }
}

/** Same transcript spoken again within this long: the first try failed. */
const REPEAT_WITHIN_MS = 30_000
/** A `resume` or a bare `play` this soon after a Command: that Command stopped something. */
const RESUMED_WITHIN_MS = 15_000
/** A hop-0 `none` by Jev under this confidence: a line it could not read, not a remark. */
const NONE_UNSURE_BELOW = 0.6
/** A Task's end that says it did not land. */
/** Scrolling again is use, not a retry. */
const SCROLLS: ReadonlySet<string> = new Set(['scroll_up', 'scroll_down'])
const FAILED_ENDS: ReadonlySet<TaskEnded> = new Set(['cap', 'unsure', 'wall', 'unchanged', 'not_found'])

/** What pointed at a line: the user flagged it (#421), the next Command repeated it, its Task ended short, Jev read none unsure, a resume followed, the runner undid it, or a Misfire signal. */
export type BugSignal = 'flagged' | 'repeat' | `ended:${TaskEnded}` | 'none' | 'resumed' | 'undo' | `misfire:${MisfireSignal}`

export interface BugCandidate {
  /** Hop 0's turn id: the Task's. */
  readonly turnId: string
  readonly at: number
  readonly transcript: string
  readonly signals: readonly BugSignal[]
  /** What the Flags of it said (#421), in the order said; absent when none said any. */
  readonly hints?: readonly string[]
}

const normal = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim()

const hopOf = (record: DecisionRecord): number => record.task?.hop ?? 0
const taskOf = (record: DecisionRecord): string => record.task?.id ?? record.turnId
const isHop0 = (record: DecisionRecord): boolean => hopOf(record) === 0 && record.undo !== true && record.runnerUp !== true && record.stepAside !== true
/** A `resume`, or a bare `play` carrying on the paused song; a record logged before #374 carries no music, and its bare `play` is one with no Slot, no video and no Capability named. */
const resumes = (record: DecisionRecord): boolean =>
  record.verb === 'resume' || (record.verb === 'play' && (record.music !== undefined ? record.music.kind === 'unpause' : record.slot === null && record.video === undefined && !('capability' in record)))

/**
 * The decision log's records and the Flag copies' under `flags/` (#421),
 * each once: a flagged Task is still read after its own log has rolled
 * away.
 */
function logRecords(logsDir: string): CommandLogRecord[] {
  const flags = join(logsDir, FLAGS_DIR)
  let kept: string[] = []
  if (existsSync(flags)) {
    try {
      kept = readdirSync(flags)
    } catch (error) {
      reportFault('bugs.ledger.logRecords.listFlags', error)
    }
  }
  const seen = new Set<string>()
  return [collectDecisionRecords(logsDir).records, ...kept.map((taskId) => collectDecisionRecords(flagDirOf(logsDir, taskId)).records)].flat().filter((record) => {
    const key = JSON.stringify(record)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Every hint the Flags of a Task said (#421), in the order said. */
function hintsOf(records: readonly CommandLogRecord[], taskId: string): string[] {
  return records
    .filter((record): record is FlagRecord => record.type === 'flag' && record.taskId === taskId)
    .sort((a, b) => a.at - b.at)
    .flatMap((record) => (record.hint !== undefined ? [record.hint] : []))
}

/** `pnpm bugs:candidates`: the Tasks in the logs a signal points at, flagged ones first (#421), each in time order, less those the ledger already holds. */
export function listBugCandidates(logsDir: string, ledger: readonly FailedLine[]): BugCandidate[] {
  const records = logRecords(logsDir)
  const decisions = records.filter((record): record is DecisionRecord => record.type === 'decision').sort((a, b) => a.at - b.at)
  const hop0 = decisions.filter(isHop0)
  const found = new Map<string, { at: number; transcript: string; signals: Set<BugSignal> }>()
  const flag = (task: string, signal: BugSignal): void => {
    const first = hop0.find((record) => record.turnId === task)
    if (first === undefined) return
    const entry = found.get(task) ?? { at: first.at, transcript: first.transcript, signals: new Set<BugSignal>() }
    entry.signals.add(signal)
    found.set(task, entry)
  }
  for (const [index, record] of hop0.entries()) {
    const next = hop0[index + 1]
    if (next !== undefined && next.at - record.at <= REPEAT_WITHIN_MS && !SCROLLS.has(record.verb) && normal(next.transcript) === normal(record.transcript) && normal(record.transcript) !== '') flag(record.turnId, 'repeat')
    if (next !== undefined && next.at - record.at <= RESUMED_WITHIN_MS && resumes(next) && record.verb !== 'resume') flag(record.turnId, 'resumed')
    if (record.reading === 'jev' && record.verb === 'none' && record.jev !== undefined && 'confidence' in record.jev && record.jev.confidence.action < NONE_UNSURE_BELOW) flag(record.turnId, 'none')
  }
  for (const record of decisions) {
    if (record.ended !== undefined && FAILED_ENDS.has(record.ended)) flag(taskOf(record), `ended:${record.ended}`)
    if (record.undo === true) flag(taskOf(record), 'undo')
  }
  for (const record of records) {
    if (record.type === 'misfire') flag(record.turnId, `misfire:${record.signal}`)
    if (record.type === 'flag') flag(record.taskId, 'flagged')
  }
  const known = new Set(ledger.map((line) => line.turnId))
  return [...found]
    .filter(([task]) => !known.has(task))
    .map(([turnId, entry]): BugCandidate => {
      const hints = entry.signals.has('flagged') ? hintsOf(records, turnId) : []
      // The user's own word comes before what the logs suggest.
      const signals = [...entry.signals].sort((a, b) => Number(b === 'flagged') - Number(a === 'flagged'))
      return { turnId, at: entry.at, transcript: entry.transcript, signals, ...(hints.length > 0 ? { hints } : {}) }
    })
    .sort((a, b) => Number(b.signals.includes('flagged')) - Number(a.signals.includes('flagged')) || a.at - b.at)
}

export function formatBugCandidates(candidates: readonly BugCandidate[], logsDir: string): string {
  if (candidates.length === 0) return `no failed-looking lines in ${logsDir} that the ledger does not hold`
  const rows = candidates.map((candidate) => `${candidate.turnId}  ${whenOf(candidate.at)}  "${candidate.transcript}"  ${candidate.signals.join(',')}${candidate.hints !== undefined ? `  hint: ${candidate.hints.map((hint) => `"${hint}"`).join('; ')}` : ''}`)
  return [...rows, '', 'add one: pnpm bugs:add <turnId> --stage <stage> --happened "…" --meant "…" [--claimed #NNN] (a flagged line takes its hint as --happened)'].join('\n')
}

/** The hop-0 record of a turn and the log file holding it, in the logs or, once they have rolled, its Flag copy (#421); null when no file does. */
function findDecision(logsDir: string, turnId: string): { record: DecisionRecord; log: string } | null {
  const kept = flagDirOf(logsDir, turnId)
  return findDecisionIn(logsDir, turnId, '') ?? (existsSync(kept) ? findDecisionIn(kept, turnId, `${FLAGS_DIR}/${turnId}/`) : null)
}

function findDecisionIn(logsDir: string, turnId: string, logPrefix: string): { record: DecisionRecord; log: string } | null {
  let names: string[]
  try {
    names = readdirSync(logsDir).filter((name) => DECISION_FILE_PATTERN.test(name)).sort()
  } catch (error) {
    reportFault('bugs.ledger.findDecision.listFiles', error)
    return null
  }
  for (const name of names) {
    let text: string
    try {
      text = readFileSync(join(logsDir, name), 'utf8')
    } catch (error) {
      reportFault('bugs.ledger.findDecision.readFile', error)
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.includes(turnId)) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        reportFault('bugs.ledger.findDecision.parseLine', error)
        continue
      }
      const record = parsed as Partial<DecisionRecord>
      if (record.type === 'decision' && record.turnId === turnId && typeof record.transcript === 'string' && typeof record.at === 'number') return { record: record as DecisionRecord, log: `${logPrefix}${name}` }
    }
  }
  return null
}

/** What `pnpm bugs:add` sets: the stage, the two lines and the claim on a new entry; any of them, or a fix, a guard or a ruling, on an existing one. */
export interface FailedLineFields {
  readonly stage?: string
  readonly happened?: string
  readonly meant?: string
  readonly claimedBy?: string
  readonly fixedBy?: string
  readonly case?: string
  readonly ruled?: string
}

/**
 * Write a ledger entry for a logged turn, or update the one it has. A new
 * entry needs the stage and both lines, and the turn in the logs; a
 * flagged turn's hints stand for what happened when none is given (#421).
 * An update takes any field. Nothing is written for an unknown stage.
 */
export function addFailedLine(logsDir: string, dir: string, turnId: string, fields: FailedLineFields): { path: string; replaced: boolean } | { error: string } {
  if (fields.stage !== undefined && !isStage(fields.stage)) return { error: `"${fields.stage}" is not a stage: stt, turn, local_match, reading, missing_option, runner, player or page` }
  if (fields.claimedBy !== undefined && !/^#\d+$/.test(fields.claimedBy)) return { error: `"${fields.claimedBy}" is not #<issue>` }
  const path = join(dir, `${turnId}.json`)
  const existing = readLedger(dir).find((entry) => entry.name === turnId)
  if (existing !== undefined && typeof existing.line === 'string') return { error: `${path} is ${existing.line}` }
  let base: FailedLine
  if (existing !== undefined) base = existing.line as FailedLine
  else {
    const stage = fields.stage
    const hints = fields.happened === undefined ? hintsOf(logRecords(logsDir), turnId) : []
    const happened = fields.happened ?? (hints.length > 0 ? hints.join('; ') : undefined)
    if (stage === undefined || happened === undefined || fields.meant === undefined) return { error: `no entry for ${turnId} yet: --stage, --happened and --meant are needed` }
    const found = findDecision(logsDir, turnId)
    if (found === null) return { error: `no decision record for ${turnId} in ${logsDir}` }
    base = { turnId, transcript: found.record.transcript, at: found.record.at, source: found.record.source, log: found.log, stage: stage as FailedLineStage, happened, meant: fields.meant }
  }
  const { stage, ...rest } = fields
  const line = readFailedLine({ ...base, ...(stage !== undefined ? { stage } : {}), ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) })
  if (typeof line === 'string') return { error: line }
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(line, null, 2)}\n`)
  return { path, replaced: existing !== undefined }
}
