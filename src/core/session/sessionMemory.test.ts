import { describe, expect, it } from 'vitest'
import { createSessionMemory } from './sessionMemory'
import type { PipelineEvent } from '../pipeline/events'

// Session continuity (spec #23): the store is fed from the same pipeline
// event seam as the history recorder and answers one question — which
// distilled turns ride along with the next command's LLM requests.

function feed(observer: { event(event: PipelineEvent): void }, events: PipelineEvent[]): void {
  for (const event of events) observer.event(event)
}

function runEvents(
  command: string,
  answer: string,
  at: number,
  outcome: 'done' | 'failed' | 'cancelled' = 'done',
): PipelineEvent[] {
  return [
    { type: 'command', text: command, at },
    { type: 'status', status: 'thinking', at },
    { type: 'display', text: answer, at: at + 1 },
    { type: 'speak', text: answer, at: at + 2 },
    { type: 'done', outcome, at: at + 3 },
  ]
}

describe('sessionMemory', () => {
  it('returns no history before any run has completed', () => {
    const session = createSessionMemory()

    expect(session.history()).toEqual([])
  })

  it('rides the previous exchange along with the next command, oldest first', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    const next = session.run()
    next.event({ type: 'command', text: 'what about the second one?', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two: Pizza A and Pizza B.' },
    ])
  })

  it('keeps the whole thread within the 10-minute window', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    feed(session.run(), runEvents('what about the second one?', 'Pizza B on Main Street.', 60_000))
    const third = session.run()
    third.event({ type: 'command', text: 'navigate there', at: 60_000 + 9 * 60 * 1000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two: Pizza A and Pizza B.' },
      { role: 'user', text: 'what about the second one?' },
      { role: 'assistant', text: 'Pizza B on Main Street.' },
    ])
  })

  it('drops older exchanges once the window lapses but retains the most recent one', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    feed(session.run(), runEvents('what about the second one?', 'Pizza B on Main Street.', 60_000))
    const third = session.run()
    third.event({ type: 'command', text: 'pause it', at: 60_000 + 10 * 60 * 1000 + 10_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'what about the second one?' },
      { role: 'assistant', text: 'Pizza B on Main Street.' },
    ])
  })

  it('starts a fresh thread after a lapse: the lapsed exchange joins, older ones stay dropped', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    feed(session.run(), runEvents('what about the second one?', 'Pizza B on Main Street.', 60_000))
    feed(session.run(), runEvents('pause it', 'Paused.', 60_000 + 10 * 60 * 1000 + 10_000))
    const fourth = session.run()
    fourth.event({ type: 'command', text: 'resume it', at: 60_000 + 11 * 60 * 1000 + 10_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'what about the second one?' },
      { role: 'assistant', text: 'Pizza B on Main Street.' },
      { role: 'user', text: 'pause it' },
      { role: 'assistant', text: 'Paused.' },
    ])
  })

  it('includes a cancelled run as the command plus a cancelled note', () => {
    const session = createSessionMemory()
    feed(session.run(), [
      { type: 'command', text: 'find a pizza place', at: 1_000 },
      { type: 'status', status: 'cancelled', at: 2_000 },
      { type: 'done', outcome: 'cancelled', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', text: 'try again', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: '(run was cancelled)' },
    ])
  })

  it('includes a failed run as the command plus a failed note', () => {
    const session = createSessionMemory()
    feed(session.run(), [
      { type: 'command', text: 'find a pizza place', at: 1_000 },
      { type: 'error', message: 'orchestrator request failed', at: 2_000 },
      { type: 'done', outcome: 'failed', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', text: 'try again', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: '(run failed)' },
    ])
  })

  it('caps the thread at eight exchanges, dropping the oldest first', () => {
    const session = createSessionMemory()
    for (let index = 0; index < 10; index += 1) {
      feed(session.run(), runEvents(`command ${index}`, `answer ${index}`, index * 60_000))
    }
    const next = session.run()
    next.event({ type: 'command', text: 'one more', at: 10 * 60_000 })

    const history = session.history()
    expect(history).toHaveLength(16)
    expect(history[0]).toEqual({ role: 'user', text: 'command 2' })
    expect(history.at(-1)).toEqual({ role: 'assistant', text: 'answer 9' })
  })

  it('drops oldest exchanges until the thread fits the token budget', () => {
    const session = createSessionMemory()
    // Turns just under the 1,000-char truncation, so eight exchanges sum to
    // ~3,800 estimated tokens and the ~3k budget must drop the oldest two.
    const turn = (label: string): string => label.padEnd(950, 'x')
    for (let index = 0; index < 8; index += 1) {
      feed(session.run(), runEvents(turn(`command ${index}:`), turn(`answer ${index}:`), index * 60_000))
    }
    const next = session.run()
    next.event({ type: 'command', text: 'one more', at: 8 * 60_000 })

    const history = session.history()
    expect(history).toHaveLength(12)
    expect(history[0].text.startsWith('command 2:')).toBe(true)
    expect(history.at(-1)?.text.startsWith('answer 7:')).toBe(true)
  })

  it('truncates each turn to about 1,000 characters', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('c'.repeat(5_000), 'd'.repeat(5_000), 1_000))
    const next = session.run()
    next.event({ type: 'command', text: 'what about the second one?', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'c'.repeat(1_000) },
      { role: 'assistant', text: 'd'.repeat(1_000) },
    ])
  })

  it('keeps a newer run\'s frozen history when an older overlapping run finishes', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    // A long run overlaps a busy-rejected second command: the second command
    // owns the history from its start, so the first run's late done must not
    // release the frozen turns while the second is still mid-run.
    const longRun = session.run()
    longRun.event({ type: 'command', text: 'keep working', at: 2_000 })
    const busy = session.run()
    busy.event({ type: 'command', text: 'interrupt attempt', at: 2_500 })
    busy.event({ type: 'error', message: 'another command is already running', at: 2_600 })
    busy.event({ type: 'done', outcome: 'failed', at: 2_700 })

    const stillFrozen = session.history()
    expect(stillFrozen).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two.' },
    ])

    // The busy-rejected command still joins the thread for the next run.
    feed(longRun, [
      { type: 'display', text: 'Work complete.', at: 2_900 },
      { type: 'done', outcome: 'done', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', text: 'one more', at: 4_000 })
    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two.' },
      { role: 'user', text: 'interrupt attempt' },
      { role: 'assistant', text: '(run failed)' },
      { role: 'user', text: 'keep working' },
      { role: 'assistant', text: 'Work complete.' },
    ])
  })

  it('falls back to the spoken line when a completed run showed no display text', () => {
    const session = createSessionMemory()
    feed(session.run(), [
      { type: 'command', text: 'find a pizza place', at: 1_000 },
      { type: 'speak', text: 'Found two nearby.', at: 2_000 },
      { type: 'done', outcome: 'done', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', text: 'what about the second one?', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two nearby.' },
    ])
  })

  it('clears the frozen history for the active run, so the next read is empty', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', text: 'forget all that — different question', at: 60_000 })

    // Mid-run reset (spec #24): the store is read live per LLM round, so the
    // clear must override the run's frozen turns immediately.
    session.clear()

    expect(session.history()).toEqual([])
  })

  it('drops the resetting run\'s own exchange, so the next command starts clean', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', text: 'forget all that — different question', at: 60_000 })
    reset.event({ type: 'display', text: 'Fresh start — what do you need?', at: 60_003 })
    // The clear happens when the new_session tool executes, mid-run.
    session.clear()
    reset.event({ type: 'done', outcome: 'done', at: 60_004 })
    const next = session.run()
    next.event({ type: 'command', text: 'what is two plus two', at: 120_000 })

    expect(session.history()).toEqual([])
  })

  it('keeps a later run\'s exchange after a clear, so the thread rebuilds from the reset', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', text: 'forget all that', at: 60_000 })
    session.clear()
    reset.event({ type: 'done', outcome: 'done', at: 60_006 })
    const next = session.run()
    next.event({ type: 'command', text: 'what is two plus two', at: 120_000 })
    expect(session.history()).toEqual([])
    feed(next, [
      { type: 'display', text: 'Four.', at: 120_005 },
      { type: 'done', outcome: 'done', at: 120_006 },
    ])
    const after = session.run()
    after.event({ type: 'command', text: 'and twice that?', at: 180_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'what is two plus two' },
      { role: 'assistant', text: 'Four.' },
    ])
  })
})
