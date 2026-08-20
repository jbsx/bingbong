import { describe, expect, it } from 'vitest'
import { createSessionMemory, SESSION_WINDOW_MS } from './sessionMemory'
import type { Clock } from '../ports/clock'
import type { PipelineEvent } from '../pipeline/events'

// Session continuity (spec #23): the store is fed from the same pipeline
// event seam as the history recorder and answers one question — which
// distilled turns ride along with the next command's LLM requests.

// Turn ids became part of every event shape (#28); the session store keys on
// time, not ids, so these fixtures carry one placeholder.
const TURN = 'turn-fixture'

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
    { type: 'command', turnId: TURN, text: command, at },
    { type: 'status', turnId: TURN, status: 'thinking', at },
    { type: 'display', text: answer, at: at + 1 },
    { type: 'speak', text: answer, at: at + 2 },
    { type: 'done', turnId: TURN, outcome, at: at + 3 },
  ]
}

/** Deterministic clock for the eager-lapse timer (ADR 0005): manual advance. */
function fakeClock(): { clock: Clock; advance(to: number): void } {
  let now = 0
  const timers = new Set<{ at: number; fn: () => void; cancelled: boolean }>()
  return {
    clock: {
      now: () => now,
      setTimer(ms, fn) {
        const timer = { at: now + ms, fn, cancelled: false }
        timers.add(timer)
        return () => {
          timer.cancelled = true
        }
      },
    },
    // Each timer fires at most once; a timer re-armed from inside a firing
    // callback is scheduled against the already-advanced `now`, so it never
    // re-fires within the same advance.
    advance(to) {
      now = to
      for (const timer of [...timers]) {
        if (timer.cancelled || timer.at > now) continue
        timer.cancelled = true
        timer.fn()
      }
    },
  }
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
    next.event({ type: 'command', turnId: TURN, text: 'what about the second one?', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two: Pizza A and Pizza B.' },
    ])
  })

  it('never threads steering directives into the session history (ADR 0001)', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what about the second one?', at: 60_000 })
    // The steer echo (#46) rides the same seam — it must not read as a
    // user turn (the directive reaches the model via the request, not the
    // distilled thread).
    next.event({ type: 'steer', turnId: TURN, text: 'use Paris instead', at: 60_100 })
    next.event({ type: 'display', text: 'Pizza B on Main Street.', at: 60_200 })
    next.event({ type: 'done', turnId: TURN, outcome: 'done', at: 60_300 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two: Pizza A and Pizza B.' },
      { role: 'user', text: 'what about the second one?' },
      { role: 'assistant', text: 'Pizza B on Main Street.' },
    ])
  })

  it('keeps the whole thread within the 30-minute window', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    feed(session.run(), runEvents('what about the second one?', 'Pizza B on Main Street.', 60_000))
    const third = session.run()
    third.event({
      type: 'command',
      turnId: TURN,
      text: 'navigate there',
      at: 60_003 + SESSION_WINDOW_MS - 60_000,
    })

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
    third.event({ type: 'command', turnId: TURN, text: 'pause it', at: 60_003 + SESSION_WINDOW_MS + 10_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'what about the second one?' },
      { role: 'assistant', text: 'Pizza B on Main Street.' },
    ])
  })

  it('starts a fresh thread after a lapse: the lapsed exchange joins, older ones stay dropped', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    feed(session.run(), runEvents('what about the second one?', 'Pizza B on Main Street.', 60_000))
    feed(session.run(), runEvents('pause it', 'Paused.', 60_003 + SESSION_WINDOW_MS + 10_000))
    const fourth = session.run()
    fourth.event({
      type: 'command',
      turnId: TURN,
      text: 'resume it',
      at: 60_003 + SESSION_WINDOW_MS + 70_000,
    })

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
      { type: 'command', turnId: TURN, text: 'find a pizza place', at: 1_000 },
      { type: 'status', turnId: TURN, status: 'cancelled', at: 2_000 },
      { type: 'done', turnId: TURN, outcome: 'cancelled', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'try again', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: '(run was cancelled)' },
    ])
  })

  it('includes a failed run as the command plus a failed note', () => {
    const session = createSessionMemory()
    feed(session.run(), [
      { type: 'command', turnId: TURN, text: 'find a pizza place', at: 1_000 },
      { type: 'error', message: 'orchestrator request failed', at: 2_000 },
      { type: 'done', turnId: TURN, outcome: 'failed', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'try again', at: 60_000 })

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
    next.event({ type: 'command', turnId: TURN, text: 'one more', at: 10 * 60_000 })

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
    next.event({ type: 'command', turnId: TURN, text: 'one more', at: 8 * 60_000 })

    const history = session.history()
    expect(history).toHaveLength(12)
    expect(history[0].text.startsWith('command 2:')).toBe(true)
    expect(history.at(-1)?.text.startsWith('answer 7:')).toBe(true)
  })

  it('truncates each turn to about 1,000 characters', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('c'.repeat(5_000), 'd'.repeat(5_000), 1_000))
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what about the second one?', at: 60_000 })

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
    longRun.event({ type: 'command', turnId: TURN, text: 'keep working', at: 2_000 })
    const busy = session.run()
    busy.event({ type: 'command', turnId: TURN, text: 'interrupt attempt', at: 2_500 })
    busy.event({ type: 'error', message: 'another command is already running', at: 2_600 })
    busy.event({ type: 'done', turnId: TURN, outcome: 'failed', at: 2_700 })

    const stillFrozen = session.history()
    expect(stillFrozen).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two.' },
    ])

    // The busy-rejected command still joins the thread for the next run.
    feed(longRun, [
      { type: 'display', text: 'Work complete.', at: 2_900 },
      { type: 'done', turnId: TURN, outcome: 'done', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'one more', at: 4_000 })
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
      { type: 'command', turnId: TURN, text: 'find a pizza place', at: 1_000 },
      { type: 'speak', text: 'Found two nearby.', at: 2_000 },
      { type: 'done', turnId: TURN, outcome: 'done', at: 3_000 },
    ])
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what about the second one?', at: 60_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: 'Found two nearby.' },
    ])
  })

  it('clears the frozen history for the active run, so the next read is empty', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', turnId: TURN, text: 'forget all that — different question', at: 60_000 })

    // Mid-run reset (spec #24): the store is read live per LLM round, so the
    // clear must override the run's frozen turns immediately.
    session.clear()

    expect(session.history()).toEqual([])
  })

  it('drops the resetting run\'s own exchange, so the next command starts clean', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two: Pizza A and Pizza B.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', turnId: TURN, text: 'forget all that — different question', at: 60_000 })
    reset.event({ type: 'display', text: 'Fresh start — what do you need?', at: 60_003 })
    // The clear happens when the new_session tool executes, mid-run.
    session.clear()
    reset.event({ type: 'done', turnId: TURN, outcome: 'done', at: 60_004 })
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what is two plus two', at: 120_000 })

    expect(session.history()).toEqual([])
  })

  it('keeps a later run\'s exchange after a clear, so the thread rebuilds from the reset', () => {
    const session = createSessionMemory()
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', turnId: TURN, text: 'forget all that', at: 60_000 })
    session.clear()
    reset.event({ type: 'done', turnId: TURN, outcome: 'done', at: 60_006 })
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what is two plus two', at: 120_000 })
    expect(session.history()).toEqual([])
    feed(next, [
      { type: 'display', text: 'Four.', at: 120_005 },
      { type: 'done', turnId: TURN, outcome: 'done', at: 120_006 },
    ])
    const after = session.run()
    after.event({ type: 'command', turnId: TURN, text: 'and twice that?', at: 180_000 })

    expect(session.history()).toEqual([
      { role: 'user', text: 'what is two plus two' },
      { role: 'assistant', text: 'Four.' },
    ])
  })

  // Session-scoped transcript (spec #25): the store already decides when a
  // new session begins — onSessionStart surfaces that decision so the
  // dashboard can clear the transcript at exactly that moment (lazy clear).

  it('announces a session start when a command arrives after the window lapses', () => {
    let starts = 0
    const session = createSessionMemory({ onSessionStart: () => { starts += 1 } })
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'pause it', at: 1_000 + SESSION_WINDOW_MS + 1_000 })

    expect(starts).toBe(1)
  })

  it('stays silent for the first-ever command and for commands inside the window', () => {
    let starts = 0
    const session = createSessionMemory({ onSessionStart: () => { starts += 1 } })
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what about the second one?', at: 60_000 })

    expect(starts).toBe(0)
  })

  it('announces a session start on a mid-run clear that discards history', () => {
    let starts = 0
    const session = createSessionMemory({ onSessionStart: () => { starts += 1 } })
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', turnId: TURN, text: 'forget all that', at: 60_000 })

    session.clear()

    expect(starts).toBe(1)
  })

  it('stays silent on a clear with nothing to forget and on the command after a reset', () => {
    let starts = 0
    const session = createSessionMemory({ onSessionStart: () => { starts += 1 } })
    // Idempotent no-op on an empty store (ADR 0002) — no session boundary.
    session.clear()
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const reset = session.run()
    reset.event({ type: 'command', turnId: TURN, text: 'forget all that', at: 60_000 })
    session.clear()
    reset.event({ type: 'done', turnId: TURN, outcome: 'done', at: 60_006 })
    // The reset already announced the boundary; the next command continues
    // the fresh session, so it must not clear the reset run's answer.
    const next = session.run()
    next.event({ type: 'command', turnId: TURN, text: 'what is two plus two', at: 120_000 })

    expect(starts).toBe(1)
  })

  it('stays silent for a busy-rejected overlapping command, even after the window lapses', () => {
    let starts = 0
    const session = createSessionMemory({ onSessionStart: () => { starts += 1 } })
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const longRun = session.run()
    longRun.event({ type: 'command', turnId: TURN, text: 'keep working', at: 2_000 })
    const busy = session.run()
    busy.event({ type: 'command', turnId: TURN, text: 'interrupt attempt', at: 1_000 + SESSION_WINDOW_MS + 1_000 })

    expect(starts).toBe(0)
  })

  it('honours a custom window for the lapse decision', () => {
    let starts = 0
    const session = createSessionMemory({ windowMs: 5_000, onSessionStart: () => { starts += 1 } })
    feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
    const within = session.run()
    within.event({ type: 'command', turnId: TURN, text: 'follow up', at: 4_000 })
    feed(within, [
      { type: 'display', text: 'Followed.', at: 4_001 },
      { type: 'done', turnId: TURN, outcome: 'done', at: 4_002 },
    ])
    const lapsed = session.run()
    lapsed.event({ type: 'command', turnId: TURN, text: 'much later', at: 4_002 + 5_000 + 1 })

    expect(starts).toBe(1)
  })

  // Eager lapse (ADR 0005, superseding ADR 0003's lazy clear): the boundary
  // announces itself on a timer while idle — the view wipes without waiting
  // for the next command. Never mid-run; the thread keeps its most recent
  // exchange exactly as before (ADR 0001's asymmetry is untouched).

  describe('eager lapse', () => {
    it('announces the boundary on a timer once the window elapses while idle', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))

      advance(1_003 + SESSION_WINDOW_MS - 1)
      expect(starts).toBe(0)
      advance(1_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(1)
    })

    it('uses the 30-minute default window for the timer', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))

      // One minute short of 30 minutes: still the same session.
      advance(1_003 + 29 * 60 * 1000)
      expect(starts).toBe(0)
      // Past 30 minutes of idleness: the boundary fired.
      advance(1_003 + 30 * 60 * 1000 + 1)
      expect(starts).toBe(1)
    })

    it('re-arms the boundary as later runs finish inside the window', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
      // A follow-up well inside the window pushes the boundary out to its
      // own finish; the first boundary instant passes without firing.
      advance(30_000)
      feed(session.run(), runEvents('what about the second one?', 'Pizza B.', 30_000))

      advance(1_003 + SESSION_WINDOW_MS + 10_000)
      expect(starts).toBe(0)
      advance(30_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(1)
    })

    it('never announces mid-run: a live command cancels the pending boundary until it finishes', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))

      // A long run starts inside the window and outruns the first boundary:
      // the view is never wiped underneath a live command.
      advance(20_000)
      const longRun = session.run()
      longRun.event({ type: 'command', turnId: TURN, text: 'keep working', at: 20_000 })
      advance(1_003 + SESSION_WINDOW_MS + 10_000)
      expect(starts).toBe(0)

      feed(longRun, [
        { type: 'display', text: 'Work complete.', at: 60_000 },
        { type: 'done', turnId: TURN, outcome: 'done', at: 60_003 },
      ])
      advance(60_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(1)
    })

    it('keeps the most recent exchange in the thread after an eager lapse', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
      feed(session.run(), runEvents('what about the second one?', 'Pizza B.', 60_000))
      advance(60_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(1)

      // ADR 0001's retention is untouched by the eager view wipe: a later
      // "pause it" still resolves against the most recent exchange.
      const next = session.run()
      next.event({ type: 'command', turnId: TURN, text: 'pause it', at: 60_003 + SESSION_WINDOW_MS + 5_000 })
      expect(session.history()).toEqual([
        { role: 'user', text: 'what about the second one?' },
        { role: 'assistant', text: 'Pizza B.' },
      ])
    })

    it('does not announce twice for one lapse — the next command stays silent', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
      advance(1_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(1)

      const next = session.run()
      next.event({ type: 'command', turnId: TURN, text: 'different question', at: 1_003 + SESSION_WINDOW_MS + 5_000 })

      expect(starts).toBe(1)
    })

    it('announces lazily still when the command beats the timer to the same boundary', () => {
      // Defensive path: event timestamps outrun the clock (skewed `at`
      // stamps), so the command itself reports the lapse first.
      const { clock } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
      const next = session.run()
      next.event({ type: 'command', turnId: TURN, text: 'much later', at: 1_003 + SESSION_WINDOW_MS + 1 })

      expect(starts).toBe(1)
    })

    it('announces again for the session after the lapsed one', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
      advance(1_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(1)

      feed(session.run(), runEvents('different question', 'Answer.', 1_003 + SESSION_WINDOW_MS + 5_000))
      advance(1_003 + SESSION_WINDOW_MS + 5_003 + SESSION_WINDOW_MS)
      expect(starts).toBe(2)
    })

    it('honours a custom window for the eager boundary', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ windowMs: 5_000, onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))

      advance(1_003 + 5_000 - 1)
      expect(starts).toBe(0)
      advance(1_003 + 5_000)
      expect(starts).toBe(1)
    })

    it('a model-invoked clear cancels the pending boundary', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      const session = createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      feed(session.run(), runEvents('find a pizza place', 'Found two.', 1_000))
      session.clear()
      expect(starts).toBe(1)

      advance(1_003 + SESSION_WINDOW_MS + 10_000)
      expect(starts).toBe(1)
    })

    it('stays silent while the store is empty — nothing to lapse', () => {
      const { clock, advance } = fakeClock()
      let starts = 0
      createSessionMemory({ onSessionStart: () => { starts += 1 }, clock })
      advance(SESSION_WINDOW_MS * 3)
      expect(starts).toBe(0)
    })
  })
})
