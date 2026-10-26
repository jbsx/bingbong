import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createFeedProjection } from '../feed/feedProjection'
import type { VoiceState } from '../voice/ipcChannels'
import { createPeekCardFold, EMPTY_LEDGER, overlaySlotContent, PEEK_CARD_LINGER_MS, peekCardAnswer, peekCardOnIdleScreen, peekCardVisible, railStation, ledgerFace, rowClock } from './peekCardState'

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
    expect(fold.state()).toMatchObject({ phase: 'hidden', runId: null, commandText: null, retiresAt: null })
    expect(peekCardVisible(fold.state())).toBe(false)
  })

  it('a command shows the card live with the command echo and run identity', () => {
    const fold = createPeekCardFold()
    fold.onEvent(command('find a pizza place'))
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't1', commandText: 'find a pizza place', retiresAt: null })
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
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't2', commandText: 'second', retiresAt: null })
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
  const answerOf = (dropped = false) => ({ phase: 'answer' as const, runId: 't1', commandText: 'play jazz', retiresAt: 20_000, ledger: EMPTY_LEDGER, ...(dropped ? { dropped: true as const } : {}) })

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
  const hidden = { phase: 'hidden', runId: null, commandText: null, retiresAt: null, ledger: EMPTY_LEDGER } as const
  const live = { phase: 'live', runId: 't1', commandText: 'find a mug', retiresAt: null, ledger: EMPTY_LEDGER } as const
  const answer = { phase: 'answer', runId: 't1', commandText: 'find a mug', retiresAt: 20_000, ledger: EMPTY_LEDGER } as const

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

// The Ledger Strip (#475): the card opens on the wake and carries every
// step of the turn — the ear's faces, the heard line, each stage with its
// object, the reading, the sentence and the end — as rows on one ledger,
// with the words of the moment and the rail's station read from it.
describe('the turn ledger', () => {
  const rest: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }
  const listening = (since: number, reason: 'wake' | 'hotkey' = 'wake'): VoiceState => ({ ...rest, listening: true, reason, since })
  const hearing = (since: number): VoiceState => ({ ...listening(since), hearing: true })
  const transcribing = (since: number): VoiceState => ({ ...rest, transcribing: true, since })
  const labels = (fold: ReturnType<typeof createPeekCardFold>) => fold.state().ledger.rows.map((row) => `${row.label}: ${row.text}`)

  it('boots with an empty ledger', () => {
    expect(createPeekCardFold().state().ledger).toEqual(EMPTY_LEDGER)
  })

  it('a wake listen opens the card Listening, the ear open, counted from its opening', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_010)
    expect(fold.state()).toMatchObject({ phase: 'listening', runId: null })
    expect(peekCardVisible(fold.state())).toBe(true)
    expect(fold.state().ledger).toMatchObject({ startedAt: 1_000, ear: 'listening', earSince: 1_000 })
    expect(labels(fold)).toEqual(['Listening: say a command'])
    expect(railStation(fold.state().ledger)).toBeNull()
  })

  it('an ear that closes with nothing heard takes the card with it', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onVoice(rest, 9_000)
    expect(fold.state().phase).toBe('hidden')
  })

  it('the partial grows the Listening row, never a row a word; the Endpoint turns it Transcribing with the last words', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onVoice(hearing(1_500), 1_500)
    expect(fold.state().ledger.ear).toBe('hearing')
    fold.onPartial({ text: 'play', at: 2_000 })
    fold.onPartial({ text: 'play jazz', at: 2_400 })
    expect(labels(fold)).toEqual(['Listening: “play jazz…”'])
    expect(fold.state().ledger.partial).toBe('play jazz')
    fold.onVoice(transcribing(3_000), 3_000)
    expect(fold.state().ledger).toMatchObject({ ear: 'transcribing', earSince: 3_000, lastWords: 'play jazz', partial: '' })
    expect(labels(fold)).toEqual(['Listening: “play jazz…”', 'Transcribing: “play jazz”'])
  })

  it('the heard line fills the Heard row and lights the first station; the ear closing after it leaves the card up for the Command', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onPartial({ text: 'play jazz', at: 2_000 })
    fold.onVoice(transcribing(3_000), 3_000)
    fold.onHeard({ text: 'Play jazz', routed: 'command', at: 4_000 })
    fold.onVoice({ ...rest, listening: true, reason: 'wake' }, 4_001)
    fold.onVoice(rest, 4_002)
    expect(fold.state().phase).toBe('listening')
    expect(fold.state().ledger.heard).toBe('Play jazz')
    expect(labels(fold).at(-1)).toBe('Heard: “Play jazz”')
    expect(railStation(fold.state().ledger)).toBe('heard')
  })

  it('a heard line the pipeline ignores closes the card', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onVoice(transcribing(3_000), 3_000)
    fold.onHeard({ text: 'hm', routed: 'ignored', at: 4_000 })
    expect(fold.state().phase).toBe('hidden')
  })

  it("the spoken line's Thinking takes the card live on its turn; a stage's seconds count from its own event", () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onHeard({ text: 'Play jazz', routed: 'command', at: 4_000 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'Play jazz', at: 4_010 })
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't1' })
    expect(fold.state().ledger.stage).toEqual({ stage: 'thinking', startedAt: 4_010, detail: 'Play jazz', hop: 0 })
    expect(fold.state().ledger.startedAt).toBe(1_000)
    expect(labels(fold)).toEqual(['Listening: say a command', 'Heard: “Play jazz”', 'Thinking: '])
    expect(railStation(fold.state().ledger)).toBe('thinking')
  })

  it('a typed line opens the card at its Thinking, the words as a Typed row', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'navigate example.com', at: 4_000 })
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't1' })
    expect(fold.state().ledger.startedAt).toBe(4_000)
    expect(labels(fold)).toEqual(['Typed: “navigate example.com”', 'Thinking: '])
  })

  it("the reading is a Read as row; Acting takes the action's word and object, never the raw line; Loading carries the host", () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'navigate example.com', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'navigate example.com', action: 'navigate https://example.com', task: { id: 't1', hop: 0 }, at: 1_100 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Opening', detail: 'example.com', at: 1_200 })
    expect(fold.state().ledger.stage).toEqual({ stage: 'acting', startedAt: 1_200, word: 'Opening', detail: 'example.com', hop: 0 })
    expect(railStation(fold.state().ledger)).toBe('acting')
    fold.onEvent({ type: 'status', turnId: 't1', status: 'loading', hop: 0, at: 1_900 })
    expect(fold.state().ledger.stage).toEqual({ stage: 'loading', startedAt: 1_900, word: 'Opening', detail: 'example.com', hop: 0 })
    expect(labels(fold).slice(1)).toEqual(['Thinking: ', 'Read as: navigate https://example.com', 'Opening: example.com', 'Loading: example.com'])
    expect(fold.state().ledger.reading).toBe('navigate https://example.com')
    expect(fold.state().ledger.stations).toEqual(['heard', 'thinking', 'acting', 'loading'])
  })

  it("Speaking's row is the sentence; done ends the turn with its outcome and the Answer, the total counted from the turn's start", () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onHeard({ text: 'Read', routed: 'command', at: 2_000 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'Read', at: 2_010 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'Read', action: 'read', task: { id: 't1', hop: 0 }, at: 2_100 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Reading', detail: 'the page', at: 2_200 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'speaking', hop: 0, at: 3_000 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'The lighthouse.', at: 3_001 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'The lighthouse.\n\nThe keeper climbed.', at: 3_002 })
    expect(labels(fold).at(-1)).toBe('Speaking: The lighthouse.')
    expect(fold.state().ledger.said).toEqual({ text: 'The lighthouse.', failure: false })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 5_500 })
    expect(fold.state()).toMatchObject({ phase: 'answer' })
    expect(fold.state().ledger).toMatchObject({ outcome: 'done', doneAt: 5_500, answer: { text: 'The lighthouse.\n\nThe keeper climbed.', failure: false } })
    expect(labels(fold).at(-1)).toBe('Done: ')
    expect(railStation(fold.state().ledger)).toBe('done')
    // A skipped station stays unlit: no Loading in a read.
    expect(fold.state().ledger.stations).toEqual(['heard', 'thinking', 'acting', 'speaking', 'done'])
  })

  it('a failed Command ends Failed, the sentence marked a failure', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'turn it up', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'turn it up', dropped: true, task: { id: 't1', hop: 0 }, at: 1_100 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Nothing is playing.', failure: true, at: 1_200 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'failed', at: 1_300 })
    expect(labels(fold).slice(1)).toEqual(['Thinking: ', 'Read as: no command', 'Speaking: Nothing is playing.', 'Failed: '])
    expect(fold.state().ledger.rows.at(-1)?.tone).toBe('fail')
    expect(fold.state().ledger).toMatchObject({ outcome: 'failed', said: { text: 'Nothing is playing.', failure: true } })
  })

  it("a Stop's end is muted, as in the Feed", () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'stop', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'stop', action: 'stop', at: 1_100 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'Nothing to stop.', muted: true, at: 1_200 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 1_300 })
    expect(fold.state().ledger).toMatchObject({ outcome: 'muted' })
    expect(fold.state().ledger.rows.at(-1)).toMatchObject({ label: 'Done', tone: 'muted' })
  })

  it("an action's word and object ride into its own hop's Loading only; a later hop's Loading starts its own count (#438)", () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 'h0', status: 'thinking', hop: 0, detail: 'open the hub', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 'h0', text: 'open the hub', action: 'navigate hub', task: { id: 'h0', hop: 0 }, at: 1_100 })
    fold.onEvent({ type: 'status', turnId: 'h0', status: 'acting', hop: 0, word: 'Opening', detail: 'hub.example', at: 1_200 })
    fold.onEvent({ type: 'status', turnId: 'h0', status: 'loading', hop: 0, at: 1_900 })
    fold.onEvent({ type: 'status', turnId: 'h1', status: 'loading', hop: 0, at: 2_500 })
    expect(fold.state().ledger.stage).toEqual({ stage: 'loading', startedAt: 1_900, word: 'Opening', detail: 'hub.example', hop: 0 })
    expect(labels(fold).at(-1)).toBe('Loading: hub.example')
    fold.onEvent({ type: 'status', turnId: 'h1', status: 'loading', hop: 1, at: 3_000 })
    expect(fold.state().ledger.stage).toEqual({ stage: 'loading', startedAt: 3_000, hop: 1 })
    expect(labels(fold).at(-1)).toBe('Loading: ')
  })

  it("a later hop's stages ride the same ledger; a new typed line starts a fresh one", () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 'h0', status: 'thinking', hop: 0, detail: 'open the hub and read it', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 'h0', text: 'open the hub and read it', action: 'navigate hub', task: { id: 'h0', hop: 0 }, at: 1_100 })
    fold.onEvent({ type: 'status', turnId: 'h1', status: 'thinking', hop: 1, at: 2_000 })
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'h0' })
    expect(labels(fold).at(-1)).toBe('Thinking: hop 1')
    fold.onEvent({ type: 'status', turnId: 'n0', status: 'thinking', hop: 0, detail: 'scroll down', at: 3_000 })
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 'n0' })
    expect(labels(fold)).toEqual(['Typed: “scroll down”', 'Thinking: '])
    expect(fold.state().ledger.startedAt).toBe(3_000)
  })

  it('speech beginning while the Answer shows restarts the card as a new line; an ear already open through the Answer does not', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onHeard({ text: 'Read', routed: 'command', at: 2_000 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'Read', at: 2_010 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'Read', action: 'read', at: 2_100 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 3_000 })
    fold.onVoice(listening(1_000), 3_100)
    expect(fold.state().phase).toBe('answer')
    fold.onVoice(hearing(3_500), 3_500)
    expect(fold.state()).toMatchObject({ phase: 'listening', runId: null })
    expect(fold.state().ledger).toMatchObject({ startedAt: 3_500, ear: 'hearing', rows: [{ label: 'Listening', text: '…' }] })
  })

  it('an open panel retires the Answer and its ledger; the live ledger survives it', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read', at: 1_000 })
    fold.retireAnswer()
    expect(fold.state().ledger.rows).toHaveLength(2)
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 2_000 })
    fold.retireAnswer()
    expect(fold.state()).toMatchObject({ phase: 'hidden', ledger: EMPTY_LEDGER })
  })

  it('a cancelled run hides the card, ledger and all', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'read', at: 1_100 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'cancelled', at: 2_000 })
    expect(fold.state()).toMatchObject({ phase: 'hidden', ledger: EMPTY_LEDGER })
  })

  it('a line fired on its partial (Early Fire) keeps the live ledger; the ear reading the rest never touches the finished turn, and a Hot Listen open past the Answer is no wake', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onVoice(hearing(1_500), 1_500)
    fold.onPartial({ text: 'read', at: 2_000 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read', at: 2_010 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'read', action: 'read', at: 2_100 })
    expect(fold.state()).toMatchObject({ phase: 'live', runId: 't1' })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 2_500 })
    fold.onVoice(transcribing(3_000), 3_000)
    fold.onHeard({ text: 'read', routed: 'command', at: 4_000 })
    fold.onVoice(listening(4_001), 4_001)
    expect(fold.state()).toMatchObject({ phase: 'answer', runId: 't1' })
    expect(fold.state().ledger).toMatchObject({ ear: 'hearing', outcome: 'done' })
    expect(ledgerFace(fold.state(), 5_000).word).toBe('Done')
    fold.expire(17_500)
    expect(fold.state().phase).toBe('hidden')
    fold.onVoice(listening(4_001), 20_000)
    expect(fold.state().phase).toBe('hidden')
    fold.onVoice(hearing(21_000), 21_000)
    expect(fold.state()).toMatchObject({ phase: 'listening' })
  })

  it('a heard line that lands after the Command began still stands before its rows; a Card’s markdown is said plain', () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onVoice(transcribing(2_000), 2_000)
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read the page', at: 3_000 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'read the page', action: 'read', at: 3_001 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Reading', detail: 'the page', at: 3_002 })
    fold.onHeard({ text: 'read the page', routed: 'command', at: 3_010 })
    expect(labels(fold)).toEqual(['Listening: say a command', 'Transcribing: “”', 'Heard: “read the page”', 'Thinking: ', 'Read as: read', 'Reading: the page'])
    expect(fold.state().ledger.stations).toEqual(['heard', 'thinking', 'acting'])
    fold.onEvent({ type: 'display', turnId: 't1', text: '## story fixture\n\nThe **lighthouse**.', at: 4_000 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 4_100 })
    expect(ledgerFace(fold.state(), 5_000).words.text).toBe('story fixture The lighthouse.')
  })

  it("an open ear that has heard nothing yields the face to a running Command's stage (#472)", () => {
    const fold = createPeekCardFold()
    fold.onVoice(listening(1_000), 1_000)
    fold.onHeard({ text: 'Read', routed: 'command', at: 2_000 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'Read', at: 2_010 })
    fold.onVoice(listening(2_020), 2_020)
    expect(ledgerFace(fold.state(), 3_000)).toMatchObject({ key: 'thinking', word: 'Thinking…' })
  })
})

// The band's face (#475): the stage word in the Capsule's words with its mark, and the words of the moment.
describe('ledgerFace', () => {
  const rest: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }

  it('listening shows the waveform and the partial; transcribing counts from the Endpoint with the last words', () => {
    const fold = createPeekCardFold()
    fold.onVoice({ ...rest, listening: true, reason: 'wake', since: 1_000 }, 1_000)
    expect(ledgerFace(fold.state(), 1_500)).toMatchObject({ key: 'listening', word: 'Listening…', mark: { kind: 'wave' }, words: { text: 'say a command', tone: 'quiet' } })
    fold.onPartial({ text: 'read', at: 2_000 })
    expect(ledgerFace(fold.state(), 2_500).words).toEqual({ text: '“read…”', tone: 'live' })
    fold.onVoice({ ...rest, transcribing: true, since: 3_000 }, 3_000)
    expect(ledgerFace(fold.state(), 5_400)).toMatchObject({ key: 'transcribing', word: 'Transcribing…', mark: { kind: 'seconds', text: '2s' }, words: { text: '“read”' } })
  })

  it("a stage says its word and counts from its own event; Acting's word is the action's, its words the object", () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'navigate example.com', at: 1_000 })
    expect(ledgerFace(fold.state(), 2_200)).toMatchObject({ key: 'thinking', word: 'Thinking…', mark: { kind: 'seconds', text: '1s' }, words: { text: '“navigate example.com”' } })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'navigate example.com', action: 'navigate https://example.com', at: 1_100 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Opening', detail: 'example.com', at: 3_000 })
    expect(ledgerFace(fold.state(), 3_100)).toMatchObject({ key: 'acting', word: 'Opening…', mark: { kind: 'seconds', text: '0s' }, words: { text: 'example.com' } })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'loading', hop: 0, at: 4_000 })
    expect(ledgerFace(fold.state(), 9_000)).toMatchObject({ key: 'loading', word: 'Loading…', mark: { kind: 'seconds', text: '5s' }, words: { text: 'example.com' } })
  })

  it('done says Done or Failed with the total in tenths, the Answer as the words; a row is clocked from the turn', () => {
    const fold = createPeekCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read', at: 1_000 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'read', action: 'read', at: 1_100 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'The lighthouse.', at: 2_000 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'The lighthouse.', at: 2_001 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 3_250 })
    expect(ledgerFace(fold.state(), 9_000)).toMatchObject({ key: 'done', word: 'Done', tone: 'ok', mark: { kind: 'total', text: '2.3s' }, words: { text: 'The lighthouse.', tone: 'live' } })
    expect(rowClock(fold.state().ledger.rows.at(-1)!, fold.state().ledger)).toBe('2.3s')
    const failed = createPeekCardFold()
    failed.onEvent({ type: 'status', turnId: 't2', status: 'thinking', hop: 0, detail: 'turn it up', at: 1_000 })
    failed.onEvent({ type: 'command', turnId: 't2', text: 'turn it up', dropped: true, at: 1_100 })
    failed.onEvent({ type: 'speak', turnId: 't2', text: 'Nothing is playing.', failure: true, at: 1_200 })
    failed.onEvent({ type: 'done', turnId: 't2', outcome: 'failed', at: 1_300 })
    expect(ledgerFace(failed.state(), 9_000)).toMatchObject({ key: 'failed', word: 'Failed', tone: 'fail', words: { text: 'Nothing is playing.', tone: 'fail' } })
  })
})
