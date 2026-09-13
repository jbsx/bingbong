// The Round Audit entry point (#234, ADR 0045): `pnpm live:audit`.
//
//   pnpm live:audit --capture=<set.json> [--capture=…] [--model=<id>] [--effort=<level>] [--max-usd=<n>]
//                   [--out-dir=<dir>] [--aggregate=<name>] [--grades=<grades.json>]… [--only=<attemptId>]
//                   [--prompts-dir=<dir>] [--dry-run] [--fresh]
//
// For every attempt of every named capture set: the mechanical half
// classifies the orchestrator rounds from the Run Trace and the perf log
// (e2e/live/audit.ts), and a reviewer that is not the measured model judges
// what needs judgement from the per-round digest and the Grading Key bundle
// `live:grade` builds — one `claude -p` call per attempt, no tools, run one
// at a time, cached per attempt so a failed call never redoes the others.
// One JSON and one Markdown per set, plus one aggregate across the sets,
// land in the reports directory and are written once, never over.
//
// This is the fourth script allowed to import the keys (`corpus.test.ts`):
// the reviewer reads the key exactly as `live:grade` shows it, and the
// outputs name check ids and pages, never key text — checked here before
// anything is written, and by `audit.test.ts` over the committed files.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { PerfSpanRecord } from '../src/core/perf/perfTracer'
import type { TraceRecord } from '../src/core/trace/runTrace'
import { LIVE_ARTIFACTS_ROOT, LIVE_PRIVATE_ROOT, parseJsonl, readCaptureSet, writeFileAtomic } from '../e2e/live/artifacts.ts'
import {
  AUDIT_VERDICTS,
  JUDGEMENT_SCHEMA,
  ROUND_KINDS,
  buildAuditAggregate,
  buildAuditSet,
  checkpointedUrlsOf,
  classifyAttempt,
  countsAfterOverrulesOf,
  formatAuditAggregate,
  formatAuditSet,
  keyLeaks,
  validateJudgement,
  type AuditAttempt,
  type AuditJudgement,
  type AuditMechanical,
  type AuditProvenance,
  type AuditReview,
  type AuditSetOutput,
} from '../e2e/live/audit.ts'
import { indexAttempts, parseLiveGrades, type LiveGradeEntry, type LiveGrades, type LiveGradingInputs, type LiveKeyTask } from '../e2e/live/grades.ts'
import { dispatchedAttemptOf } from '../e2e/live/gradingBench.ts'
import { buildLiveKeyManifest, gradingKeyFor, type GradingKey } from '../e2e/live/keyManifest.ts'
import type { LiveAttemptCapture, LiveSessionCapture } from '../e2e/live/types.ts'

const FLAGS = ['capture', 'model', 'effort', 'max-usd', 'out-dir', 'aggregate', 'grades', 'only', 'prompts-dir', 'dry-run', 'fresh'] as const
const REPEATABLE: readonly string[] = ['capture', 'grades']

const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_EFFORT = 'high'
/** A per-call spending guard for the CLI, the one `live:grade` uses. */
const DEFAULT_MAX_USD = '3'
const DEFAULT_OUT_DIR = 'e2e/live/reports'
const DEFAULT_AGGREGATE = 'audit-aggregate'
/** Bumped whenever the system prompt or the digest's presentation changes; recorded in every output. */
const AUDIT_PROMPT_VERSION = 'audit-p1'
const CACHE_DIR = join(LIVE_ARTIFACTS_ROOT, 'audit-cache')

class UsageError extends Error {}

function fail(message: string): never {
  process.stderr.write(`live:audit: ${message}\n`)
  process.exit(1)
}

function failWith(what: string, errors: readonly string[]): never {
  process.stderr.write(`live:audit: ${what}\n`)
  for (const error of errors) process.stderr.write(`  - ${error}\n`)
  process.exit(1)
}

function note(message: string): void {
  process.stderr.write(`live:audit: ${message}\n`)
}

function parseArgv(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>()
  for (const argument of argv) {
    if (!argument.startsWith('--')) throw new UsageError(`unexpected argument "${argument}"`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    const value = separator === -1 ? 'true' : argument.slice(separator + 1)
    if (!(FLAGS as readonly string[]).includes(name)) throw new UsageError(`unknown option --${name} (takes ${FLAGS.map((flag) => `--${flag}`).join(', ')})`)
    if (flags.has(name) && !REPEATABLE.includes(name)) throw new UsageError(`--${name} was given more than once`)
    if (value === '') throw new UsageError(`--${name} was given an empty value`)
    flags.set(name, [...(flags.get(name) ?? []), value])
  }
  return flags
}

function display(path: string): string {
  const absolute = resolve(path)
  return absolute.startsWith(`${process.cwd()}/`) ? absolute.slice(process.cwd().length + 1) : isAbsolute(path) ? basename(path) : path
}

function gitProvenance(): { commit: string; dirtyTree: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
    return { commit, dirtyTree: status.trim() !== '' }
  } catch {
    return { commit: 'unknown', dirtyTree: false }
  }
}

// ---------------------------------------------------------------------------
// Reading a set

interface SetContext {
  readonly path: string
  readonly inputs: LiveGradingInputs
  readonly setDirectory: string
  readonly sessionDirectories: ReadonlyMap<string, string>
  readonly grades: LiveGrades | null
  readonly gradesNote: string | null
}

function readSet(capturePath: string, gradesPaths: readonly string[]): SetContext {
  const capture = readCaptureSet(capturePath)
  if (!capture.ok) failWith(`the capture set at ${display(capturePath)} does not validate`, capture.errors)
  const { set } = capture.value
  if (set.mode !== 'measured') fail(`the capture set ${set.setId} is a ${set.mode} set — only a measured set is audited`)
  const sessionErrors = capture.value.sessions.flatMap((session) => (session.ok ? [] : session.errors))
  if (sessionErrors.length > 0) failWith('the capture set references Session captures that do not validate', sessionErrors)
  const sessions = capture.value.sessions.map((session) => (session as { value: LiveSessionCapture }).value)
  const setDirectory = realpathSync(dirname(resolve(capturePath)))
  const sessionDirectories = new Map(set.sessions.map((reference) => [reference.captureId, realpathSync(dirname(resolve(setDirectory, reference.path)))]))
  const manifest = buildLiveKeyManifest()
  const inputs: LiveGradingInputs = { set, sessions, manifest }
  const { duplicated } = indexAttempts(sessions)
  if (duplicated.length > 0) failWith('attempt id(s) claimed by more than one Session capture', duplicated)

  // The grades: an explicit file bound to this set, else the one file in the
  // private root bound to it. Two candidates is a decision the caller makes.
  const candidates: string[] = []
  const explicit = gradesPaths.filter((path) => {
    const raw = readJsonQuietly(path)
    return raw !== null && (raw as { setId?: unknown }).setId === set.setId
  })
  if (explicit.length > 0) candidates.push(...explicit)
  else if (existsSync(LIVE_PRIVATE_ROOT)) {
    for (const name of readdirSync(LIVE_PRIVATE_ROOT).filter((name) => name.endsWith('.json')).sort()) {
      const raw = readJsonQuietly(join(LIVE_PRIVATE_ROOT, name)) as { kind?: unknown; setId?: unknown; entries?: unknown } | null
      if (raw !== null && raw.kind === 'bingbong.live.grades' && raw.setId === set.setId) candidates.push(join(LIVE_PRIVATE_ROOT, name))
    }
  }
  if (candidates.length > 1) fail(`${candidates.length} grades files are bound to ${set.setId}; pass --grades=<file> to name the one to read`)
  let grades: LiveGrades | null = null
  let gradesNote: string | null = null
  if (candidates.length === 0) gradesNote = `no grades file is bound to ${set.setId}: every check is reported as not reached`
  else {
    const parsed = parseLiveGrades(readJsonQuietly(candidates[0]!), inputs)
    if (!parsed.ok) failWith(`the grades file for ${set.setId} does not validate`, parsed.errors)
    grades = parsed.value
  }
  return { path: capturePath, inputs, setDirectory, sessionDirectories, grades, gradesNote }
}

function readJsonQuietly(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** The turn's records from every retained file of one family, in file order. */
function turnRecords<T>(session: LiveSessionCapture, directory: string, family: 'run_trace' | 'perf', turnId: string): T[] {
  const records: T[] = []
  for (const artifact of session.artifacts.filter((artifact) => artifact.family === family)) {
    const path = resolve(directory, artifact.path)
    if (!path.startsWith(`${directory}${sep}`) || !existsSync(path)) continue
    for (const record of parseJsonl(readFileSync(path, 'utf8')).records) {
      if (typeof record === 'object' && record !== null && (record as { turnId?: unknown }).turnId === turnId) records.push(record as T)
    }
  }
  return records
}

// ---------------------------------------------------------------------------
// What the reviewer is shown

const clip = (text: string | null, limit: number): string => (text === null ? '' : text.length <= limit ? text : `${text.slice(0, limit)}…`)

function numbered(items: readonly string[], prefix: string): string {
  return items.map((item, index) => `- ${prefix}-${String(index + 1).padStart(2, '0')}: ${item}`).join('\n')
}

function bullets(items: readonly string[]): string {
  return items.length === 0 ? '- (none)' : items.map((item) => `- ${item}`).join('\n')
}

function sourcesBlock(sources: GradingKey['sources']): string {
  return sources.map((source, index) => `- S${index + 1}: ${source.url}\n  verified to state: ${source.supports}`).join('\n')
}

/** The key as `live:grade` shows it for this step, so both reviewers read the same bundle. */
function keyBlock(key: GradingKey, task: LiveKeyTask): string {
  const shared = `Constraints (how the key is graded; context for judging what a page could carry):\n${bullets(key.constraints)}`
  if (task.stepId === 'follow_up' && key.followUpDelta !== undefined) {
    const delta = key.followUpDelta
    return [
      `This is the predefined follow-up. Its required facts come from the delta below; the initial's are context.`,
      shared,
      `Required facts of the follow-up (the fact-NN checks):\n${numbered(delta.requiredFacts, 'fact')}`,
      `Pitfalls the follow-up must avoid (the pitfall-NN checks):\n${numbered(delta.pitfalls, 'pitfall')}`,
      `Sources verified for the follow-up:\n${sourcesBlock(delta.sources)}`,
      `For context — the initial's required facts:\n${bullets(key.requiredFacts)}`,
      `For context — the initial's sources:\n${sourcesBlock(key.sources)}`,
    ].join('\n\n')
  }
  return [
    shared,
    `Required facts (the fact-NN checks):\n${numbered(key.requiredFacts, 'fact')}`,
    `Pitfalls (the pitfall-NN checks):\n${numbered(key.pitfalls, 'pitfall')}`,
    `Uncertainties (the uncertainty-NN checks):\n${key.uncertainties.length === 0 ? '- (none)' : numbered(key.uncertainties, 'uncertainty')}`,
    `Sources verified for this key:\n${sourcesBlock(key.sources)}`,
  ].join('\n\n')
}

/** Every string of the key bundle, labelled by kind, for the leak check. */
function keyTextsOf(key: GradingKey): { label: string; text: string }[] {
  const texts: { label: string; text: string }[] = []
  key.requiredFacts.forEach((text) => texts.push({ label: 'required fact', text }))
  key.constraints.forEach((text) => texts.push({ label: 'constraint', text }))
  key.pitfalls.forEach((text) => texts.push({ label: 'pitfall', text }))
  key.uncertainties.forEach((text) => texts.push({ label: 'uncertainty', text }))
  key.sources.forEach((source) => texts.push({ label: 'source statement', text: source.supports }))
  key.liveFacts.forEach((text) => texts.push({ label: 'live fact', text }))
  if (key.followUpDelta !== undefined) {
    key.followUpDelta.requiredFacts.forEach((text) => texts.push({ label: 'follow-up required fact', text }))
    key.followUpDelta.pitfalls.forEach((text) => texts.push({ label: 'follow-up pitfall', text }))
    key.followUpDelta.sources.forEach((source) => texts.push({ label: 'follow-up source statement', text: source.supports }))
  }
  return texts
}

const SYSTEM_PROMPT = `You are the reviewer of one attempt's Round Audit for a performance study of a browsing assistant. Code has already classified every model round of the attempt by the kind of work it did; you judge what code cannot, from the per-round digest and the private Grading Key, with no tools. You are not the assistant that produced the rounds, and nothing outside the message is available to you.

The taxonomy, one kind per round (glossary terms):
- Acquisition with Progress: tool work that brought new material in or moved the page to somewhere the Run had not been.
- Acquisition without Progress: a repeat observation of a state already observed, a navigate to a URL the Run already acquired, a scroll that answered End of Page, or a member of a Search Loop.
- Collection: reading a finished Subagent Report.
- Bookkeeping: record_evidence, record_candidate, report_run_plan. A rejected Evidence Checkpoint is counted beside the round.
- Failed round: a timeout, an empty or failed reply, a cut round, or a round whose every call was refused.
- Finalization: the bookkeeping round and the reserved Answer, after the Run stopped acquiring; outside the budget.
Off-key is a judgement laid over Acquisition rounds, not a seventh kind: an Acquisition on a page that can carry none of the key's required facts for this task.

What you judge, in this order:
1. Search Loop membership: rounds whose search rewords one intent, consecutively, with reads between them not breaking the loop. The digest marks a search's query and the streak the app's own rule counted; you may extend a loop to rewordings that share no tokens, and you may say a marked streak is not one loop.
2. Off-key: for each Acquisition round, could the page it landed on carry any required fact of this task? Judge from the URL, title and result head against the key's facts and verified sources. A search results page, a 404, a walled page, a page on the right site but the wrong subject: say which and why.
3. Overrules: where a mechanical label is wrong on the evidence in the digest, give the round its right kind with a reason. Do not overrule to match a verdict.
4. Stopped early: did the Run end with budget and time left while the checks it never reached were reachable from pages it already had or had found? An attempt that ran to its budget did not stop early.
5. The verdict, from the closed set, primary and at most one secondary, each with a reason that cites the shares and rounds it rests on:
   - rounds_wasted: the budget went to rounds without Progress, Off-key pages, loops, or repeats.
   - tier_too_small_or_never_escalated: the work was on-key and productive and the tier's budget ended it, with no Tier Escalation.
   - budget_too_small_for_the_hunt: on-key productive work at the highest tier still needed more rounds than the budget holds. An admissible finding.
   - stopped_early: the Run ended with budget left and the unreached checks within reach.
   - failed_rounds: failed rounds (timeouts, cut rounds, refusals) cost the attempt its result.
   No numeric threshold is given: you choose and you cite the shares.
6. Flags: every call a careful human might make the other way — an Off-key call on a borderline page, a loop boundary, an overrule, a verdict on the line — as a question naming the round where one applies. Flags ship as caveats; they never gate the report.

Rules of the output:
- Name rounds by their number and pages by their URL. Refer to the key's checks by id (fact-01, pitfall-02) and never quote, paraphrase or summarize the key's text: the output is committed to a public repository and the key is private. A reason that repeats a fact from the key is discarded.
- Judge the rounds, not the Answer: the Answer was graded elsewhere and its grade is given to you as context.
- Return only the JSON object the schema describes.`

interface SlotView {
  readonly attempt: LiveAttemptCapture
  readonly captureId: string
  readonly task: LiveKeyTask | null
  readonly key: GradingKey | null
  readonly parent: LiveAttemptCapture | null
  readonly mechanical: AuditMechanical
}

/**
 * The digest as the reviewer sees it: everything `classifyAttempt` built
 * except the head of the measured model's reasoning. Opus 5's safeguards
 * refuse a message carrying that reasoning — measured 2026-09-13 on two
 * attempts: whole heads, heads cut to 300 characters, relabelled heads, and
 * either half of the rounds' heads were all answered with `stop_reason:
 * refusal` and zero output tokens, and the same prompt with the heads
 * removed was answered. The heads stay in the committed JSON digest for the
 * human reader; the reviewer judges from the calls, pages, results and
 * Notices, which is where the mechanical labels come from too.
 */
function digestBlock(mechanical: AuditMechanical): string {
  const lines: string[] = []
  const terminal = mechanical.terminal
  lines.push(
    `Tier ${mechanical.tier ?? 'none'} (plans: ${mechanical.plans.map((plan) => `${plan.tier}/${plan.source}`).join(', ') || 'none'}); Tool Round budget ${mechanical.toolRoundBudget ?? '?'}; ${mechanical.toolRoundsUsed} Tool Rounds used; ${mechanical.orchestratorRounds} model rounds of which ${mechanical.counts.finalization} Finalization.`,
  )
  lines.push(`Ended: ${terminal === null ? 'no terminal' : `${terminal.outcome ?? '?'}${terminal.resolution ? ` / ${terminal.resolution}` : ''}${terminal.finalizationCause ? ` (${terminal.finalizationCause})` : ''}`}; stop reason ${mechanical.stopReason}; Run duration ${mechanical.runDurationMs.status === 'observed' ? `${mechanical.runDurationMs.value} ms` : mechanical.runDurationMs.status}.`)
  lines.push(`Mechanical kinds over ${mechanical.budgetedRounds} budgeted rounds: ${ROUND_KINDS.map((kind) => `${kind} ${mechanical.counts[kind]}`).join(', ')}.`)
  lines.push(`${mechanical.subagent.rounds} Subagent round(s) over ${mechanical.subagent.agents} Subagent(s); ${mechanical.acceptedCheckpoints} accepted and ${mechanical.rejectedCheckpoints} rejected Evidence Checkpoint(s); ${mechanical.inheritedRounds} inherited round(s).`)
  lines.push(`Grade: ${mechanical.grade?.status ?? 'ungraded'}; checks not reached: ${mechanical.checksNotReached === null ? 'unknown' : mechanical.checksNotReached.join(', ') || 'none'}.`)
  lines.push('The assistant’s own reasoning is not shown; each round lists its calls, the page each put in front of the assistant, the result head and the app’s Notices.')
  lines.push('')
  for (const round of mechanical.rounds) {
    lines.push(`## Round ${round.round}${round.attempt > 1 ? ` (attempt ${round.attempt})` : ''} — ${round.kind}: ${round.reason}`)
    lines.push(
      `outcome ${round.outcome}; effort ${round.effort ?? '?'}; ${round.latencyMs === null ? 'latency unjoined' : `${round.latencyMs} ms`}; tokens ${round.promptTokens ?? '?'} in / ${round.completionTokens ?? '?'} out; request ${round.requestChars ?? '?'} chars with ${round.toolResultsInRequest ?? '?'} tool results; reasoning ${round.reasoningChars} chars` +
        `${round.tags.inherited ? '; inherited' : ''}${round.tags.wall ? '; walled' : ''}${round.tags.rejectedCheckpoints > 0 ? `; ${round.tags.rejectedCheckpoints} rejected checkpoint(s)` : ''}`,
    )
    for (const call of round.calls) {
      const parts = [
        `- ${call.name}${call.refused ? ' (refused)' : call.ok === null ? ' (no result)' : ''} ${JSON.stringify(call.args)}`,
        call.url ? `  page: ${call.url}${call.title ? ` — "${clip(call.title, 80)}"` : ''}` : '',
        call.search ? `  search: "${call.search.query}" (streak ${call.search.streak})` : '',
        call.wall ? `  wall: ${call.wall}` : '',
        call.checkpoint ? `  checkpoint: ${call.checkpoint.accepted ? 'accepted' : `REJECTED — ${call.checkpoint.outcome}`}` : '',
        call.progress ? `  progress: ${call.progress.made ? 'yes' : 'no'} — ${call.progress.reason}` : '',
        call.notices.length > 0 ? `  notices: ${call.notices.join(', ')}` : '',
        call.resultHead ? `  result: ${call.resultHead}` : '',
      ].filter((part) => part !== '')
      lines.push(...parts)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function attemptPrompt(view: SlotView, priorErrors: readonly string[] | null): string {
  const { attempt, task, key, parent, mechanical } = view
  const parts: string[] = []
  parts.push(`# Attempt ${attempt.attemptId} — hunt "${attempt.huntId}", step "${attempt.stepId}", relation ${attempt.relation}`)
  if (parent !== null) parts.push(`## The initial command, for context\n\n${parent.command.text}`)
  parts.push(`## The command as submitted\n\n${attempt.command.text}`)
  parts.push(`## The digest\n\n${digestBlock(mechanical)}`)
  if (key !== null && task !== null) {
    parts.push(`## The key (private — refer to checks by id only)\n\n${keyBlock(key, task)}`)
    parts.push(`## The checks of this task\n\n${task.checks.map((check) => `- ${check.checkId}: ${check.description}`).join('\n')}`)
  } else parts.push('## The key\n\nThe key describes no task for this slot; judge Off-key from the command alone.')
  if (priorErrors !== null) parts.push(`## Your previous output was refused\n\n${bullets(priorErrors)}\n\nProduce a corrected output. Do not change a judgement merely to satisfy the validator.`)
  parts.push('## Output\n\nReturn only the JSON object the schema describes. Round numbers are the digest’s. `secondary` and `secondaryReason` are null when there is no secondary verdict.')
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// The call

interface CliResult {
  readonly output: unknown
  readonly model: string
  readonly costUsd: number | null
  readonly durationMs: number | null
}

/**
 * A call the CLI completed but the model did not answer — a safeguard
 * refusal, an API error — is this attempt's problem, not the run's: the
 * attempt is retried once and then left without a judgement, so the other
 * seventeen are not redone for it. Anything that says the CLI itself is
 * broken (a non-JSON reply, a different model served) still fails the run.
 */
interface CliRefusal {
  readonly refused: true
  readonly reason: string
  readonly costUsd: number | null
}

function callReviewer(prompt: string, model: string, effort: string, maxUsd: string): CliResult | CliRefusal {
  let stdout: string
  try {
    stdout = execFileSync(
      'claude',
      [
        '-p',
        '--model',
        model,
        '--effort',
        effort,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(JUDGEMENT_SCHEMA),
        '--system-prompt',
        SYSTEM_PROMPT,
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--max-budget-usd',
        maxUsd,
      ],
      { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpdir() },
    )
  } catch (error) {
    // Never echo the command: its arguments carry the whole key. A non-zero
    // exit with a JSON reply on stdout is the CLI reporting a refused or
    // failed call; anything else is the CLI itself failing.
    const failed = error as { status?: number | null; signal?: string | null; stderr?: string; stdout?: string }
    const reply = (failed.stdout ?? '').trim()
    let record: Record<string, unknown> | null = null
    try {
      record = reply.startsWith('{') ? (JSON.parse(reply) as Record<string, unknown>) : null
    } catch {
      record = null
    }
    if (record !== null && typeof record.stop_reason === 'string') {
      const cost = typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null
      return { refused: true, reason: `${record.stop_reason}: ${clip(String(record.result ?? '').split('\n')[0] ?? '', 200)}`, costUsd: cost }
    }
    const said = clip((failed.stderr ?? '').trim() || reply, 600)
    fail(`the claude CLI exited ${failed.status ?? failed.signal ?? 'abnormally'}${said === '' ? '' : `: ${said}`}`)
  }
  let result: unknown
  try {
    result = JSON.parse(stdout)
  } catch {
    fail('the claude CLI returned something other than JSON')
  }
  const record = result as Record<string, unknown>
  if (record.is_error === true || record.subtype !== 'success') {
    return { refused: true, reason: `${String(record.stop_reason ?? record.subtype)}: ${clip(String(record.result ?? '').split('\n')[0] ?? '', 200)}`, costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null }
  }
  const output = record.structured_output
  if (typeof output !== 'object' || output === null) fail('the claude CLI returned no structured output')
  const usage = (record.modelUsage ?? {}) as Record<string, unknown>
  const models = Object.keys(usage).filter((id) => id.startsWith(model) || model.startsWith(id))
  const served = models[0] ?? Object.keys(usage).find((id) => !id.includes('haiku')) ?? 'unknown'
  return {
    output,
    model: served,
    costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null,
    durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : null,
  }
}

interface CachedReview {
  readonly review: AuditReview
}

function cachePathFor(setId: string, attemptId: string, mechanical: AuditMechanical, model: string, effort: string): string {
  const hash = mechanical.digestHash.slice('sha256:'.length, 'sha256:'.length + 12)
  return join(CACHE_DIR, setId, `${attemptId}.${hash}.${model}.${effort}.${AUDIT_PROMPT_VERSION}.json`)
}

function reviewAttempt(view: SlotView, setId: string, options: { model: string; effort: string; maxUsd: string; fresh: boolean }): AuditReview {
  const cachePath = cachePathFor(setId, view.attempt.attemptId, view.mechanical, options.model, options.effort)
  if (!options.fresh && existsSync(cachePath)) {
    const cached = readJsonQuietly(cachePath) as CachedReview | null
    if (cached !== null && cached.review !== undefined && cached.review.digestHash === view.mechanical.digestHash) {
      note(`  ${view.attempt.attemptId}: reusing the cached judgement (${display(cachePath)})`)
      return cached.review
    }
  }
  const keyTexts = view.key === null ? [] : keyTextsOf(view.key)
  let errors: string[] | null = null
  let judgement: AuditJudgement | null = null
  let served: string | null = null
  let costUsd = 0
  let costKnown = true
  let durationMs = 0
  const caveats: string[] = []
  for (let round = 0; round < 2 && judgement === null; round += 1) {
    note(`  ${view.attempt.attemptId}: asking ${options.model} at ${options.effort}${round > 0 ? ' again' : ''}…`)
    const result = callReviewer(attemptPrompt(view, errors), options.model, options.effort, options.maxUsd)
    if (result.costUsd === null) costKnown = false
    else costUsd += result.costUsd
    if ('refused' in result) {
      errors = [`the reviewer did not answer (${result.reason})`]
      note(`  round ${round + 1}: ${errors[0]}`)
      continue
    }
    served = result.model
    if (result.durationMs !== null) durationMs += result.durationMs
    if (!served.startsWith(options.model)) fail(`the CLI served the request with ${served}, not ${options.model} — the provenance would be a lie`)
    const validated = validateJudgement(result.output, view.mechanical)
    if (!validated.ok) {
      errors = [...validated.errors]
      note(`  the validator refused round ${round + 1}: ${errors.join('; ')}`)
      continue
    }
    const leaks = keyLeaks(JSON.stringify(validated.value), keyTexts)
    if (leaks.length > 0) {
      errors = leaks.map((leak) => `the output reproduced key text (${leak}); refer to checks by id only`)
      note(`  round ${round + 1} reproduced key text: ${leaks.join('; ')}`)
      continue
    }
    judgement = validated.value
  }
  if (judgement === null) caveats.push(`no judgement: two calls to the reviewer gave none (${(errors ?? []).join('; ')})`)
  else for (const flag of judgement.flags) caveats.push(`flag${flag.round === null ? '' : ` (round ${flag.round})`}: ${flag.question}`)
  const review: AuditReview = {
    judgement,
    caveats,
    model: options.model,
    served,
    effort: options.effort,
    promptVersion: AUDIT_PROMPT_VERSION,
    digestHash: view.mechanical.digestHash,
    costUsd: costKnown ? Math.round(costUsd * 100) / 100 : null,
    durationMs,
    judgedAt: new Date().toISOString(),
  }
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileAtomic(cachePath, `${JSON.stringify({ review }, null, 2)}\n`)
  return review
}

// ---------------------------------------------------------------------------
// Main

function assertWritable(path: string): void {
  if (existsSync(path)) fail(`refusing to overwrite ${display(path)} — an audit, like a report, is written once; pass --out-dir to write elsewhere`)
}

function main(): void {
  let flags: Map<string, string[]>
  try {
    flags = parseArgv(process.argv.slice(2))
  } catch (error) {
    fail((error as Error).message)
  }
  const capturePaths = flags.get('capture') ?? fail('--capture is required (repeat it for several sets)')
  const model = flags.get('model')?.[0] ?? DEFAULT_MODEL
  const effort = flags.get('effort')?.[0] ?? DEFAULT_EFFORT
  const maxUsd = flags.get('max-usd')?.[0] ?? DEFAULT_MAX_USD
  const outDir = resolve(flags.get('out-dir')?.[0] ?? DEFAULT_OUT_DIR)
  const aggregateName = flags.get('aggregate')?.[0] ?? DEFAULT_AGGREGATE
  const gradesPaths = flags.get('grades') ?? []
  const only = flags.get('only')?.[0] ?? null
  const promptsDir = flags.get('prompts-dir')?.[0] ?? null
  const dryRun = flags.get('dry-run') !== undefined
  const fresh = flags.get('fresh') !== undefined
  const git = gitProvenance()
  const generatedAt = new Date().toISOString()

  const contexts = capturePaths.map((path) => readSet(path, gradesPaths))
  const setIds = contexts.map((context) => context.inputs.set.setId)
  if (new Set(setIds).size !== setIds.length) fail(`a capture set is named twice: ${setIds.join(', ')}`)

  const outputs: { context: SetContext; audit: AuditSetOutput; jsonPath: string; mdPath: string }[] = []
  let totalCost = 0
  let costKnown = true
  let totalPrompts = 0

  for (const context of contexts) {
    const { set, sessions, manifest } = context.inputs
    const { byAttemptId } = indexAttempts(sessions)
    const jsonPath = join(outDir, `audit-${set.setId}.json`)
    const mdPath = join(outDir, `audit-${set.setId}.md`)
    if (!dryRun) {
      assertWritable(jsonPath)
      assertWritable(mdPath)
    }
    note(`auditing ${set.setId} (${set.slots.length} slots)…`)
    const caveats: string[] = []
    if (context.gradesNote !== null) caveats.push(context.gradesNote)
    const gradeOf = (attemptId: string): LiveGradeEntry | null => context.grades?.entries.find((entry) => entry.attemptId === attemptId) ?? null

    const views: SlotView[] = []
    for (const slot of set.slots) {
      const dispatched = byAttemptId.get(slot.attemptId)
      const attempt = dispatchedAttemptOf(dispatched)
      if (dispatched === undefined || attempt === null) {
        caveats.push(`${slot.attemptId} was not dispatched and has no rounds to audit`)
        continue
      }
      if (only !== null && slot.attemptId !== only) continue
      const session = sessions.find((candidate) => candidate.captureId === dispatched.captureId)!
      const directory = context.sessionDirectories.get(dispatched.captureId) ?? context.setDirectory
      const turnId = attempt.accepted.status === 'observed' ? attempt.accepted.value.turnId : null
      if (turnId === null) caveats.push(`${slot.attemptId}: the command was never accepted, so no trace records join it`)
      const traceRecords = turnId === null ? [] : turnRecords<TraceRecord>(session, directory, 'run_trace', turnId)
      const perfRecords = turnId === null ? [] : turnRecords<PerfSpanRecord>(session, directory, 'perf', turnId)
      if (turnId !== null && traceRecords.length === 0) caveats.push(`${slot.attemptId}: the capture retained no Run Trace records for its turn`)
      const parent = attempt.parentAttemptId === undefined ? null : dispatchedAttemptOf(byAttemptId.get(attempt.parentAttemptId))
      let parentCheckpointedUrls: Set<string> | null = null
      if (parent !== null && parent.accepted.status === 'observed') {
        parentCheckpointedUrls = checkpointedUrlsOf(turnRecords<TraceRecord>(session, directory, 'run_trace', parent.accepted.value.turnId))
      }
      const task = manifest.tasks.find((candidate) => candidate.huntId === slot.huntId && candidate.stepId === slot.stepId) ?? null
      const key = gradingKeyFor(slot.huntId) ?? null
      if (task === null) caveats.push(`${slot.attemptId}: the key describes no task for ${slot.huntId}/${slot.stepId}`)
      const mechanical = classifyAttempt({
        attempt,
        captureId: dispatched.captureId,
        traceRecords,
        perfRecords,
        reasoningEffortOverride: session.launch.reasoningEffortOverride,
        parentCheckpointedUrls,
        task,
        grade: gradeOf(slot.attemptId),
      })
      views.push({ attempt, captureId: dispatched.captureId, task, key, parent, mechanical })
    }
    if (only !== null && views.length === 0) fail(`--only names ${only}, which is not a dispatched slot of ${set.setId}`)

    if (promptsDir !== null) {
      mkdirSync(promptsDir, { recursive: true })
      for (const view of views) writeFileSync(join(promptsDir, `${set.setId}--${view.attempt.attemptId}.md`), attemptPrompt(view, null))
      writeFileSync(join(promptsDir, '_system.md'), SYSTEM_PROMPT)
      totalPrompts += views.length
    }

    const attempts: AuditAttempt[] = []
    for (const view of views) {
      const review = dryRun ? null : reviewAttempt(view, set.setId, { model, effort, maxUsd, fresh })
      if (review !== null) {
        if (review.costUsd === null) costKnown = false
        else totalCost += review.costUsd
      }
      attempts.push({ mechanical: view.mechanical, review, countsAfterOverrules: countsAfterOverrulesOf(view.mechanical, review?.judgement ?? null) })
    }

    const launches = sessions.map((session) => session.launch)
    const provenance: AuditProvenance = {
      setId: set.setId,
      study: set.study.name,
      protocolVersion: set.study.protocolVersion,
      mode: set.mode,
      state: set.state,
      createdAt: set.createdAt,
      commits: [...new Set(launches.map((launch) => launch.commit))].sort(),
      dirtyTree: launches.some((launch) => launch.dirtyTree),
      promptVersions: [...new Set(set.slots.map((slot) => slot.prompt.version))].sort(),
      keyVersion: manifest.keyVersion,
      keyManifestDigest: context.grades?.keyManifestDigest ?? manifest.keyDigest,
      gradesReviewers: context.grades === null ? [] : [...new Set(context.grades.entries.filter((entry) => entry.status !== 'pending').map((entry) => entry.reviewer))].sort(),
      gradesRevision: context.grades?.revision ?? null,
      roles: [
        ...new Set(
          launches.flatMap((launch) =>
            (['orchestrator', 'subagent', 'vision'] as const).map((role) => {
              const provenanceOfRole = launch.roles[role]
              return `${role}=${provenanceOfRole.configured ? provenanceOfRole.model : `unconfigured (${provenanceOfRole.reason})`}`
            }),
          ),
        ),
      ].sort(),
      reasoningEffortOverride: launches.find((launch) => launch.reasoningEffortOverride !== null)?.reasoningEffortOverride ?? null,
      effortOverrides: [...new Set(launches.flatMap((launch) => Object.keys(launch.effortOverrides)))].sort(),
      adblock: [...new Set(launches.map((launch) => launch.adblock.lists))].sort().join(', '),
      reviewerModel: model,
      reviewerEffort: effort,
      reviewerPromptVersion: AUDIT_PROMPT_VERSION,
      auditCommit: git.commit,
      auditDirtyTree: git.dirtyTree,
      generatedAt,
    }
    outputs.push({ context, audit: buildAuditSet(provenance, attempts, caveats), jsonPath, mdPath })
  }

  if (dryRun) {
    const attempts = outputs.reduce((total, output) => total + output.audit.attempts.length, 0)
    note(`dry run: ${attempts} attempt(s) over ${outputs.length} set(s) would be judged by ${model} at ${effort}; nothing was called or written${promptsDir === null ? '' : ` (wrote ${totalPrompts} prompt(s) to ${display(promptsDir)})`}`)
    for (const output of outputs) {
      for (const attempt of output.audit.attempts) {
        const { mechanical } = attempt
        process.stdout.write(
          `${output.audit.provenance.setId} ${mechanical.attemptId}: ${mechanical.orchestratorRounds} rounds, ${mechanical.toolRoundsUsed}/${mechanical.toolRoundBudget ?? '?'} Tool Rounds, ` +
            `${ROUND_KINDS.map((kind) => `${kind.replace(/_/g, ' ')} ${mechanical.counts[kind]}`).join(', ')}; digest ${mechanical.digestHash.slice(0, 19)}…\n`,
        )
      }
    }
    return
  }

  // Aggregate only when more than one set was named; the refusal is the
  // aggregate's own.
  let aggregatePaths: { json: string; md: string } | null = null
  let aggregateText: { json: string; md: string } | null = null
  if (outputs.length > 1) {
    const aggregate = buildAuditAggregate(
      outputs.map((output) => output.audit),
      generatedAt,
    )
    if (!aggregate.ok) failWith('the sets cannot be aggregated — nothing was written', aggregate.errors)
    aggregatePaths = { json: join(outDir, `${aggregateName}.json`), md: join(outDir, `${aggregateName}.md`) }
    assertWritable(aggregatePaths.json)
    assertWritable(aggregatePaths.md)
    aggregateText = { json: `${JSON.stringify(aggregate.value, null, 2)}\n`, md: `${formatAuditAggregate(aggregate.value)}\n` }
  }

  // The last guard before anything lands: no key text in any output.
  for (const output of outputs) {
    const json = `${JSON.stringify(output.audit, null, 2)}\n`
    const md = `${formatAuditSet(output.audit)}\n`
    const texts = output.audit.attempts.flatMap((attempt) => {
      const key = gradingKeyFor(attempt.mechanical.huntId)
      return key === undefined ? [] : keyTextsOf(key)
    })
    const leaks = [...keyLeaks(json, texts), ...keyLeaks(md, texts)]
    if (leaks.length > 0) failWith(`the audit of ${output.audit.provenance.setId} would carry key text — nothing was written`, leaks)
    mkdirSync(outDir, { recursive: true })
    writeFileAtomic(output.jsonPath, json)
    writeFileAtomic(output.mdPath, md)
  }
  if (aggregatePaths !== null && aggregateText !== null) {
    writeFileAtomic(aggregatePaths.json, aggregateText.json)
    writeFileAtomic(aggregatePaths.md, aggregateText.md)
  }

  const lines: string[] = []
  for (const output of outputs) {
    const { audit } = output
    lines.push(`${audit.provenance.setId}: ${audit.attempts.length} attempt(s) audited → ${display(output.jsonPath)}, ${display(output.mdPath)}`)
    for (const attempt of audit.attempts) {
      const verdict = attempt.review?.judgement?.verdict
      lines.push(`  ${attempt.mechanical.attemptId}: ${verdict === undefined ? 'no judgement' : `${verdict.primary}${verdict.secondary === null ? '' : ` + ${verdict.secondary}`}`}${attempt.review !== null && attempt.review.judgement !== null && attempt.review.judgement.flags.length > 0 ? ` — ${attempt.review.judgement.flags.length} flag(s)` : ''}`)
    }
  }
  if (aggregatePaths !== null) lines.push(`aggregate: ${display(aggregatePaths.json)}, ${display(aggregatePaths.md)}`)
  lines.push(costKnown ? `spend reported by the CLI: $${totalCost.toFixed(2)} (cached judgements cost nothing again)` : 'spend: unknown (the CLI reported no cost for at least one call)')
  lines.push(`verdict set: ${AUDIT_VERDICTS.join(', ')}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

main()
