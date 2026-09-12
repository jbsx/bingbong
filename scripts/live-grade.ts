// The model reviewer for live-web captures (#223, amended protocol).
//
//   pnpm live:grade --capture=<capture-set.json> [--reviewer=<name>] [--model=<id>]
//                   [--out=<grades.json>] [--only=<attemptId>] [--prompts-dir=<dir>] [--dry-run]
//
// A reviewer that is a model, not a human, reading each Answer against the
// private key exactly as the Grading Bench asks a person to: every check
// judged one by one, the constraints read first, support cited, a verdict
// chosen, and — the part a human still owns — every call the reviewer found
// borderline written to a sidecar for the owner to adjudicate. The model is
// driven through the Claude Code CLI (`claude -p`) from a shell, one call per
// slot, with no tools and no session, so it can read nothing but what this
// script hands it: the Answer, the trail the Run left, and the key.
//
// Three things it never does. It never grades a slot nothing was dispatched
// into — not reached stays pending, as at the bench. It never picks a verdict
// itself: an output the validator refuses is sent back to the model once with
// the validator's own words, and a second refusal leaves the slot pending and
// says why. And it never overwrites: a grades file is written once, under the
// bench's own name for this reviewer, and `live:report` reads it unchanged.
//
// This is the third script allowed to import the keys (`corpus.test.ts`):
// a reviewer has to read the key, and a model reviewer is still a reviewer.
// It is opt-in and paid, never run by any test or by `live:report`.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { LIVE_PRIVATE_ROOT, digestOf, readCaptureSet, writeFileAtomic } from '../e2e/live/artifacts.ts'
import {
  indexAttempts,
  initializeLiveGrades,
  parseLiveGrades,
  answerBindingOf,
  type LiveClaimSupport,
  type LiveGradeEntry,
  type LiveGradeStatus,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyTask,
} from '../e2e/live/grades.ts'
import { allowedStatusesFor, dispatchedAttemptOf, evidenceTrailOf, withEntry, type EvidenceTrail } from '../e2e/live/gradingBench.ts'
import { gradesFileNameFor } from '../e2e/live/gradingSetup.ts'
import { buildLiveKeyManifest, gradingKeyFor, type GradingKey } from '../e2e/live/keyManifest.ts'
import type { LiveAttemptCapture, LiveSessionCapture } from '../e2e/live/types.ts'

const FLAGS = ['capture', 'reviewer', 'model', 'out', 'only', 'prompts-dir', 'dry-run', 'max-usd'] as const

/** The model this reviewer is, and the name the grades file carries for it. */
const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_REVIEWER = 'claude-opus-5 via live:grade'
/** A per-call spending guard for the CLI, not a study budget: a slot is a few thousand tokens. */
const DEFAULT_MAX_USD = '3'

class UsageError extends Error {}

function fail(message: string): never {
  process.stderr.write(`live:grade: ${message}\n`)
  process.exit(1)
}

function failWith(what: string, errors: readonly string[]): never {
  process.stderr.write(`live:grade: ${what}\n`)
  for (const error of errors) process.stderr.write(`  - ${error}\n`)
  process.exit(1)
}

function note(message: string): void {
  process.stderr.write(`live:grade: ${message}\n`)
}

function parseArgv(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (const argument of argv) {
    if (!argument.startsWith('--')) throw new UsageError(`unexpected argument "${argument}"`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    const value = separator === -1 ? 'true' : argument.slice(separator + 1)
    if (!(FLAGS as readonly string[]).includes(name)) throw new UsageError(`unknown option --${name} (takes ${FLAGS.map((flag) => `--${flag}`).join(', ')})`)
    if (flags.has(name)) throw new UsageError(`--${name} was given more than once`)
    if (value === '') throw new UsageError(`--${name} was given an empty value`)
    flags.set(name, value)
  }
  return flags
}

function display(path: string): string {
  const absolute = resolve(path)
  return absolute.startsWith(`${process.cwd()}/`) ? absolute.slice(process.cwd().length + 1) : isAbsolute(path) ? basename(path) : path
}

// ---------------------------------------------------------------------------
// What the reviewer is shown

const CLI_TOOLS: readonly string[] = ['navigate', 'read_page', 'look']

interface SlotView {
  readonly attempt: LiveAttemptCapture
  readonly task: LiveKeyTask
  readonly key: GradingKey
  readonly parent: LiveAttemptCapture | null
  readonly trail: EvidenceTrail | null
  readonly trailNote: string | null
  readonly allowed: readonly LiveGradeStatus[]
}

/** The event tape an attempt left, read the way the bench reads it, or the reason it could not be. */
function trailOf(attempt: LiveAttemptCapture, directory: string): { trail: EvidenceTrail | null; note: string | null } {
  if (attempt.events === null) return { trail: null, note: 'the capture retained no event tape for this attempt' }
  const path = resolve(directory, attempt.events.path)
  if (!path.startsWith(`${directory}${sep}`)) return { trail: null, note: 'the event tape’s path leaves its capture directory, so it was not read' }
  if (!existsSync(path)) return { trail: null, note: `the event tape ${attempt.events.path} is missing from the capture` }
  const bytes = readFileSync(path)
  let tape: unknown
  try {
    tape = JSON.parse(bytes.toString('utf8'))
  } catch {
    return { trail: null, note: `the event tape ${attempt.events.path} is not valid JSON` }
  }
  if (typeof tape !== 'object' || tape === null || !Array.isArray((tape as { events?: unknown }).events)) {
    return { trail: null, note: `the event tape ${attempt.events.path} holds no events` }
  }
  const events = ((tape as { events: unknown[] }).events).filter((event) => typeof event === 'object' && event !== null) as unknown as PipelineEvent[]
  const trail = evidenceTrailOf(events)
  const note = digestOf(bytes) === attempt.events.digest ? null : 'the event tape no longer matches the digest the capture recorded — it changed after capture'
  return { trail, note }
}

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

/** The key as the bench shows it for this step: an initial's key whole, a follow-up's delta plus what the key carries over. */
function keyBlock(view: SlotView): string {
  const { key, task } = view
  const shared = `Constraints (read these before judging any check — they decide verdicts without being checks):\n${bullets(key.constraints)}`
  if (task.stepId === 'follow_up' && key.followUpDelta !== undefined) {
    const delta = key.followUpDelta
    return [
      `This is the predefined follow-up. Its checks come from the delta below; the initial's required facts are context, not checks on this slot.`,
      shared,
      `Required facts of the follow-up (the fact-NN checks):\n${numbered(delta.requiredFacts, 'fact')}`,
      `Pitfalls the follow-up must avoid (the pitfall-NN checks):\n${numbered(delta.pitfalls, 'pitfall')}`,
      `Sources verified for the follow-up (cite these, or an equivalent, in support):\n${sourcesBlock(delta.sources)}`,
      `For context — the initial's required facts:\n${bullets(key.requiredFacts)}`,
      `For context — the initial's sources:\n${sourcesBlock(key.sources)}`,
    ].join('\n\n')
  }
  return [
    shared,
    `Required facts (the fact-NN checks):\n${numbered(key.requiredFacts, 'fact')}`,
    `Pitfalls (the pitfall-NN checks — satisfied means the Answer AVOIDED it):\n${numbered(key.pitfalls, 'pitfall')}`,
    `Uncertainties (the uncertainty-NN checks — satisfied means the Answer PRESERVED it):\n${key.uncertainties.length === 0 ? '- (none)' : numbered(key.uncertainties, 'uncertainty')}`,
    `Sources verified for this key (cite these, or an equivalent, in support):\n${sourcesBlock(key.sources)}`,
    key.liveFacts.length === 0 ? '' : `Live facts this key marks as able to move (rechecked before the pass; grade against the key as written):\n${bullets(key.liveFacts)}`,
  ]
    .filter((block) => block !== '')
    .join('\n\n')
}

function answerBlock(attempt: LiveAttemptCapture): string {
  const answer = attempt.finalAnswer
  if (answer.status === 'observed') return answer.value.text
  const terminal = attempt.terminal.status === 'observed' ? `${attempt.terminal.value.outcome}${attempt.terminal.value.finalizationCause ? ` (${attempt.terminal.value.finalizationCause})` : ''}` : `terminal ${attempt.terminal.status}: ${attempt.terminal.reason}`
  return `(no final Answer was published — ${answer.reason}; the Run ended ${terminal}; stop reason: ${attempt.stop.reason}${attempt.stop.detail ? ` — ${attempt.stop.detail}` : ''})`
}

function trailBlock(view: SlotView): string {
  if (view.trail === null) return `(what it read is unavailable: ${view.trailNote ?? 'no trail'})`
  const { steps, evidence, subagentsSpawned } = view.trail
  const lines = steps.map((step, index) => {
    const where = step.url === null ? '' : ` ${step.url}`
    const title = step.title === null ? '' : ` — "${clip(step.title, 80)}"`
    const wall = step.wall === null ? '' : ` [${step.wall}]`
    const error = step.error === null ? '' : ` error: ${clip(step.error, 120)}`
    return `${index + 1}. ${step.tool} → ${step.outcome}${where}${title}${wall}${error}`
  })
  const recorded = evidence.map((item) => {
    const status = item.accepted === null ? 'unanswered' : item.accepted ? 'accepted' : 'REJECTED'
    return `- [${status}] ${item.kind ?? '?'}${item.sourceUrl ? ` ${item.sourceUrl}` : ''}: ${clip(item.observation, 240)}${item.excerpt ? ` | excerpt: ${clip(item.excerpt, 240)}` : ''}`
  })
  return [
    `Tool calls on the tape (${CLI_TOOLS.join(', ')}), in order${subagentsSpawned > 0 ? ` — ${subagentsSpawned} Subagent(s) were spawned, and their browsing is NOT on this tape` : ''}:`,
    lines.length === 0 ? '- (none)' : lines.join('\n'),
    `Evidence the assistant recorded (rejected entries diagnose the Run, not the Answer):`,
    recorded.length === 0 ? '- (none)' : recorded.join('\n'),
    view.trailNote === null ? '' : `Note: ${view.trailNote}`,
  ]
    .filter((block) => block !== '')
    .join('\n')
}

function terminalBlock(attempt: LiveAttemptCapture): string {
  const terminal = attempt.terminal
  if (terminal.status !== 'observed') return `The app's own account of how the Run ended is ${terminal.status}: ${terminal.reason}.`
  const { outcome, resolution, finalizationCause } = terminal.value
  return `The app's own account of how the Run ended: outcome "${outcome}"${resolution ? `, proposing Run Resolution "${resolution}"` : ''}${finalizationCause ? `, cause "${finalizationCause}"` : ''}. This is the app's claim about itself. It is printed beside your verdict in the report and is never evidence for it.`
}

const SYSTEM_PROMPT = `You are the reviewer of one live-web hunt Answer for a performance study. You grade the Answer against a private key that was researched independently before the hunt ran. You are not the assistant that produced the Answer, and you have no tools: everything you may consider is in the message.

The rule everything else follows: Task Success is an independent verification against the key, never something the app reported about itself. A Run that ended "done" or proposed "completed" has made a claim; you grade the Answer, not the claim.

How to grade, in this order:
1. Read the key's constraints first. They are instructions to you — how to decompose the verdict, what not to grade, which alternatives count — and they decide verdicts without being checks.
2. Judge every check by its id, exactly once, with a short note when the call was not obvious. fact-NN is satisfied when the Answer STATES the fact (an enumerated set, arithmetic, or a rule a reader could work the fact out from does not state it). pitfall-NN is satisfied when the Answer AVOIDED the pitfall. uncertainty-NN is satisfied unless the Answer RESOLVED the uncertainty with a certainty the source does not have; an Answer that never reaches the matter has not resolved it.
3. Choose the verdict. "pass" only when every check is satisfied and the predefined expected outcome was reached — for these hunts that is the researched result, never graceful stopping. "useful_partial" for real verified work short of it. "help_access_blocked" when the Run hit an access wall or asked for help it did not get — the trail shows walled reads. "unsuccessful" when no useful result or actionable next step was established.
4. Cite support: for each claim you accept, the source URL and how to find the passage. Use the key's verified sources, or name another URL as equivalentTo one of them when the Answer reached the same fact by another route. An Answer that cites the key's URL is not thereby supported, and one that cites another page is not thereby wrong. Sources you cannot open here are cited as the key verified them.
5. Write a rationale that a second reviewer could disagree with precisely.
6. List for adjudication every call a careful human might make the other way: a check whose satisfaction turned on a reading, a verdict on the boundary, an equivalence you accepted. Name the check id where one applies, and say what the alternative reading would change. An empty list means every call sat clear of the line.

Preserve the source's own qualifications: where a source says "probably" or "circa", a passing Answer says so too. Never rewrite the key in your head to fit the Answer. Never reward confidence the sources do not carry.`

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'checks', 'support', 'rationale', 'adjudicate'],
  properties: {
    status: { type: 'string', enum: ['pass', 'useful_partial', 'help_access_blocked', 'unsuccessful'] },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['checkId', 'satisfied', 'note'],
        properties: { checkId: { type: 'string' }, satisfied: { type: 'boolean' }, note: { type: 'string' } },
      },
    },
    support: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'sourceUrl', 'passageRef', 'equivalentTo'],
        properties: {
          claim: { type: 'string' },
          sourceUrl: { type: 'string' },
          passageRef: { type: 'string' },
          equivalentTo: { type: ['string', 'null'] },
        },
      },
    },
    rationale: { type: 'string' },
    adjudicate: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['checkId', 'question'],
        properties: { checkId: { type: ['string', 'null'] }, question: { type: 'string' } },
      },
    },
  },
} as const

interface ReviewerOutput {
  readonly status: Exclude<LiveGradeStatus, 'pending'>
  readonly checks: readonly { readonly checkId: string; readonly satisfied: boolean; readonly note: string }[]
  readonly support: readonly { readonly claim: string; readonly sourceUrl: string; readonly passageRef: string; readonly equivalentTo: string | null }[]
  readonly rationale: string
  readonly adjudicate: readonly { readonly checkId: string | null; readonly question: string }[]
}

function slotPrompt(view: SlotView, priorErrors: readonly string[] | null, priorOutput: ReviewerOutput | null): string {
  const { attempt, task, parent, allowed } = view
  const parts: string[] = []
  parts.push(`# Slot ${attempt.attemptId} — hunt "${task.huntId}", step "${task.stepId}", prompt version ${task.promptVersion}`)
  if (parent !== null) {
    parts.push(`## The initial command, for context\n\n${parent.command.text}\n\n## The initial Answer, for context (already graded on its own slot — do not grade it here)\n\n${answerBlock(parent)}`)
  }
  parts.push(`## The command as submitted\n\n${attempt.command.text}`)
  parts.push(`## The Answer to grade\n\n${answerBlock(attempt)}`)
  parts.push(`## How the Run ended\n\n${terminalBlock(attempt)}`)
  parts.push(`## What it read\n\n${trailBlock(view)}`)
  parts.push(`## The key\n\n${keyBlock(view)}`)
  parts.push(
    `## The checks to judge — every one of these ids exactly once, and no other\n\n${task.checks.map((check) => `- ${check.checkId}: ${check.description}`).join('\n')}`,
  )
  parts.push(`## Verdicts available for this slot\n\n${allowed.join(', ')}${allowed.length < 4 ? ' (the Run published no Answer, so it cannot have passed or partly succeeded)' : ''}`)
  if (priorErrors !== null && priorOutput !== null) {
    parts.push(
      `## Your previous output was refused by the validator\n\nRefusals, in the validator's words:\n${bullets(priorErrors)}\n\nYour previous output:\n\`\`\`json\n${JSON.stringify(priorOutput, null, 2)}\n\`\`\`\n\nProduce a corrected grade. Do not change a judgment merely to satisfy the validator: if a pass cannot be supported, the verdict is not a pass.`,
    )
  }
  parts.push(`## Output\n\nReturn only the JSON object the schema describes. \`equivalentTo\` is null unless the URL stands in for one of the key's sources. \`note\` may be an empty string.`)
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// The call

interface CliResult {
  readonly output: ReviewerOutput
  readonly model: string
  readonly costUsd: number | null
  readonly durationMs: number | null
}

function callReviewer(prompt: string, model: string, maxUsd: string): CliResult {
  let stdout: string
  try {
    stdout = execFileSync(
      'claude',
      [
        '-p',
        '--model',
        model,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(OUTPUT_SCHEMA),
        '--system-prompt',
        SYSTEM_PROMPT,
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        // No turn cap: structured output arrives through a tool round-trip
        // the CLI drives itself, and with every tool disabled there is
        // nothing else a turn could do. The budget guard is the ceiling.
        '--max-budget-usd',
        maxUsd,
      ],
      {
        input: prompt,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        // A neutral working directory: the CLI reads CLAUDE.md files up from
        // its cwd, and the reviewer must see nothing of this repository.
        cwd: tmpdir(),
      },
    )
  } catch (error) {
    // Never echo the command: its arguments carry the whole key.
    const failed = error as { status?: number | null; signal?: string | null; stderr?: string; stdout?: string }
    const said = clip((failed.stderr ?? '').trim() || (failed.stdout ?? '').trim(), 600)
    fail(`the claude CLI exited ${failed.status ?? failed.signal ?? 'abnormally'}${said === '' ? '' : `: ${said}`}`)
  }
  let result: unknown
  try {
    result = JSON.parse(stdout)
  } catch {
    fail('the claude CLI returned something other than JSON')
  }
  const record = result as Record<string, unknown>
  if (record.is_error === true || record.subtype !== 'success') fail(`the claude CLI reported ${String(record.subtype)}: ${clip(String(record.result ?? ''), 300)}`)
  const output = record.structured_output
  if (typeof output !== 'object' || output === null) fail('the claude CLI returned no structured output')
  const usage = (record.modelUsage ?? {}) as Record<string, unknown>
  const models = Object.keys(usage).filter((id) => id.startsWith(model) || model.startsWith(id))
  const served = models[0] ?? Object.keys(usage).find((id) => !id.includes('haiku')) ?? 'unknown'
  return {
    output: output as ReviewerOutput,
    model: served,
    costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null,
    durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : null,
  }
}

function entryOf(view: SlotView, captureId: string, output: ReviewerOutput, binding: { manifest: LiveGradingInputs['manifest']; reviewer: string; reviewedAt: string }): LiveGradeEntry {
  const support: LiveClaimSupport[] = output.support.map((row) => ({
    claim: row.claim,
    sourceUrl: row.sourceUrl,
    passageRef: row.passageRef,
    ...(row.equivalentTo === null || row.equivalentTo.trim() === '' ? {} : { equivalentTo: row.equivalentTo }),
  }))
  return {
    attemptId: view.attempt.attemptId,
    huntId: view.attempt.huntId,
    stepId: view.attempt.stepId,
    captureId,
    answer: answerBindingOf(view.attempt),
    keyVersion: binding.manifest.keyVersion,
    keyDigest: binding.manifest.keyDigest,
    status: output.status,
    checks: output.checks.map((check) => ({ checkId: check.checkId, satisfied: check.satisfied, ...(check.note.trim() === '' ? {} : { note: check.note }) })),
    support,
    rationale: output.rationale,
    reviewer: binding.reviewer,
    reviewedAt: binding.reviewedAt,
  }
}

// ---------------------------------------------------------------------------
// Main

function main(): void {
  let flags: Map<string, string>
  try {
    flags = parseArgv(process.argv.slice(2))
  } catch (error) {
    fail((error as Error).message)
  }
  const capturePath = flags.get('capture') ?? fail('--capture is required')
  const model = flags.get('model') ?? DEFAULT_MODEL
  const reviewer = flags.get('reviewer') ?? (model === DEFAULT_MODEL ? DEFAULT_REVIEWER : `${model} via live:grade`)
  const dryRun = flags.get('dry-run') === 'true'
  const only = flags.get('only') ?? null
  const maxUsd = flags.get('max-usd') ?? DEFAULT_MAX_USD
  const promptsDir = flags.get('prompts-dir') ?? null

  const capture = readCaptureSet(capturePath)
  if (!capture.ok) failWith(`the capture set at ${display(capturePath)} does not validate`, capture.errors)
  const { set } = capture.value
  if (set.mode !== 'measured') fail(`the capture set ${set.setId} is a ${set.mode} set — only a measured set is graded, verification fixtures never become evidence`)
  const sessionErrors = capture.value.sessions.flatMap((session) => (session.ok ? [] : session.errors))
  if (sessionErrors.length > 0) failWith('the capture set references Session captures that do not validate', sessionErrors)
  const sessions = capture.value.sessions.map((session) => (session as { value: LiveSessionCapture }).value)
  const setDirectory = realpathSync(dirname(resolve(capturePath)))
  const sessionDirectories = new Map(set.sessions.map((reference) => [reference.captureId, realpathSync(dirname(resolve(setDirectory, reference.path)))]))

  const manifest = buildLiveKeyManifest()
  const inputs: LiveGradingInputs = { set, sessions, manifest }
  const { byAttemptId, duplicated } = indexAttempts(sessions)
  if (duplicated.length > 0) failWith('attempt id(s) claimed by more than one Session capture', duplicated)

  const outPath = resolve(flags.get('out') ?? join(LIVE_PRIVATE_ROOT, gradesFileNameFor(set.setId, reviewer)))
  if (existsSync(outPath)) fail(`refusing to overwrite ${display(outPath)} — a grades file is written once; pass --out to write elsewhere`)
  if (!outPath.startsWith(`${realpathSync(LIVE_PRIVATE_ROOT)}${sep}`) && flags.get('out') === undefined) fail('the grades file must land in the private root')
  const adjudicatePath = `${outPath.slice(0, -'.json'.length)}.adjudicate.md`

  const views = new Map<string, { view: SlotView; captureId: string }>()
  for (const slot of set.slots) {
    const dispatched = byAttemptId.get(slot.attemptId)
    const attempt = dispatchedAttemptOf(dispatched)
    if (dispatched === undefined || attempt === null) continue
    const task = manifest.tasks.find((candidate) => candidate.huntId === slot.huntId && candidate.stepId === slot.stepId)
    const key = gradingKeyFor(slot.huntId)
    if (task === undefined || key === undefined) fail(`the key describes no task for ${slot.huntId}/${slot.stepId}`)
    const parent = attempt.parentAttemptId === undefined ? null : dispatchedAttemptOf(byAttemptId.get(attempt.parentAttemptId))
    const { trail, note: trailNote } = trailOf(attempt, sessionDirectories.get(dispatched.captureId) ?? setDirectory)
    views.set(slot.attemptId, { captureId: dispatched.captureId, view: { attempt, task, key, parent, trail, trailNote, allowed: allowedStatusesFor(dispatched) } })
  }

  const targets = set.slots.filter((slot) => views.has(slot.attemptId) && (only === null || slot.attemptId === only))
  if (only !== null && targets.length === 0) fail(`--only names ${only}, which is not a dispatched slot of ${set.setId}`)
  const notReached = set.slots.filter((slot) => !views.has(slot.attemptId)).map((slot) => slot.attemptId)

  if (promptsDir !== null) {
    mkdirSync(promptsDir, { recursive: true })
    for (const slot of targets) writeFileSync(join(promptsDir, `${slot.attemptId}.md`), slotPrompt(views.get(slot.attemptId)!.view, null, null))
    writeFileSync(join(promptsDir, '_system.md'), SYSTEM_PROMPT)
    note(`wrote ${targets.length} prompt(s) to ${display(promptsDir)}`)
  }
  if (dryRun) {
    note(`dry run: ${targets.length} slot(s) would be graded by ${model} as "${reviewer}", ${notReached.length} not reached would stay pending; nothing was called or written`)
    return
  }

  let grades: LiveGrades = initializeLiveGrades(inputs)
  const reviewedAt = new Date().toISOString()
  const binding = { manifest, reviewer, reviewedAt }
  const adjudication: string[] = [
    `# Adjudication — ${set.setId}, reviewer "${reviewer}"`,
    '',
    `Written ${reviewedAt} by \`pnpm live:grade\`. Every call the model reviewer flagged as one a careful human might make the other way, slot by slot. The owner adjudicates these; a decision that changes a verdict is recorded in the key's constraints (a key revision with provenance), not silently in the grades file. Never commit this file: it quotes reviewer prose about Answers.`,
    '',
  ]
  let totalCost = 0
  let costKnown = true
  const summary: string[] = []

  for (const slot of targets) {
    const { view, captureId } = views.get(slot.attemptId)!
    note(`grading ${slot.attemptId} with ${model}…`)
    let errors: string[] | null = null
    let output: ReviewerOutput | null = null
    let served = 'unknown'
    for (let round = 0; round < 2; round += 1) {
      const result = callReviewer(slotPrompt(view, errors, output), model, maxUsd)
      served = result.model
      if (result.costUsd === null) costKnown = false
      else totalCost += result.costUsd
      if (!served.startsWith(model)) fail(`the CLI served the request with ${served}, not ${model} — the reviewer name would be a lie`)
      output = result.output
      const entry = entryOf(view, captureId, output, binding)
      const candidate = withEntry(grades, entry)
      const parsed = parseLiveGrades(candidate, inputs)
      if (parsed.ok) {
        grades = parsed.value
        errors = null
        break
      }
      errors = parsed.errors.filter((error) => error.includes(slot.attemptId))
      if (errors.length === 0) errors = [...parsed.errors]
      note(`  the validator refused round ${round + 1}: ${errors.join('; ')}`)
    }
    if (errors !== null || output === null) {
      adjudication.push(`## ${slot.attemptId} — LEFT PENDING`, '', 'The validator refused the model reviewer’s grade twice:', ...(errors ?? []).map((error) => `- ${error}`), '')
      summary.push(`${slot.attemptId}: pending (refused twice)`)
      continue
    }
    const unsatisfied = output.checks.filter((check) => !check.satisfied).map((check) => check.checkId)
    summary.push(`${slot.attemptId}: ${output.status}${unsatisfied.length > 0 ? ` (unsatisfied: ${unsatisfied.join(', ')})` : ''}${output.adjudicate.length > 0 ? ` — ${output.adjudicate.length} to adjudicate` : ''}`)
    adjudication.push(`## ${slot.attemptId} — ${output.status}`, '')
    if (output.adjudicate.length === 0) adjudication.push('Nothing flagged: every call sat clear of the line.', '')
    for (const item of output.adjudicate) adjudication.push(`- ${item.checkId === null ? 'verdict' : item.checkId}: ${item.question}`)
    if (output.adjudicate.length > 0) adjudication.push('')
    adjudication.push(`Rationale: ${output.rationale}`, '')
    const noted = output.checks.filter((check) => check.note.trim() !== '')
    if (noted.length > 0) adjudication.push('Notes on checks:', ...noted.map((check) => `- ${check.checkId} (${check.satisfied ? 'satisfied' : 'not satisfied'}): ${check.note}`), '')
    adjudication.push(`Served by ${served}.`, '')
  }

  const final = parseLiveGrades(grades, inputs)
  if (!final.ok) failWith('the grades file would not validate — nothing was written', final.errors)
  if (notReached.length > 0) adjudication.push(`## Not reached — left pending, not graded`, '', ...notReached.map((id) => `- ${id}`), '')
  adjudication.push(`## Spend`, '', costKnown ? `Total reported by the CLI: $${totalCost.toFixed(2)} across ${targets.length} slot(s).` : 'The CLI reported no cost for at least one call; the total is unknown.', '')

  writeFileAtomic(outPath, `${JSON.stringify(final.value, null, 2)}\n`)
  writeFileAtomic(adjudicatePath, `${adjudication.join('\n')}\n`)
  process.stdout.write(
    [
      `graded ${targets.length} slot(s) of ${set.setId} as "${reviewer}" under key ${manifest.keyVersion}; ${notReached.length} not reached stay pending`,
      ...summary.map((line) => `  ${line}`),
      `grades: ${display(outPath)}`,
      `to adjudicate: ${display(adjudicatePath)}`,
      costKnown ? `spend reported by the CLI: $${totalCost.toFixed(2)}` : 'spend: unknown (the CLI reported no cost for at least one call)',
      'Next: read the adjudication file, then pnpm live:report --capture=… --keys=… --grades=… (or open the bench and compare).',
    ].join('\n') + '\n',
  )
}

main()
