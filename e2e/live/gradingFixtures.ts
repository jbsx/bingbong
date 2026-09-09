// Test-only capture builders for the #226 suites (grades.test.ts,
// report.test.ts). Not part of the reporting contract and never imported
// by grades.ts, report.ts or the CLI — it exists so the two suites share
// one honest capture shape instead of hand-writing LiveMetrics objects
// that could drift from what #224's projection actually produces.
//
// Everything here builds a real event tape and runs it through
// `extractLiveMetrics`, so a fixture can only express observations a real
// capture could have made. The facts are invented: no fixture carries a
// real hunt's prompt, key or Answer, because a grading suite that baked in
// the pilot's oracle would be testing the oracle rather than the workflow.

import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import { digestOf } from './artifacts.ts'
import { extractLiveMetrics } from './metrics.ts'
import {
  LIVE_CAPTURE_SCHEMA_VERSION,
  LIVE_CAPTURE_SET_KIND,
  LIVE_SESSION_CAPTURE_KIND,
  type AttemptRelation,
  type LiveAttemptCapture,
  type LiveAttemptRecord,
  type LiveCaptureSet,
  type LiveLaunchProvenance,
  type LiveNotReachedAttempt,
  type LiveScheduledAttempt,
  type LiveSessionCapture,
  type LiveTerminal,
} from './types.ts'

/** A fixed epoch so every fixture's arithmetic is readable in the assertions. */
export const T0 = 1_800_000_000_000

export function launchProvenance(overrides: Partial<LiveLaunchProvenance> = {}): LiveLaunchProvenance {
  return {
    mode: 'measured',
    commit: '0'.repeat(40),
    dirtyTree: false,
    dirtyPaths: [],
    platform: { node: 'v24.0.0', os: 'linux', electron: '43.0.0' },
    roles: {
      orchestrator: { configured: true, baseUrl: 'https://example.invalid/v1', model: 'model-o', keyFingerprint: 'sha256:aaaa' },
      subagent: { configured: true, baseUrl: 'https://example.invalid/v1', model: 'model-s', keyFingerprint: 'sha256:bbbb' },
      vision: { configured: true, baseUrl: 'https://example.invalid/v1', model: 'model-v', keyFingerprint: 'sha256:cccc' },
    },
    reasoningEffortOverride: null,
    effortOverrides: {},
    envFile: { path: '.env', present: true, digest: 'sha256:dddd' },
    settings: {
      source: 'explicit',
      digest: 'sha256:eeee',
      adblockEnabled: true,
      webZoomPercent: 100,
      appearance: 'dark',
      sttModel: 'moonshine',
      routingOverrides: false,
    },
    adblock: { lists: 'production_default', listsOverride: null, resourcesOverride: null },
    scriptedHooks: [],
    wakeMonitoring: 'off',
    traceFlags: { runTrace: true, hostTrace: true },
    profile: { seed: 'fresh_benchmark', downloadsDir: 'benchmark_owned' },
    accessGuard: true,
    ...overrides,
  }
}

export interface AttemptSpec {
  attemptId: string
  huntId: string
  stepId?: string
  order?: number
  relation?: AttemptRelation
  parentAttemptId?: string
  promptVersion?: string
  commandText?: string
  /** Offset from {@link T0} of the accepted command; null leaves acceptance unobserved. */
  acceptedAt?: number | null
  /** The marked final Answer; null means the Run published none. */
  answer?: { at: number; text: string; deterministic?: boolean } | null
  /** The `done` event; null means the Run never reached its terminal. */
  terminal?: { at: number } & Partial<Omit<LiveTerminal, 'at' | 'turnId'>> | null
  perfRecords?: readonly PerfSpanRecord[]
  traceRecords?: readonly TraceRecord[]
  /** Extra events spliced into the tape before the terminal (asks, errors, plans). */
  extraEvents?: readonly PipelineEvent[]
  captureId?: string
}

/** The turn id an attempt's events share. */
export function turnIdOf(attemptId: string): string {
  return `turn-${attemptId}`
}

/**
 * One dispatched attempt, projected through #224's own metrics so the
 * fixture cannot claim an observation the projection would not make.
 */
export function attemptCapture(spec: AttemptSpec): LiveAttemptCapture {
  const turnId = turnIdOf(spec.attemptId)
  const captureId = spec.captureId ?? `capture-${spec.huntId}`
  const acceptedOffset = spec.acceptedAt === undefined ? 0 : spec.acceptedAt
  const events: PipelineEvent[] = []
  if (acceptedOffset !== null) {
    events.push({ type: 'command', turnId, text: spec.commandText ?? 'invented fixture command', at: T0 + acceptedOffset })
  }
  events.push(...(spec.extraEvents ?? []))
  const answer = spec.answer === undefined ? { at: 30_000, text: 'invented fixture answer' } : spec.answer
  if (answer !== null) {
    events.push({
      type: 'display',
      turnId,
      text: answer.text,
      at: T0 + answer.at,
      finalAnswer: true,
      ...(answer.deterministic === true ? { deterministicAnswer: true as const } : {}),
    })
  }
  const terminal = spec.terminal === undefined ? { at: 40_000 } : spec.terminal
  if (terminal !== null) {
    events.push({
      type: 'done',
      turnId,
      at: T0 + terminal.at,
      ...(terminal.outcome === undefined ? { outcome: 'done' as const } : terminal.outcome === null ? {} : { outcome: terminal.outcome }),
      ...(terminal.resolution === undefined || terminal.resolution === null ? {} : { resolution: terminal.resolution }),
      ...(terminal.finalizationCause === undefined || terminal.finalizationCause === null
        ? {}
        : { finalizationCause: terminal.finalizationCause }),
    })
  }

  const metrics = extractLiveMetrics({
    events,
    perfRecords: spec.perfRecords ?? [],
    traceRecords: spec.traceRecords ?? [],
    input: 'typed',
    clockOrigin: captureId,
  })

  const iso = (offset: number): string => new Date(T0 + offset).toISOString()
  return {
    kind: 'attempt',
    attemptId: spec.attemptId,
    huntId: spec.huntId,
    stepId: spec.stepId ?? 'initial',
    order: spec.order ?? 0,
    relation: spec.relation ?? 'initial',
    ...(spec.parentAttemptId === undefined ? {} : { parentAttemptId: spec.parentAttemptId }),
    command: {
      text: spec.commandText ?? 'invented fixture command',
      prompt: { version: spec.promptVersion ?? 'p1', hash: digestOf(spec.commandText ?? 'invented fixture command') },
    },
    dispatch: { requestedAt: iso(-500), submitResult: 'accepted', cursor: 0 },
    accepted:
      acceptedOffset === null
        ? { status: 'unavailable', reason: 'the Prompt Bar never published an accepted command' }
        : {
            status: 'observed',
            value: {
              at: T0 + acceptedOffset,
              text: spec.commandText ?? 'invented fixture command',
              turnId,
              runId: `run-${spec.attemptId}`,
              sessionId: `session-${captureId}`,
              sessionGeneration: 1,
              submissionId: `submit-${spec.attemptId}`,
            },
          },
    finalAnswer:
      answer === null
        ? { status: 'unavailable', reason: 'no display event was marked as the final Answer' }
        : {
            status: 'observed',
            value: { at: T0 + answer.at, text: answer.text, turnId, deterministic: answer.deterministic === true },
          },
    terminal:
      terminal === null
        ? { status: 'unavailable', reason: 'no done event — the Run never reached its terminal' }
        : {
            status: 'observed',
            value: {
              at: T0 + terminal.at,
              turnId,
              outcome: terminal.outcome === undefined ? 'done' : terminal.outcome,
              resolution: terminal.resolution ?? null,
              finalizationCause: terminal.finalizationCause ?? null,
            },
          },
    settlement: { status: 'observed', value: iso(terminal === null ? 60_000 : terminal.at) },
    stop: { at: iso(terminal === null ? 60_000 : terminal.at), reason: terminal === null ? 'attempt_timeout' : 'terminal' },
    waits: metrics.waits,
    anomalies: [],
    continuation: { ready: terminal !== null, reason: terminal === null ? 'the Run never ended' : 'ready', checkedAt: iso(61_000) },
    bounds: { acceptanceMs: 20_000, attemptMs: 1_200_000, drainMs: 5_000, abortMs: 10_000 },
    metrics,
    events: null,
  }
}

export function notReached(spec: {
  attemptId: string
  huntId: string
  stepId?: string
  order?: number
  relation?: AttemptRelation
  parentAttemptId?: string
  reason?: string
}): LiveNotReachedAttempt {
  return {
    kind: 'not_reached',
    attemptId: spec.attemptId,
    huntId: spec.huntId,
    stepId: spec.stepId ?? 'follow_up',
    order: spec.order ?? 1,
    relation: spec.relation ?? 'revised_objective',
    ...(spec.parentAttemptId === undefined ? {} : { parentAttemptId: spec.parentAttemptId }),
    command: { text: 'invented fixture follow-up', prompt: { version: 'p1', hash: digestOf('invented fixture follow-up') } },
    reason: spec.reason ?? 'the Session could not accept a follow-up',
    decidedAt: new Date(T0 + 70_000).toISOString(),
  }
}

export function sessionCapture(spec: {
  captureId: string
  huntId: string
  attempts: readonly LiveAttemptRecord[]
  setId?: string
  launch?: LiveLaunchProvenance
  closeState?: LiveSessionCapture['closeState']
  retention?: LiveSessionCapture['retention']
  artifacts?: LiveSessionCapture['artifacts']
}): LiveSessionCapture {
  return {
    kind: LIVE_SESSION_CAPTURE_KIND,
    schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
    captureId: spec.captureId,
    ...(spec.setId === undefined ? {} : { setId: spec.setId }),
    huntId: spec.huntId,
    mode: 'measured',
    startedAt: new Date(T0 - 5_000).toISOString(),
    closedAt: new Date(T0 + 90_000).toISOString(),
    launch: spec.launch ?? launchProvenance(),
    attempts: spec.attempts,
    artifacts: spec.artifacts ?? [],
    closeState: spec.closeState ?? 'closed',
    errors: [],
    retention: spec.retention ?? { complete: true, note: null },
  }
}

/** A slot built from the attempt record that fills it, so the two always agree. */
export function slotOf(record: LiveAttemptRecord): LiveScheduledAttempt {
  return {
    attemptId: record.attemptId,
    huntId: record.huntId,
    stepId: record.stepId,
    order: record.order,
    prompt: record.command.prompt,
    relation: record.relation,
    ...(record.parentAttemptId === undefined ? {} : { parentAttemptId: record.parentAttemptId }),
  }
}

export function captureSet(spec: {
  setId?: string
  slots: readonly LiveScheduledAttempt[]
  sessions: readonly LiveSessionCapture[]
  state?: LiveCaptureSet['state']
  mode?: LiveCaptureSet['mode']
}): LiveCaptureSet {
  return {
    kind: LIVE_CAPTURE_SET_KIND,
    schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
    setId: spec.setId ?? 'set-1',
    study: { name: 'fixture-study', protocolVersion: 'v0' },
    mode: spec.mode ?? 'measured',
    createdAt: new Date(T0 - 10_000).toISOString(),
    slots: spec.slots,
    sessions: spec.sessions.map((session) => ({ captureId: session.captureId, huntId: session.huntId, path: `${session.captureId}/capture.json` })),
    state: spec.state ?? 'complete',
  }
}

/** One perf span, `t` monotonic from the launch origin. */
export function span(stage: string, endT: number, durMs: number): PerfSpanRecord {
  return { turnId: 'unused', stage, durMs, at: T0 + endT, t: endT }
}
