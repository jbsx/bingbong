// The pipeline_event records (#185, ADR 0031): one record per published
// PipelineEvent. Recorded History keeps only the projected *text* of a
// Run and the Run Trace kept only its evidence grading — what the Run
// actually decided (its Run Plan, each Tool Round's call and result,
// status, errors, asks and confirmations, the Session boundaries) is
// published on the event stream and was kept nowhere. This is the tap on
// that stream, and because it records the event object as published,
// owner stamps included, it records exactly what every view was told.
//
// Nothing here writes anything unless the developer opted in with
// `BINGBONG_RUN_TRACE` (#184): the writer exists only where a sink does,
// and with the flag unset there is no sink at all.

import type { PipelineEvent, UnstampedEvent } from '../pipeline/events'
import {
  RUN_TRACE_VERSION,
  TRACE_TOOL_RESULT_MAX_CHARS,
  type PipelineEventTraceEvent,
  type PipelineEventTraceRecord,
  type RunTraceSink,
} from './runTrace'

/**
 * The two kinds the tap drops: streaming chunks flushed every ~120ms
 * while a round is in flight. Their assembled result is already kept —
 * reasoning by the `reasoning` record (#182), answer text by the
 * `display` and `done` events — so recording them again would only spend
 * the roll on fragments of what the file already holds.
 */
export const UNTRACED_PIPELINE_EVENT_TYPES = ['llm_delta', 'llm_tool_intent'] as const

/**
 * Whether one event earns a record. It reads nothing but the type, so a
 * caller can ask before entering a trace writer's guard — deciding not to
 * write cannot itself fail.
 */
export function tracesPipelineEvent(event: { readonly type: PipelineEvent['type'] }): boolean {
  return !(UNTRACED_PIPELINE_EVENT_TYPES as readonly string[]).includes(event.type)
}

/**
 * One event as its record body keeps it: verbatim, but for a
 * `tool_result` whose text is cut at {@link TRACE_TOOL_RESULT_MAX_CHARS}
 * with the full length beside it. A result that is not text is left
 * alone — structured results are the small ones, and rewriting a shape
 * the file is meant to record faithfully would cost more than it saves.
 */
export function pipelineEventTraceBody(event: PipelineEvent, agentId?: string): PipelineEventTraceEvent {
  const stamped = agentId !== undefined ? { agentId } : {}
  if (event.type !== 'tool_result' || typeof event.result !== 'string') {
    return { kind: 'pipeline_event', event, ...stamped }
  }
  return {
    kind: 'pipeline_event',
    event: { ...event, result: event.result.slice(0, TRACE_TOOL_RESULT_MAX_CHARS) },
    chars: event.result.length,
    ...stamped,
  }
}

/**
 * What a delegated worker's Tool Round calls to record one of its events
 * (#185). Built by the spawning Run over its own writer and turn, exactly
 * as the reasoning trace is (#183): the worker never sees the Run Trace's
 * identities or its record shape — not even the turn its events belong
 * to, which is why it hands them unstamped and the Run stamps its own.
 * Its presence is the whole opt-in on the worker path — absent, a
 * worker's stream is recorded nowhere.
 */
export type SubagentPipelineEventTrace = (event: UnstampedEvent, agentId: string | undefined) => void

/**
 * What the publisher calls to record one published event; absent when
 * nothing is tracing. Unlike a Run's writer this binds no identity: the
 * publisher sees a Session boundary and a download announcement as well
 * as a Run's own stream, so each record carries the identity the event
 * was stamped with and nothing more.
 */
export type PipelineEventTraceWriter = (event: PipelineEvent) => void

/**
 * Binds a sink to the published stream. Same guard as every other Run
 * Trace writer: building the record and writing it both happen inside it,
 * so a dead logs dir — or an argument payload that resists
 * serialization — degrades to an event that simply leaves no record,
 * never to a publication that fails.
 */
export function createPipelineEventTraceWriter(deps: {
  sink: RunTraceSink
  now(): number
}): PipelineEventTraceWriter {
  return (event) => {
    try {
      if (!tracesPipelineEvent(event)) return
      const record: PipelineEventTraceRecord = {
        v: RUN_TRACE_VERSION,
        at: deps.now(),
        ...('turnId' in event && event.turnId !== undefined ? { turnId: event.turnId } : {}),
        ...(event.runId !== undefined ? { runId: event.runId } : {}),
        ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
        ...(event.sessionGeneration !== undefined ? { generation: event.sessionGeneration } : {}),
        ...pipelineEventTraceBody(event),
      }
      deps.sink.write(record)
    // eslint-disable-next-line no-restricted-syntax -- a trace writer's own guard: reporting here would re-enter the write that failed
    } catch {
      // A failed trace must never break the event it is recording.
    }
  }
}
