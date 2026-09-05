// The vision records (#186, ADR 0031): what the vision adapter was asked
// and what came back. The adapter logged nothing at all — a Look that
// missed its Vision Deadline reached the model as one advisory line and
// reached the developer as nothing — so the two questions a vision bug
// always asks, "was it even called" and "what did it cost", had no answer
// on disk.
//
// Unlike the voice records beside them, these are not host-scoped by
// nature: a Look happens inside a Run and belongs beside that Run's
// decisions. So they take the fault route rather than a family — a report
// with a turn id in hand lands in the Run Trace, everything else in the
// Host Trace — which is the boundary rule of ADR 0031 applied to a second
// reporter. It is threaded as a dependency rather than installed as a
// global: vision has three call sites, all of them tools with a
// ToolContext already in hand, and the global the fault seam justified was
// justified by reaching every `catch {}` in the codebase.

import { VisionDeadlineError } from '../ports/vision'
import { routeByTurn, type TraceRouteDeps } from './traceRoute'
import type { RunId, SessionId } from '../session/sessionIdentity'

/** How much of a vision answer a settled record keeps. */
export const TRACE_VISION_ANSWER_MAX_CHARS = 2_000

/** Which capability of the adapter a request used. */
export type VisionCapability = 'describe' | 'locate'

/**
 * Why the request happened. The three are genuinely different callers with
 * different budgets and different caps, and reading a Run's vision spend
 * without separating them says nothing: `look` is the model asking,
 * `auto_vision` is the pipeline asking on a stale ref, `ground_visual` is
 * the DOM having failed to identify one target.
 */
export type VisionReason = 'look' | 'auto_vision' | 'ground_visual'

/**
 * One vision request as it settled (#186). Recorded at settlement rather
 * than at the start because the Vision Deadline guarantees settlement —
 * every request ends within its whole-Look cap, answered or thrown — so
 * one line per request holds the ask and its outcome together, and a Run's
 * vision spend is countable by reading them.
 */
export interface VisionRequestEvent {
  readonly kind: 'vision_request'
  readonly capability: VisionCapability
  readonly reason: VisionReason
  /** The target a `locate` was asked to find; absent on a describe. */
  readonly target?: string
  /** The caller's advisory whole-Look cap (#106); absent means the Look's own. */
  readonly capMs?: number
  /** How long the request took, in milliseconds, however it ended. */
  readonly durationMs: number
  /**
   * How it ended. `deadline` is a {@link VisionDeadlineError} — the
   * request was hung or slow past its cap; `error` is anything else the
   * adapter threw, an HTTP failure or an unparseable answer included.
   */
  readonly outcome: 'ok' | 'deadline' | 'error'
  /** Length of the answer on success, before the cut. */
  readonly answerChars?: number
  /** The answer's head on success, cut at {@link TRACE_VISION_ANSWER_MAX_CHARS}. */
  readonly answer?: string
  /** The failure's message on `deadline` or `error`. */
  readonly message?: string
  /** The delegated worker whose Look this was; absent on the Run's own. */
  readonly agentId?: string
}

/**
 * One Vision Budget decision (#186). A refusal is the record that matters
 * — a Run that stopped Looking because its budget ran out looks exactly
 * like a Run that never wanted to Look — but a grant is recorded too, so
 * the spend is countable without inferring it from the requests that
 * happened to succeed.
 */
export interface VisionBudgetEvent {
  readonly kind: 'vision_budget'
  readonly reason: VisionReason
  readonly granted: boolean
  /** The refusal as the model reads it; absent on a grant. */
  readonly refusal?: string
  readonly agentId?: string
}

/** What the vision seam records, whichever family it lands in. */
export type VisionTraceEvent = VisionRequestEvent | VisionBudgetEvent

/**
 * The identities a vision call site has in hand. Only the turn: a tool
 * knows the turn it is executing in and nothing else about the Run, and a
 * record naming ids the caller never held would be a joinable-looking
 * lie. The turn is what the file joins on anyway.
 */
export interface VisionTraceIds {
  readonly turnId?: string
}

/**
 * What a vision call site records through; absent when nothing is
 * tracing. Like the fault reporter it is safe to call from anywhere, and
 * like every trace writer it must never throw at its caller.
 */
export type VisionTraceReporter = (event: VisionTraceEvent, ids?: VisionTraceIds) => void

/**
 * One vision record as the Run Trace keeps it. The Run and Session ids
 * are the shared route's, not the seam's: a vision call site only ever
 * hands over a turn ({@link VisionTraceIds}), so in practice they are
 * absent — the shape says what the file may hold, not what this seam
 * fills in.
 */
export type VisionRunTraceRecord = VisionTraceEvent & {
  readonly v: number
  readonly at: number
  readonly turnId: string
  readonly runId?: RunId
  readonly sessionId?: SessionId
}

/**
 * Builds the reporter main hands the pipelines. The route is the fault
 * route (ADR 0031): a turn id in hand means the record belongs beside the
 * Run's decisions, so it goes to the Run Trace; without one it is
 * something the app did outside any Run, so it goes to the Host Trace and
 * names the Active Session instead. A turn-scoped record with the Run
 * Trace off is dropped rather than smuggled into the Host Trace, for the
 * same reason a fault is.
 */
export function createVisionTraceRouter(deps: TraceRouteDeps): VisionTraceReporter {
  return (event, ids) => {
    try {
      routeByTurn(deps, event, ids ?? {})
    // eslint-disable-next-line no-restricted-syntax -- a trace writer's own guard: reporting here would re-enter the write that failed
    } catch {
      // A failed trace must never break the request it is recording.
    }
  }
}

/** One vision answer as a record keeps it: cut, with the true length beside it. */
export function tracedAnswer(answer: string): { answer: string; answerChars: number } {
  return { answer: answer.slice(0, TRACE_VISION_ANSWER_MAX_CHARS), answerChars: answer.length }
}

/** What a request record says about the ask, before it settled. */
export type VisionRequestDescriptor = Pick<VisionRequestEvent, 'capability' | 'reason' | 'target' | 'capMs'>

/**
 * The reporter, the identities and the clock one vision call site records
 * with, plus the delegated worker it belongs to when there is one. Built
 * from a ToolContext by `visionSeam`, which is the only place that reads
 * the context — a call site never assembles ids of its own.
 */
export interface VisionTraceSeam {
  readonly trace?: VisionTraceReporter | undefined
  readonly ids?: VisionTraceIds | undefined
  /** The delegated worker whose call this is; absent on the Run's own. */
  readonly agentId?: string | undefined
  now(): number
}

/**
 * Runs one vision request and records how it settled — the one place the
 * outcome discrimination lives, so every call site classifies a missed
 * Vision Deadline the same way. The failure is rethrown unchanged: the
 * record is a byproduct, never a handler.
 */
export async function tracedVisionRequest<T>(
  seam: VisionTraceSeam,
  descriptor: VisionRequestDescriptor,
  run: () => Promise<T>,
  answerOf: (value: T) => string,
): Promise<T> {
  const trace = seam.trace
  if (trace === undefined) return run()
  const started = seam.now()
  const settle = (settled: Pick<VisionRequestEvent, 'outcome' | 'answer' | 'answerChars' | 'message'>): void => {
    trace(
      {
        kind: 'vision_request',
        ...descriptor,
        ...(seam.agentId !== undefined ? { agentId: seam.agentId } : {}),
        durationMs: seam.now() - started,
        ...settled,
      },
      seam.ids,
    )
  }
  try {
    const value = await run()
    settle({ outcome: 'ok', ...tracedAnswer(answerOf(value)) })
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    settle({ outcome: error instanceof VisionDeadlineError ? 'deadline' : 'error', message })
    throw error
  }
}
