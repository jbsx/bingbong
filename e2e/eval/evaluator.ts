import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import { collectPerfRecords } from '../../src/main/perf/collectPerfRecords'
import { startFixtureServer } from '../fixtureServer'
import { startHarness, type Harness } from '../harness'
import { sleep, waitFor } from '../waitFor'
import { aggregateScenarios, combineRuns, extractMetrics, type EvalAggregate, type ScenarioMetrics } from './metrics'
import { loadProductionEnv, resolveProductionRouting, type ProductionRouting } from './routing'
import type { EvalScenario, PaneState, ScenarioObservation } from './scenarios'

// The opt-in real-model evaluator (#109): one Electron app, one live
// Session, the corpus submitted through the Prompt Bar like a user's
// commands, and every decision made by the production-routed orchestrator.
// Measurement rides the app's own surfaces — the dashboard's pipeline-event
// subscription (taped verbatim via CDP) and the always-on perf log under
// the isolated profile — so the evaluator never changes what it measures.
// Scenario success is recorded, not asserted: a failing scenario is
// baseline data. Only broken measurement (no routing, a scripted model, a
// missing run) fails the suite.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Per-scenario wall budget before the run is aborted and recorded as timed out. */
export const DEFAULT_SCENARIO_TIMEOUT_MS = 15 * 60_000

/**
 * Steering's fallback window (#130): submit the directive this long after
 * the command even without a settled tool call, so a thinking-heavy run is
 * still corrected mid-flight rather than after it finishes.
 */
const STEER_FALLBACK_MS = 3_000

/**
 * The cancelled-work grace (#130): after the marker page was visited, wait
 * this long for an evidence checkpoint before aborting anyway — on a path
 * without checkpoints (the baseline tree) this is the whole window, on the
 * current path the checkpoint usually lands far sooner.
 */
const CANCEL_GRACE_MS = 12_000

export interface ScenarioResult {
  id: string
  kind: EvalScenario['kind']
  command: string
  success: boolean
  failureReason: string | null
  /** The scenario's combined view: summed work, final-run semantics (see combineRuns). */
  metrics: ScenarioMetrics
  /** Every executed command of the scenario, in order (#130's multi-run classes). */
  runs: ScenarioMetrics[]
}

export interface ModelWitness {
  orchestratorModel: string | null
  orchestratorRequests: number
  /** Non-empty means a scripted model served something — fails the suite. */
  scriptedEntries: { role: string; model: string }[]
}

export interface EvalReport {
  capturedAt: string
  gitCommit: string
  scenarioTimeoutMs: number
  routing: ProductionRouting['identity']
  /** Derived at finish() from the usage-ledger witness; partial writes omit it. */
  scriptedModelProvenAbsent?: boolean
  modelWitness: ModelWitness
  scenarios: ScenarioResult[]
  /** Present on the finalized report; partial (per-scenario) writes omit it. */
  aggregate?: EvalAggregate
}

export interface Evaluator {
  harness: Harness
  runScenario(scenario: EvalScenario): Promise<ScenarioResult>
  finish(): Promise<EvalReport>
  quit(): Promise<void>
}

interface UsageLedger {
  date: string
  entries?: { role: string; model: string; requests: number }[]
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  } catch {
    return 'unknown'
  }
}

function failureReasonOf(observation: ScenarioObservation): string | null {
  if (observation.timedOut) return 'scenario timed out and was aborted'
  if (observation.rawLimitFailure !== null) return observation.rawLimitFailure
  if (observation.outcome === null) return 'no run outcome was recorded'
  if (observation.outcome !== 'done') return `pipeline outcome: ${observation.outcome}`
  return 'objective predicate failed'
}

async function readUsageLedger(userDataDir: string): Promise<UsageLedger> {
  try {
    return JSON.parse(await readFile(join(userDataDir, 'usage.json'), 'utf8')) as UsageLedger
  } catch {
    return { date: '', entries: [] }
  }
}

export async function startEvaluator(options?: { scenarioTimeoutMs?: number; reportPath?: string }): Promise<Evaluator> {
  const scenarioTimeoutMs = options?.scenarioTimeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS
  const reportPath = options?.reportPath ?? join(repoRoot, 'e2e', 'eval', 'report.json')

  // Fail fast — before any Electron launch or model spend — when production
  // routing is absent (resolveProductionRouting throws) or a scripted hook
  // would survive into the composed env.
  const routing = resolveProductionRouting(await loadProductionEnv())

  const fixture = await startFixtureServer()
  const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-eval-profile-'))
  const harness = await startHarness({
    fixture,
    userDataDir,
    env: routing.env,
  })

  // The tape: the dashboard's own event subscription, captured verbatim.
  // Installed once; every later read filters by turn id.
  await harness.dashboardEval(`
    (() => {
      if (!window.__evalTapeInstalled) {
        window.__evalTapeInstalled = true
        window.__evalTape = []
        window.bingbong.assistant.onEvent((event) => { window.__evalTape.push(event) })
      }
      return window.__evalTape.length
    })()
  `)

  const readTape = (): Promise<PipelineEvent[]> =>
    harness.dashboardEval<PipelineEvent[]>('window.__evalTape ?? []')

  const perfRecordsFor = (turnId: string): PerfSpanRecord[] =>
    collectPerfRecords(join(userDataDir, 'logs')).records.filter((record) => record.turnId === turnId)

  const doneArrived = (turnId: string): Promise<boolean> =>
    harness.dashboardEval<boolean>(
      `(window.__evalTape ?? []).some((event) => event.type === 'done' && event.turnId === ${JSON.stringify(turnId)})`,
    )

  const results: ScenarioResult[] = []

  const report = (): EvalReport => ({
    capturedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    scenarioTimeoutMs,
    routing: routing.identity,
    modelWitness: { orchestratorModel: null, orchestratorRequests: 0, scriptedEntries: [] },
    scenarios: results,
  })

  // Written after every scenario, so a killed capture keeps partial data.
  const persist = async (current: EvalReport): Promise<void> => {
    await mkdir(join(repoRoot, 'e2e', 'eval'), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(current, null, 2)}\n`)
  }

  // The pane-state probe (#130): one fixed, additive DOM read collected
  // after every scenario — objective state the direct-action predicates
  // judge (title mutations, dialog presence, scroll, control values,
  // injected media keys) without the evaluator changing what it measures.
  const readPaneState = (): Promise<PaneState | null> =>
    harness
      .paneEval<PaneState>(`(() => ({
        title: document.title,
        scrollY: Math.round(window.scrollY || 0),
        dialogPresent: !!document.querySelector('[role="dialog"]'),
        agreeChecked: (document.querySelector('#agree') || {}).checked ?? null,
        pressedKeys: window.__pressedKeys ?? null,
      }))()`)
      .catch(() => null)

  /**
   * One submitted command: its turn id, its metrics, and whether it hit the
   * scenario wall budget. `whileRunning` rides alongside the live run — the
   * seam the Steering and cancelled-work classes act through, concurrent
   * with the done-wait so the run never finishes before the hook lands.
   */
  async function awaitRun(
    command: string,
    whileRunning?: (turnId: string) => Promise<void>,
  ): Promise<{ turnId: string; metrics: ScenarioMetrics }> {
    const submittedAt = Date.now()
    const submitted = await harness.submitCommand(command)
    if (submitted !== 'submitted') throw new Error(`command was not submitted: ${submitted}`)

    // Find this run's turn id: the command event for our text, minted after
    // submission (the tape may hold older runs of identical text).
    const turnId = await waitFor(
      async () => {
        const found = await harness.dashboardEval<string | null>(`
          (window.__evalTape ?? []).find(
            (event) => event.type === 'command' && event.text === ${JSON.stringify(command)} && event.at >= ${submittedAt - 2000},
          )?.turnId ?? null
        `)
        return found ?? undefined
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )

    // Wait out the run — or abort it at the scenario budget and record the timeout.
    let timedOut = false
    const settled = (async () => {
      try {
        await waitFor(async () => (await doneArrived(turnId)) ? true : undefined, {
          timeoutMs: scenarioTimeoutMs,
          intervalMs: 500,
        })
      } catch {
        timedOut = true
        await harness.dashboardEval('window.bingbong.assistant.abort()')
        await waitFor(async () => (await doneArrived(turnId)) ? true : undefined, {
          timeoutMs: 60_000,
          intervalMs: 500,
        }).catch(() => {})
      }
    })()
    if (whileRunning !== undefined) await whileRunning(turnId)
    await settled
    // Let the run's terminal bookkeeping (summary span, memory commit) land.
    await sleep(500)

    // Turn-bearing events only (session lifecycle and agent cards carry none).
    const events = (await readTape()).filter((event): event is PipelineEvent & { turnId: string } => 'turnId' in event && event.turnId === turnId)
    return { turnId, metrics: extractMetrics(events, perfRecordsFor(turnId), timedOut) }
  }

  /** True once the run's tape shows a successful call with these args-text and result-ok pairings. */
  const tapeHasOkCall = async (turnId: string, predicate: (name: string, argsText: string) => boolean): Promise<boolean> => {
    const tape = await readTape()
    const calls = new Map(
      tape
        .filter((event): event is Extract<PipelineEvent, { type: 'tool_call' }> => event.type === 'tool_call' && event.turnId === turnId)
        .map((call) => [call.callId, call] as const),
    )
    return tape.some(
      (event): event is Extract<PipelineEvent, { type: 'tool_result' }> =>
        event.type === 'tool_result' &&
        event.turnId === turnId &&
        event.ok &&
        calls.get(event.callId) !== undefined &&
        predicate(calls.get(event.callId)!.name, JSON.stringify(calls.get(event.callId)!.args)),
    )
  }

  async function runScenario(scenario: EvalScenario): Promise<ScenarioResult> {
    const command = scenario.command(fixture)
    const runs: ScenarioMetrics[] = []

    // Steering (#130): the directive goes in through the same seam a user's
    // typed correction does, the moment the run has real work in flight (a
    // settled tool call) — or after a short fallback window, so a
    // slow-to-start run still gets corrected before it can finish.
    const steerWhileRunning =
      scenario.steer !== undefined
        ? async (turnId: string): Promise<void> => {
            const directive = scenario.steer!(fixture)
            const fallbackAt = Date.now() + STEER_FALLBACK_MS
            await waitFor(
              async () => ((await tapeHasOkCall(turnId, () => true)) || Date.now() >= fallbackAt ? true : undefined),
              { timeoutMs: 30_000, intervalMs: 100 },
            ).catch(() => {})
            const taken = await harness.dashboardEval<boolean>(
              `window.bingbong.assistant.steer(${JSON.stringify(directive)})`,
            )
            if (taken !== true) throw new Error(`steering directive was not taken for ${scenario.id}`)
          }
        : undefined

    // Cancelled work (#130): abort the first run once its evidence was
    // checkpointed — or, on a path without checkpoints, once the marker page
    // was visited and a grace interval produced no checkpoint.
    const cancelWhileRunning =
      scenario.cancel !== undefined
        ? async (turnId: string): Promise<void> => {
            const marker = scenario.cancel!.urlMarker
            let firstVisitedAt: number | null = null
            await waitFor(
              async () => {
                // A run that finished before the trigger (a fast honest
                // answer with no checkpoint) leaves nothing to cancel —
                // stop waiting rather than blocking the follow-up.
                if (await doneArrived(turnId)) return true
                if (await tapeHasOkCall(turnId, (name) => name === 'record_evidence')) return true
                const visited = await tapeHasOkCall(turnId, (_name, argsText) => argsText.includes(marker))
                if (visited) {
                  firstVisitedAt ??= Date.now()
                  if (Date.now() - firstVisitedAt >= CANCEL_GRACE_MS) return true
                }
                return undefined
              },
              { timeoutMs: scenarioTimeoutMs, intervalMs: 250 },
            ).catch(() => {})
            await harness.dashboardEval('window.bingbong.assistant.abort()')
          }
        : undefined

    const whileRunning = [steerWhileRunning, cancelWhileRunning].find((hook) => hook !== undefined)
    if (steerWhileRunning !== undefined && cancelWhileRunning !== undefined) {
      throw new Error(`${scenario.id} declares both steer and cancel — the eval models them as exclusive`)
    }
    const first = await awaitRun(command, whileRunning)
    runs.push(first.metrics)

    // The follow-up command (cancelled-work reuse and stale-evidence classes).
    if (scenario.followUp !== undefined) {
      scenario.followUp.prepare?.(fixture)
      const second = await awaitRun(scenario.followUp.command(fixture))
      runs.push(second.metrics)
    }

    // One combined view feeds both the predicate's observation and the
    // recorded result — the multi-run semantics exist once, in combineRuns.
    const combined = combineRuns(runs)
    const paneUrl = await harness.paneUrl().catch(() => undefined)
    const paneHeading = await harness
      .paneEval<string | null>('document.querySelector("h1")?.textContent?.trim() ?? null')
      .catch(() => null)
    const observation: ScenarioObservation = {
      paneUrl,
      paneHeading,
      paneState: await readPaneState(),
      answerText: combined.answerText,
      outcome: combined.outcome,
      rawLimitFailure: combined.rawLimitFailure,
      timedOut: combined.timedOut,
      runs: runs.map((metrics) => ({ metrics })),
    }
    const success = scenario.success(observation, fixture)
    const result: ScenarioResult = {
      id: scenario.id,
      kind: scenario.kind,
      command,
      success,
      failureReason: success ? null : failureReasonOf(observation),
      metrics: combined,
      runs,
    }
    results.push(result)
    await persist(report())
    return result
  }

  async function finish(): Promise<EvalReport> {
    // Runtime witness that the resolved model — not any scripted double —
    // served the rounds: the app's own usage ledger records the client per
    // turn, so a scripted orchestrator would read 'scripted' here.
    const ledger = await readUsageLedger(userDataDir)
    const entries = ledger.entries ?? []
    const orchestratorEntries = entries.filter((entry) => entry.role === 'orchestrator')
    const distinctModels = [...new Set(orchestratorEntries.map((entry) => entry.model))]
    const witness: ModelWitness = {
      // A single orchestrator model must have served; a ledger that ever
      // disagrees with itself is surfaced instead of silently pinning one.
      orchestratorModel:
        distinctModels.length > 1 ? `mixed:${distinctModels.join('+')}` : distinctModels[0] ?? null,
      orchestratorRequests: orchestratorEntries.reduce((sum, entry) => sum + entry.requests, 0),
      scriptedEntries: entries
        .filter((entry) => entry.model === 'scripted')
        .map((entry) => ({ role: entry.role, model: entry.model })),
    }
    const final = report()
    final.modelWitness = witness
    final.scriptedModelProvenAbsent =
      witness.scriptedEntries.length === 0 && witness.orchestratorModel !== null && witness.orchestratorRequests > 0
    final.aggregate = aggregateScenarios(results)
    await persist(final)
    return final
  }

  async function quit(): Promise<void> {
    await harness.quit().catch(() => {})
    await fixture.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }

  return {
    harness,
    runScenario,
    finish,
    quit,
  }
}
