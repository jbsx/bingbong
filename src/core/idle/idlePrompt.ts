import type { PipelineEvent } from '../pipeline/events'

// The Idle Prompt's reply (#361): a line typed over the Idle Screen runs as
// a Command, and one that leaves the screen up answers in the Prompt — its
// Answer as the Feed would show it, or, read as no Command, its words
// muted. One that acts on the pane wakes the dashboard and this is gone.

export type IdleReply =
  | { kind: 'none' }
  /** Sent, its Command not yet seen. */
  | { kind: 'sent'; text: string }
  /** Its Command fired: every turn of its Task is listened to. */
  | { kind: 'working'; text: string; task: string; turns: readonly string[] }
  | { kind: 'answer'; text: string; task: string; turns: readonly string[]; answer: string; failure: boolean; muted: boolean }

export const NO_REPLY: IdleReply = { kind: 'none' }

export function sentReply(text: string): IdleReply {
  return { kind: 'sent', text }
}

/** The reply after one pipeline event. */
export function foldIdleReply(reply: IdleReply, event: PipelineEvent): IdleReply {
  if (reply.kind === 'none') return reply
  if (event.type === 'command') {
    const task = event.task?.id ?? event.turnId
    if (reply.kind === 'sent') {
      if (event.text.trim() !== reply.text) return reply
      if (event.dropped === true) return { kind: 'answer', text: reply.text, task, turns: [event.turnId], answer: event.action ?? event.text, failure: false, muted: true }
      return { kind: 'working', text: reply.text, task, turns: [event.turnId] }
    }
    if (task !== reply.task || reply.turns.includes(event.turnId)) return reply
    return { ...reply, turns: [...reply.turns, event.turnId] }
  }
  if (event.type === 'display' && reply.kind !== 'sent' && event.turnId !== undefined && reply.turns.includes(event.turnId)) {
    return { kind: 'answer', text: reply.text, task: reply.task, turns: reply.turns, answer: event.text, failure: event.failure === true, muted: event.muted === true }
  }
  return reply
}
