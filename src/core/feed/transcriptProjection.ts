import type { PipelineEvent } from '../pipeline/events'
import { describeToolAction } from '../pipeline/toolCallDisplay'

// The projection every transcript-shaped view shares: one published
// PipelineEvent in, at most one displayable line out. It was written so
// the live dashboard and Recorded History would agree word for word;
// #188 retired the latter, leaving the Feed projection its only caller —
// the Run Trace records the events themselves, not their text.

/** The transcript entry kinds a Feed line can be. */
export type TranscriptKind = 'command' | 'tool' | 'display' | 'speak' | 'error' | 'voice'

/** One transcript-visible event, before Feed identity is attached. */
export interface TranscriptEvent {
  kind: TranscriptKind
  text: string
  at: number
}

/** The single projection the dashboard and the Feed panel overlay share. */
export function projectPipelineEvent(event: PipelineEvent): TranscriptEvent | null {
  switch (event.type) {
    case 'command':
      return { kind: 'command', text: event.text, at: event.at }
    case 'tool_call':
      return { kind: 'tool', text: describeToolAction(event.name, event.args), at: event.at }
    case 'tool_result':
      return event.ok
        ? null
        : { kind: 'error', text: `${event.name} failed: ${event.error}`, at: event.at }
    case 'display':
      return { kind: 'display', text: event.text, at: event.at }
    case 'speak':
      return { kind: 'speak', text: event.text, at: event.at }
    case 'error':
      return { kind: 'error', text: event.message, at: event.at }
    default:
      return null
  }
}
