import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createFeedProjection } from '../feed/feedProjection'
import { createPeekCardFold, overlaySlotContent, PEEK_CARD_LINGER_MS, peekCardAnswer, peekCardOnIdleScreen, peekCardVisible } from './peekCardState'

// The Peek Card fold (ADR 0021, amended by ADR 0026): a command shows the
// Peek Card — never the panel — and the card's life is a pure fold over
// the same pipeline event seam every observer rides. Live while the run
// runs, then its Answer until 15 s past its spoken sentence (#470), or
// sooner when the next run or a panel open retires it; hidden on a
// cancelled run.

function command(text = 'find a pizza place', turnId = 't1'): PipelineEvent {
  return { type: 'command', turnId, text, at: 1_000 }
}

function done(at = 5_000, outcome?: 'done' | 'failed' | 'cancelled'): PipelineEvent {
  return { type: 'done', turnId: 't1', outcome, at }
}

describe('createPeekCardFold', () => {
  it('boots hidden', () => {
    const fold = createPeekCardFold()
    expect(fold.state()).toEqual({ phase: 'hidden', runId: null, commandText: null, retiresAt: null })
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a command shows the card live with the command echo and run identity', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('find a pizza place'))
    expect(fold.state()).toEqual({ phase: 'live', runId: 't1', commandText: 'find a pizza place', retiresAt: null })
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('run detail leaves the live card live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', at: 2_000 })
    fold.onEvent({ type: 'tool_call', turnId: 't1', callId: 'c1', name: 'navigate', args: {}, at: 3_000 })
    expect(fold.state().phase).toBe('live')
  })

  it("a foreign run's cancelled status never hides the reported run's answer", () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't0', status: 'cancelled', at: 4_000 })
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
  })

  it('done shows the answer (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('out-of-turn announcements during the answer leave the card alone', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'speak', text: 'one more thing', at: 9_000 })
    fold.onEvent({ type: 'display', text: 'and this', at: 9_500 })
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a new command while the answer shows returns the card to live', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('first'))
    fold.onEvent(done(5_000))
    fold.onEvent(command('second', 't2'))
    expect(fold.state()).toEqual({ phase: 'live', runId: 't2', commandText: 'second', retiresAt: null })
  })

  it('retireAnswer hides the answer', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.retireAnswer()
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('retireAnswer leaves the live report alive — closing the panel revives it (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.retireAnswer()
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't1' })
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a run finished while the panel was open lands its answer on the card (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.retireAnswer()
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a failed run shows on the card — the failure is the outcome (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000, 'failed'))
    expect(fold.state().phase).toBe('answer')
    expect(peekCardVisible(fold.state())).toBe(true)
  })

  it('a cancelled run hides the card — the screen goes quiet (ADR 0026)', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000, 'cancelled'))
    expect(fold.state().phase).toBe('hidden')
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a cancelled status without an explicit outcome hides the card too', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'status', turnId: 't1', status: 'cancelled', at: 4_000 })
    fold.onEvent(done(5_000))
    expect(fold.state().phase).toBe('hidden')
  })
})

// The linger (#470, ADR 0026 as amended): the owner's ruling ended the
// persisting answer — the card goes 15 s after its sentence is spoken, or
// after `done` when nothing is spoken, and nothing pauses it.
describe('the Peek Card linger', () => {
  it('the Answer goes 15 s after done when nothing is spoken', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    expect(PEEK_CARD_LINGER_MS).toBe(15_000)
    expect(fold.state().retiresAt).toBe(20_000)
    fold.expire(19_999)
    expect(fold.state().phase).toBe('answer')
    fold.expire(20_000)
    expect(fold.state().phase).toBe('hidden')
  })

  it('while its sentence sounds the Answer has no end; it goes 15 s after the sentence ends', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'speak', turnId: 't1', text: "That page doesn't exist.", failure: true, at: 4_000 })
    fold.onEvent(done(5_000))
    expect(fold.state()).toMatchObject({ phase: 'answer', retiresAt: null })
    fold.expire(60_000)
    expect(fold.state().phase).toBe('answer')
    fold.onEvent({ type: 'spoken', turnId: 't1', at: 9_000 })
    expect(fold.state().retiresAt).toBe(24_000)
  })

  it('a sentence ended before done counts from done', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Welcome.', at: 2_000 })
    fold.onEvent({ type: 'spoken', turnId: 't1', at: 3_000 })
    fold.onEvent(done(5_000))
    expect(fold.state().retiresAt).toBe(20_000)
  })

  it("a page read's further part holds the end off again until it is spoken", () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'part two', at: 6_000 })
    expect(fold.state().retiresAt).toBeNull()
    fold.onEvent({ type: 'spoken', turnId: 't1', at: 8_000 })
    expect(fold.state().retiresAt).toBe(23_000)
  })

  it("another turn's speech, or speech outside any turn, never moves the end", () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.onEvent(done(5_000))
    fold.onEvent({ type: 'speak', text: 'Downloaded a file.', at: 6_000 })
    fold.onEvent({ type: 'speak', turnId: 't0', text: 'old', at: 6_500 })
    expect(fold.state().retiresAt).toBe(20_000)
  })

  it('the live report never expires', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command())
    fold.expire(1_000_000)
    expect(fold.state().phase).toBe('live')
  })

  it('a line read as no Command is marked dropped, for the Idle Screen form', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'command', turnId: 't1', text: 'what a lovely day', dropped: true, task: { id: 't1', hop: 0 }, at: 1 })
    fold.onEvent(done(2))
    expect(fold.state()).toMatchObject({ phase: 'answer', dropped: true })
    fold.onEvent(command('play jazz', 't2'))
    expect(fold.state().dropped).toBeUndefined()
  })
})

// Over the Idle Screen (#470) the card shows only a failure or "No
// response.": a success's own card says it, and a Stop is neutral.
describe('peekCardOnIdleScreen', () => {
  const answerOf = (dropped = false) => ({ phase: 'answer' as const, runId: 't1', commandText: 'play jazz', retiresAt: 20_000, ...(dropped ? { dropped: true as const } : {}) })

  it('shows a failed Command', () => {
    const failed = { kind: 'display' as const, text: 'Nothing played.', failure: true }
    expect(peekCardOnIdleScreen(answerOf(), failed)).toBe(failed)
  })

  it('shows "No response." for a line read as no Command', () => {
    const none = { kind: 'display' as const, text: 'No response.\n\nNothing on this page fits the words.', failure: false, muted: true as const }
    expect(peekCardOnIdleScreen(answerOf(true), none)).toBe(none)
  })

  it('shows no success, no Stop, no Answer-less end and no live report', () => {
    expect(peekCardOnIdleScreen(answerOf(), { kind: 'display', text: 'Timer set for 5 minutes.', failure: false })).toBeNull()
    expect(peekCardOnIdleScreen(answerOf(), { kind: 'display', text: 'Nothing to stop.', failure: false, muted: true })).toBeNull()
    expect(peekCardOnIdleScreen(answerOf(), null)).toBeNull()
    expect(peekCardOnIdleScreen({ ...answerOf(), phase: 'live', retiresAt: null }, { kind: 'display', text: 'Nothing played.', failure: true })).toBeNull()
  })
})

describe('overlaySlotContent', () => {
  // ADR 0029: the overlay view shows exactly one element at a time —
  // expanded panel, Peek Card, or edge tab — because a native view
  // intercepts input across its whole bounds. The card replaces the tab
  // while visible; an open panel outranks both.
  const hidden = { phase: 'hidden', runId: null, commandText: null, retiresAt: null } as const
  const live = { phase: 'live', runId: 't1', commandText: 'find a mug', retiresAt: null } as const
  const answer = { phase: 'answer', runId: 't1', commandText: 'find a mug', retiresAt: 20_000 } as const

  it('an open panel shows the panel, whatever the card phase says', () => {
    expect(overlaySlotContent(true, hidden)).toBe('panel')
    expect(overlaySlotContent(true, live)).toBe('panel')
    expect(overlaySlotContent(true, answer)).toBe('panel')
  })

  it('collapsed with a visible card shows the card — it replaces the edge tab', () => {
    expect(overlaySlotContent(false, live)).toBe('card')
    expect(overlaySlotContent(false, answer)).toBe('card')
  })

  it('collapsed with no card shows the edge tab', () => {
    expect(overlaySlotContent(false, hidden)).toBe('tab')
  })
})

// The card's Answer (#329): only the reported Command's own — its Card, else
// its failure, else its Spoken Rendering — never a neighbour's, and a
// failure says so for the card's mark.
describe('peekCardAnswer', () => {
  const feedOf = (events: PipelineEvent[]) => {
    const feed = createFeedProjection()
    for (const event of events) feed.onEvent(event)
    return feed.entries()
  }
  const failedRead: PipelineEvent[] = [
    { type: 'command', turnId: 't1', text: 'read', at: 1 },
    { type: 'tool_result', turnId: 't1', callId: 't1-1', name: 'read_page', ok: false, error: 'page evaluation failed', at: 2 },
    { type: 'display', turnId: 't1', text: "This page can't be read right now.", failure: true, at: 3 },
    { type: 'speak', turnId: 't1', text: "This page can't be read right now.", failure: true, at: 3 },
    { type: 'done', turnId: 't1', outcome: 'failed', at: 4 },
  ]

  it("never shows an earlier Command's failure on a later successful one", () => {
    const entries = feedOf([
      ...failedRead,
      { type: 'command', turnId: 't2', text: 'navigate example.com', at: 5 },
      { type: 'tool_result', turnId: 't2', callId: 't2-1', name: 'navigate', ok: true, result: 'navigated', at: 6 },
      { type: 'done', turnId: 't2', outcome: 'done', at: 7 },
    ])
    expect(peekCardAnswer(entries, 't2')).toBeNull()
  })

  it("never shows an earlier Command's Answer on a later one that has none", () => {
    const entries = feedOf([
      { type: 'command', turnId: 't1', text: 'screenshot', at: 1 },
      { type: 'display', turnId: 't1', text: 'screenshot saved: /shots/1.jpg', at: 2 },
      { type: 'done', turnId: 't1', outcome: 'done', at: 3 },
      { type: 'command', turnId: 't2', text: 'scroll down', at: 4 },
      { type: 'done', turnId: 't2', outcome: 'done', at: 5 },
    ])
    expect(peekCardAnswer(entries, 't1')).toEqual({ kind: 'display', text: 'screenshot saved: /shots/1.jpg', failure: false })
    expect(peekCardAnswer(entries, 't2')).toBeNull()
  })

  it("a Task's closing hop that fires nothing leaves the card on the hop that answered", () => {
    const events: PipelineEvent[] = [
      { type: 'command', turnId: 'h0', text: 'open the example page and read it', action: 'open example.com', task: { id: 'h0', hop: 0 }, at: 1 },
      { type: 'done', turnId: 'h0', outcome: 'done', at: 2 },
      { type: 'command', turnId: 'h1', text: 'open the example page and read it', action: 'read the page', task: { id: 'h0', hop: 1 }, at: 3 },
      { type: 'display', turnId: 'h1', text: 'Welcome to the example.', at: 4 },
      { type: 'done', turnId: 'h1', outcome: 'done', at: 5 },
      { type: 'command', turnId: 'h2', text: 'open the example page and read it', action: 'done', dropped: true, task: { id: 'h0', hop: 2 }, at: 6 },
      { type: 'done', turnId: 'h2', outcome: 'done', at: 7 },
    ]
    const fold = createPeekCardFold()
    for (const event of events) fold.onEvent(event)
    expect(fold.state()).toMatchObject({ phase: 'answer', runId: 'h1' })
    expect(peekCardAnswer(feedOf(events), fold.state().runId)).toEqual({ kind: 'display', text: 'Welcome to the example.', failure: false })
  })

  it("#336: a Task's superseded closing hop, after a hop that fired, leaves the card on the hop that fired", () => {
    const events: PipelineEvent[] = [
      { type: 'command', turnId: 'h0', text: 'open elon musks latest tweet', action: 'open x.com/elonmusk', task: { id: 'h0', hop: 0 }, at: 1 },
      { type: 'display', turnId: 'h0', text: 'Opened X.', at: 2 },
      { type: 'done', turnId: 'h0', outcome: 'done', at: 3 },
      { type: 'command', turnId: 'h1', text: 'open elon musks latest tweet', action: 'click [3] "Latest"', task: { id: 'h0', hop: 1 }, at: 4 },
      { type: 'display', turnId: 'h1', text: 'Clicked “Latest”.', at: 5 },
      { type: 'done', turnId: 'h1', outcome: 'done', at: 6 },
      { type: 'command', turnId: 'h2', text: 'open elon musks latest tweet', action: 'abandoned: stopped', dropped: true, task: { id: 'h0', hop: 2 }, at: 7 },
      { type: 'done', turnId: 'h2', outcome: 'cancelled', at: 8 },
    ]
    const fold = createPeekCardFold()
    for (const event of events) fold.onEvent(event)
    expect(fold.state()).toMatchObject({ phase: 'answer', runId: 'h1' })
    expect(peekCardAnswer(feedOf(events), fold.state().runId)).toEqual({ kind: 'display', text: 'Clicked “Latest”.', failure: false })
  })

  it("#336: an older Task's hop abandoned after a later Command's words never takes the card from that Command", () => {
    const events: PipelineEvent[] = [
      { type: 'command', turnId: 'h0', text: 'open elon musks latest tweet', action: 'open x.com/elonmusk', task: { id: 'h0', hop: 0 }, at: 1 },
      { type: 'done', turnId: 'h0', outcome: 'done', at: 2 },
      { type: 'command', turnId: 'n0', text: 'scroll down', action: 'scroll down', task: { id: 'n0', hop: 0 }, at: 3 },
      { type: 'command', turnId: 'h1', text: 'open elon musks latest tweet', action: 'abandoned: a later Command came first', dropped: true, task: { id: 'h0', hop: 1 }, at: 4 },
      { type: 'done', turnId: 'h1', outcome: 'cancelled', at: 5 },
      { type: 'display', turnId: 'n0', text: 'Scrolled down.', at: 6 },
      { type: 'done', turnId: 'n0', outcome: 'done', at: 7 },
    ]
    const fold = createPeekCardFold()
    for (const event of events) fold.onEvent(event)
    expect(fold.state()).toMatchObject({ phase: 'answer', runId: 'n0' })
  })

  it('an Utterance read as no Command still shows its own card, not the last Answer', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'command', turnId: 't1', text: 'screenshot', task: { id: 't1', hop: 0 }, at: 1 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 2 })
    fold.onEvent({ type: 'command', turnId: 't2', text: 'what a lovely day', dropped: true, task: { id: 't2', hop: 0 }, at: 3 })
    fold.onEvent({ type: 'done', turnId: 't2', outcome: 'done', at: 4 })
    expect(fold.state()).toMatchObject({ phase: 'answer', runId: 't2' })
  })

  it("a Stop's Answer is marked muted, for the card's grey mark", () => {
    const entries = feedOf([
      { type: 'command', turnId: 't1', text: 'stop', at: 1 },
      { type: 'display', turnId: 't1', text: 'Nothing to stop.', muted: true, at: 2 },
      { type: 'done', turnId: 't1', outcome: 'done', at: 3 },
    ])
    expect(peekCardAnswer(entries, 't1')).toEqual({ kind: 'display', text: 'Nothing to stop.', failure: false, muted: true })
  })

  it('a failed Command answers with its plain failure line, marked as a failure', () => {
    expect(peekCardAnswer(feedOf(failedRead), 't1')).toEqual({ kind: 'display', text: "This page can't be read right now.", failure: true })
  })

  it('a wall the action met answers with its spoken line, marked as a failure; a plain spoken line is not', () => {
    const entries = feedOf([
      { type: 'command', turnId: 't1', text: 'open example.com/missing', at: 1 },
      { type: 'speak', turnId: 't1', text: "That page doesn't exist.", failure: true, at: 2 },
      { type: 'done', turnId: 't1', outcome: 'done', at: 3 },
      { type: 'command', turnId: 't2', text: 'read', at: 4 },
      { type: 'speak', turnId: 't2', text: 'Welcome to the example.', at: 5 },
      { type: 'done', turnId: 't2', outcome: 'done', at: 6 },
    ])
    expect(peekCardAnswer(entries, 't1')).toEqual({ kind: 'spoken', text: "That page doesn't exist.", failure: true })
    expect(peekCardAnswer(entries, 't2')).toEqual({ kind: 'spoken', text: 'Welcome to the example.', failure: false })
  })
})
