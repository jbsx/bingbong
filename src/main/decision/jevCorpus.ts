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
        return { name, case: `not a case: ${error instanceof Error ? error.message : String(error)}` }
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
export function collectAsks(logsDir: string): Map<string, AskRecord> {
  return new Map(collectJsonlFamily(logsDir, ASK_FILE_PATTERN, parseAsk).records.map((ask) => [ask.id, ask]))
}

/**
 * A Command a misfire or overrun signal pointed at (#338): its words, what
 * it fired, and its ask — `recorded` in the sidecar, `missing` from it (named
 * but rolled off or purged), or `none` (Jev was not asked).
 */
export interface Candidate {
  readonly turnId: string
  readonly signals: readonly MisfireSignal[]
  readonly withinMs: number
  readonly transcript: string
  readonly fired: string
  readonly askId?: string
  readonly ask: 'recorded' | 'missing' | 'none'
}

function firedOf(record: DecisionRecord): string {
  const what = record.targetLabel !== undefined ? `"${record.targetLabel}"` : record.slot !== null ? `"${record.slot}"` : ''
  return what === '' ? record.verb : `${record.verb} ${what}`
}

/** `pnpm jev:candidates`: the Commands the decision log's misfire and overrun signals point at, in the order they fired. */
export function listCandidates(logsDir: string): Candidate[] {
  const records = collectDecisionRecords(logsDir).records
  const decisions = new Map<string, DecisionRecord>()
  const signals = new Map<string, MisfireRecord[]>()
  for (const record of records) {
    if (record.type === 'decision') decisions.set(record.turnId, record)
    else signals.set(record.turnId, [...(signals.get(record.turnId) ?? []), record])
  }
  const asks = collectAsks(logsDir)
  const candidates: Candidate[] = []
  for (const [turnId, decision] of decisions) {
    const misfires = signals.get(turnId)
    if (misfires === undefined) continue
    const askId = decision.ask
    candidates.push({
      turnId,
      signals: misfires.map((misfire) => misfire.signal),
      withinMs: Math.min(...misfires.map((misfire) => misfire.withinMs)),
      transcript: decision.transcript,
      fired: firedOf(decision),
      ...(askId !== undefined ? { askId } : {}),
      ask: askId === undefined ? 'none' : asks.has(askId) ? 'recorded' : 'missing',
    })
  }
  return candidates
}

export function formatCandidates(candidates: readonly Candidate[], logsDir: string): string {
  if (candidates.length === 0) return `no misfire or overrun signals in ${logsDir}`
  const lines = candidates.map((candidate) => {
    const ask =
      candidate.ask === 'recorded' ? `ask ${candidate.askId}` : candidate.ask === 'missing' ? `ask ${candidate.askId} is not in the sidecar` : 'no ask (Jev was not asked)'
    return `${candidate.turnId}  ${candidate.signals.join(',')}  "${candidate.transcript}" → ${candidate.fired}  ${ask}`
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
export function caseFromLog(logsDir: string, id: string, expectations: readonly string[], corpusDir: string): { path: string } | { error: string } {
  if (expectations.length === 0) return { error: 'no --expect given' }
  const parsed: JevExpectation[] = []
  for (const text of expectations) {
    const expectation = parseExpectation(text)
    if (typeof expectation === 'string') return { error: expectation }
    parsed.push(expectation)
  }
  const decision = collectDecisionRecords(logsDir).records.findLast((record): record is DecisionRecord => record.type === 'decision' && record.turnId === id)
  const askId = decision !== undefined ? decision.ask : id
  const ask = askId === undefined ? undefined : collectAsks(logsDir).get(askId)
  if (ask === undefined) return { error: `no ask recorded for ${id} in ${logsDir}` }
  for (const expectation of parsed) {
    const problem = expectationProblem(ask.questions, expectation)
    if (problem !== null) return { error: problem }
  }
  const jevCase: JevCase = {
    turnId: decision?.turnId ?? ask.turnId ?? ask.id,
    ...(decision !== undefined ? { transcript: decision.transcript } : {}),
    model: ask.model,
    recordedAt: ask.at,
    expect: parsed,
    ask: { state: ask.state, questions: ask.questions },
  }
  mkdirSync(corpusDir, { recursive: true })
  const path = join(corpusDir, `${id}.json`)
  writeFileSync(path, `${JSON.stringify(jevCase, null, 2)}\n`)
  return { path }
}
