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
  /** A Command's action taken (#324), shown under the words heard. */
  action?: string
  /** An Utterance read as no Command (#324): the words alone, greyed — and a Stop's Answer, a cancelled Command's grey line. */
  muted?: boolean
  /** A line telling what went wrong (#329): it takes the failure colour. */
  failure?: boolean
}

function sameWords(a: string, b: string): boolean {
  const plain = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()
  return plain(a) === plain(b)
}

/** The single projection the dashboard and the Feed panel overlay share. */
export function projectPipelineEvent(event: PipelineEvent): TranscriptEvent | null {
  switch (event.type) {
    case 'command':
      return {
        kind: 'command',
        text: event.text,
        at: event.at,
        // The action only when it adds to the words: "read" → "read the page", never "back" → "back".
        ...(event.action !== undefined && !sameWords(event.action, event.text) ? { action: event.action } : {}),
        ...(event.dropped ? { muted: true } : {}),
      }
    case 'tool_call':
      return { kind: 'tool', text: describeToolAction(event.name, event.args), at: event.at }
    case 'tool_result':
      // A failure shows once (#333): its plain-words line is the Command's Answer, never a second line here.
      return null
    case 'display':
      return { kind: 'display', text: event.text, ...(event.failure ? { failure: true } : {}), ...(event.muted ? { muted: true } : {}), at: event.at }
    case 'speak':
      return { kind: 'speak', text: event.text, ...(event.failure ? { failure: true } : {}), at: event.at }
    case 'error':
      return { kind: 'error', text: event.message, at: event.at }
    default:
      return null
  }
}
