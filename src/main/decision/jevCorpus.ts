import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DecisionRecord, MisfireRecord, MisfireSignal } from '../../core/command/decisionRecord'
import type { AskRecord } from '../../core/decision/askRecord'
import { resolveDecisionRouting } from '../../core/decision/decisionRouting.ts'
import {
  expectationProblem,
  formatJevReplay,
  judgeJevCase,
  parseExpectation,
  readJevCase,
  type CaseVerdict,
  type JevCase,
  type JevExpectation,
} from '../../core/decision/jevCase.ts'
import type { DecisionModel } from '../../core/ports/decisionModel'
import { toErrorMessage } from '../../core/errors.ts'
import { reportFault } from '../../core/trace/fault.ts'
import { collectDecisionRecords } from '../perf/collectDecisionRecords.ts'
import { collectJsonlFamily } from '../perf/collectPerfRecords.ts'
import { ASK_FILE_PATTERN } from '../perf/perfFiles.ts'
import { createJevDecisionModel } from './createJevDecisionModel.ts'

// The Jev corpus on disk (#338): a folder of case files, each a recorded
// ask and the answer each question should get, which `pnpm jev:replay`
// asks the real Jev again. Nothing is committed to it automatically —
// asks carry page text from real browsing — so a case lands only when the
// owner promotes one (`pnpm jev:case`). Imports carry .ts extensions (#36):
// the jev:* scripts run this unbundled under node's type stripping.

/** The corpus folder in the repo: the cases the owner chose to promote. */
export const JEV_CORPUS_DIR = fileURLToPath(new URL('../../../fixtures/jev-cases/', import.meta.url))

/** A replay is no round: Jev is given this long, not the round's 800 ms, so a slow answer is not read as a misread. */
const REPLAY_TIMEOUT_MS = 15_000

/** One case file in the corpus: its name (the file's, less `.json`), and the case or why it is not one. */
export interface CorpusEntry {
  readonly name: string
  readonly case: JevCase | string
}

export function readCorpus(dir: string): CorpusEntry[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file): CorpusEntry => {
      const name = file.slice(0, -'.json'.length)
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      } catch (error) {
        return { name, case: `not a case: ${toErrorMessage(error)}` }
      }
      const read = readJevCase(raw)
      return { name, case: typeof read === 'string' ? `not a case: ${read}` : read }
    })
}

export interface ReplayDeps {
  readonly env: Record<string, string | undefined>
  /** A Decision Model in place of the real Jev the env's key reaches — tests only. */
  readonly model?: DecisionModel
}

/** What a replay came to: the exit code (0 all passed, 1 a case failed, 2 no key) and the report. */
export interface Replay {
  readonly code: number
  readonly report: string
}

/** `pnpm jev:replay [dir]`: every case in the folder asked again, in order, and judged. */
export async function replayCorpus(dir: string, deps: ReplayDeps): Promise<Replay> {
  let model = deps.model
  if (model === undefined) {
    const routing = resolveDecisionRouting(deps.env)
    if (!routing.configured) return { code: 2, report: `jev:replay asks the real Jev and needs its key — ${routing.reason}` }
    model = createJevDecisionModel(routing.endpoint, { timeoutMs: REPLAY_TIMEOUT_MS })
  }
  const entries = readCorpus(dir)
  if (entries.length === 0) return { code: 0, report: `no cases in ${dir}` }
  const verdicts: CaseVerdict[] = []
  for (const entry of entries) {
    if (typeof entry.case === 'string') {
      verdicts.push({ name: entry.name, pass: false, problem: entry.case })
      continue
    }
    const result = await model.ask({ state: entry.case.ask.state, questions: entry.case.ask.questions })
    verdicts.push(judgeJevCase(entry.name, entry.case, result))
  }
  return { code: verdicts.every((verdict) => verdict.pass) ? 0 : 1, report: formatJevReplay(verdicts, model.model) }
}

function parseAsk(line: string): AskRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    reportFault('decision.jevCorpus.parseAsk', error)
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (record.type !== 'ask' || typeof record.id !== 'string' || typeof record.state !== 'string') return null
  if (typeof record.questions !== 'object' || record.questions === null) return null
  return parsed as AskRecord
}

/** Every ask in the sidecar under the logs dir, by id. */
function collectAsks(logsDir: string): Map<string, AskRecord> {
  return new Map(collectJsonlFamily(logsDir, ASK_FILE_PATTERN, parseAsk).records.map((ask) => [ask.id, ask]))
}

/**
 * Where a candidate's ask stands: `recorded` in the sidecar, `missing` from
 * it (named, but rolled off or purged), `none` (Jev was not asked), or
 * `no_decision` (the signal's decision record itself is gone).
 */
export type CandidateAsk = 'recorded' | 'missing' | 'none' | 'no_decision'

/** A Command a misfire or overrun signal pointed at (#338): its words and what it fired, when its record is still logged, and its ask. */
export interface Candidate {
  readonly turnId: string
  readonly signals: readonly MisfireSignal[]
  readonly withinMs: number
  readonly read?: { readonly transcript: string; readonly fired: string }
  readonly askId?: string
  /** The asks of the Utterance's partials, which a misread partial is promoted from by its own id. */
  readonly partialAsks?: readonly string[]
  readonly ask: CandidateAsk
}

function firedOf(record: DecisionRecord): string {
  const what = record.targetLabel !== undefined ? `"${record.targetLabel}"` : record.slot !== null ? `"${record.slot}"` : ''
  return what === '' ? record.verb : `${record.verb} ${what}`
}

/** `pnpm jev:candidates`: the Commands the decision log's misfire and overrun signals point at, in the order the signals came. */
export function listCandidates(logsDir: string): Candidate[] {
  const records = collectDecisionRecords(logsDir).records
  const decisions = new Map<string, DecisionRecord>()
  const signals = new Map<string, MisfireRecord[]>()
  for (const record of records) {
    if (record.type === 'decision') decisions.set(record.turnId, record)
    else signals.set(record.turnId, [...(signals.get(record.turnId) ?? []), record])
  }
  const asks = collectAsks(logsDir)
  return [...signals].map(([turnId, misfires]): Candidate => {
    const decision = decisions.get(turnId)
    const askId = decision?.ask
    return {
      turnId,
      signals: misfires.map((misfire) => misfire.signal),
      withinMs: Math.min(...misfires.map((misfire) => misfire.withinMs)),
      ...(decision !== undefined ? { read: { transcript: decision.transcript, fired: firedOf(decision) } } : {}),
      ...(askId !== undefined ? { askId } : {}),
      ...(decision?.partialAsks !== undefined ? { partialAsks: decision.partialAsks } : {}),
      ask: decision === undefined ? 'no_decision' : askId === undefined ? 'none' : asks.has(askId) ? 'recorded' : 'missing',
    }
  })
}

const ASK_STANDING: Readonly<Record<CandidateAsk, (askId: string | undefined) => string>> = {
  recorded: (askId) => `ask ${askId}`,
  missing: (askId) => `ask ${askId} is not in the sidecar`,
  none: () => 'no ask (Jev was not asked)',
  no_decision: () => 'no decision record (rolled off or purged)',
}

export function formatCandidates(candidates: readonly Candidate[], logsDir: string): string {
  if (candidates.length === 0) return `no misfire or overrun signals in ${logsDir}`
  const lines = candidates.map((candidate) => {
    const read = candidate.read !== undefined ? `  "${candidate.read.transcript}" → ${candidate.read.fired}` : ''
    const partials = candidate.partialAsks !== undefined ? `  partials ${candidate.partialAsks.join(',')}` : ''
    return `${candidate.turnId}  ${candidate.signals.join(',')}${read}  ${ASK_STANDING[candidate.ask](candidate.askId)}${partials}`
  })
  return [...lines, '', 'promote one: pnpm jev:case <turnId> --expect <question>=<label> [<question>!=<label> …]'].join('\n')
}

/**
 * `pnpm jev:case <turnId> --expect …`: the ask a logged Command was read
 * from (or a partial's ask, by its own id), with the answers it should
 * have got, written as a case in the corpus folder. Every expectation is
 * checked against the ask's own questions first: nothing is written for
 * one the replay could not judge.
 */
export function caseFromLog(logsDir: string, id: string, expectations: readonly string[], corpusDir: string): { path: string; replaced: boolean } | { error: string } {
  if (expectations.length === 0) return { error: 'no --expect given' }
  const parsed: JevExpectation[] = []
  for (const text of expectations) {
    const expectation = parseExpectation(text)
    if (typeof expectation === 'string') return { error: expectation }
    parsed.push(expectation)
  }
  // A Command's record by its turn, or — a Step's own ask named by its id (#364) — by the ask it was read from.
  const decision = collectDecisionRecords(logsDir).records.findLast((record): record is DecisionRecord => record.type === 'decision' && (record.turnId === id || record.ask === id))
  const asks = collectAsks(logsDir)
  // A line read as Steps (#364) holds two asks on its first Step's turn: the Step's own, and the one that split the line — taken when the expectations judge a question only it asked.
  const askIds = decision !== undefined ? [decision.ask, decision.split?.ask].filter((askId): askId is string => askId !== undefined && (askId === id || id === decision.turnId)) : [id]
  const judged = askIds.find((askId) => parsed.every((expectation) => expectation.question in (asks.get(askId)?.questions ?? {})))
  const askId = judged ?? askIds[0]
  const ask = askId === undefined ? undefined : asks.get(askId)
  if (ask === undefined) return { error: `no ask recorded for ${id} in ${logsDir}` }
  for (const expectation of parsed) {
    const problem = expectationProblem(ask.questions, expectation)
    if (problem !== null) return { error: problem }
  }
  // The split's case is the whole line's; a Step's case carries the Step's words.
  const transcript = decision === undefined ? undefined : askId === decision.split?.ask ? decision.split.line : decision.transcript
  const jevCase: JevCase = {
    turnId: decision?.turnId ?? ask.turnId ?? ask.id,
    ...(transcript !== undefined ? { transcript } : {}),
    model: ask.model,
    recordedAt: ask.at,
    expect: parsed,
    ask: { state: ask.state, questions: ask.questions },
  }
  mkdirSync(corpusDir, { recursive: true })
  const path = join(corpusDir, `${id}.json`)
  // Promoting a case again with other expectations replaces it, and says so.
  const replaced = existsSync(path)
  writeFileSync(path, `${JSON.stringify(jevCase, null, 2)}\n`)
  return { path, replaced }
}
