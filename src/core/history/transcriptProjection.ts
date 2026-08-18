import type { PipelineEvent } from '../pipeline/events'
import { describeToolAction } from '../pipeline/toolCallDisplay'
import type { TranscriptEvent } from './historyStore'

/** The single projection shared by the live dashboard and persisted history. */
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
