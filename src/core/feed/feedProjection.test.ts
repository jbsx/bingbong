import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createFeedProjection, feedRoleForKind, MAX_DETAIL_ENTRIES } from './feedProjection'

// The feed projection (#44): pipeline events in, ordered feed entries out.
// Conversation structure (#54) and run grouping (#55) are pinned here; the
// renderer only folds what this produces.

function run(turnId: string, text: string, at: number): PipelineEvent[] {
  return [
    { type: 'command', turnId, text, at },
    { type: 'status', turnId, status: 'acting', at: at + 1 },
    { type: 'tool_call', turnId, callId: `${turnId}-1`, name: 'navigate', args: { url: 'https://x.test' }, at: at + 2 },
    { type: 'tool_result', turnId, callId: `${turnId}-1`, name: 'navigate', ok: true, result: 'navigated', at: at + 3 },
    { type: 'display', turnId, text: 'Here it is.', at: at + 4 },
    { type: 'done', turnId, outcome: 'done', at: at + 5 },
  ]
}

function project(events: PipelineEvent[]) {
  const projection = createFeedProjection()
  for (const event of events) projection.onEvent(event)
  return projection
}

describe('a Task is one Feed Entry (#336)', () => {
  const WORDS = 'open elon musks latest tweet'
  /** One hop of the Task: its words, its action and its tool line; `answer` its Answer, `failure` marking it a wall's line. */
  function hop(n: number, action: string, answer: string, at: number, failure = false): PipelineEvent[] {
    const turnId = `h${n}`
    return [
      { type: 'command', turnId, text: WORDS, action, task: { id: 'h0', hop: n }, at },
      { type: 'status', turnId, status: 'acting', at: at + 1 },
      { type: 'tool_call', turnId, callId: `${turnId}-1`, name: 'click', args: { ref: n }, at: at + 2 },
      { type: 'tool_result', turnId, callId: `${turnId}-1`, name: 'click', ok: true, result: 'clicked', at: at + 3 },
      { type: 'display', turnId, text: answer, ...(failure ? { failure: true } : {}), at: at + 4 },
      { type: 'done', turnId, outcome: 'done', at: at + 5 },
    ]
  }
  function closing(n: number, action: string, outcome: 'done' | 'cancelled', at: number): PipelineEvent[] {
    return [
      { type: 'command', turnId: `h${n}`, text: WORDS, action, dropped: true, task: { id: 'h0', hop: n }, at },
      { type: 'done', turnId: `h${n}`, outcome, at: at + 1 },
    ]
  }
  const FIVE_HOPS = [
    ...hop(0, 'open x.com/elonmusk', 'Opened X.', 100),
    ...hop(1, 'click [1] "Posts"', 'Clicked “Posts”.', 200),
    ...hop(2, 'click [21] "Pinned"', 'Clicked “Pinned”.', 300),
    ...hop(3, 'scroll down', 'Scrolled down.', 400),
    ...hop(4, 'click [22] "Latest"', 'Clicked “Latest”.', 500),
  ]
  const conversation = (projection: ReturnType<typeof project>) => projection.entries().filter((entry) => entry.runId === undefined)

  it('a five-hop Task is one entry: its words once, a line for each fired hop, every tool line in one Run Detail, one Answer', () => {
    for (const close of ['done', 'no next step', 'not read']) {
      const projection = project([...FIVE_HOPS, ...closing(5, close, 'done', 600)])
      expect(conversation(projection).map((entry) => [entry.kind, entry.text, entry.action, entry.hopLines])).toEqual([
        ['command', WORDS, 'open x.com/elonmusk', [{ text: 'click [1] "Posts"' }, { text: 'click [21] "Pinned"' }, { text: 'scroll down' }, { text: 'click [22] "Latest"' }]],
        ['display', 'Clicked “Latest”.', undefined, undefined],
      ])
      const runs = new Set(projection.entries().flatMap((entry) => (entry.runId === undefined ? [] : [entry.runId])))
      expect(runs).toEqual(new Set(['h0']))
      expect(projection.entries().filter((entry) => entry.kind === 'tool')).toHaveLength(5)
      expect(projection.liveRunId()).toBeNull()
    }
  })

  it('the Task\'s Run Detail is live while any of its hops runs', () => {
    const projection = project([...hop(0, 'open x.com/elonmusk', 'Opened X.', 100), ...hop(1, 'click [1] "Posts"', 'Clicked “Posts”.', 200).slice(0, 3)])
    expect(projection.liveRunId()).toBe('h0')
  })

  it('an abandoned closing hop shows greyed as the entry\'s last line', () => {
    const projection = project([...FIVE_HOPS.slice(0, 12), ...closing(2, 'abandoned: stopped', 'cancelled', 300)])
    expect(conversation(projection)[0]!.hopLines).toEqual([{ text: 'click [1] "Posts"' }, { text: 'abandoned: stopped', muted: true }])
  })

  it('a hop that hit a wall is the last line, in the failure colour, and its failure line is the one Answer', () => {
    const projection = project([...FIVE_HOPS.slice(0, 12), ...hop(2, 'click [5] "Show more"', 'Something on the page is in the way.', 300, true)])
    expect(conversation(projection).map((entry) => [entry.kind, entry.text, entry.hopLines, entry.failure])).toEqual([
      ['command', WORDS, [{ text: 'click [1] "Posts"' }, { text: 'click [5] "Show more"', failure: true }], undefined],
      ['display', 'Something on the page is in the way.', undefined, true],
    ])
  })

  it('a one-hop Command looks exactly as it did', () => {
    const projection = project([...hop(0, 'open x.com/elonmusk', 'Opened X.', 100)])
    expect(conversation(projection)[0]).not.toHaveProperty('hopLines')
    expect(conversation(projection).map((entry) => entry.text)).toEqual([WORDS, 'Opened X.'])
  })
})

describe('feed projection', () => {
  it('keeps the event order and renders one line per visible event', () => {
    const feed = project(run('t1', 'open x', 1_000)).entries()
    expect(feed.map((entry) => [entry.kind, entry.text])).toEqual([
      ['command', 'open x'],
      ['stage', 'Working on the page'],
      ['tool', '→ https://x.test'],
      ['display', 'Here it is.'],
    ])
  })

  it('files a Command abandoned while it was read where it was given, before the Command that came after it (#330)', () => {
    const projection = project([
      ...run('t1', 'navigate slow', 1_000).slice(0, 3),
      { type: 'status', turnId: 't1', status: 'cancelled', at: 1_200 },
      // `read` is still running: its done has not come.
      ...run('t3', 'read', 1_300).slice(0, 5),
      // Given at 1 100, before `read`; its reading ended only after `read` had run.
      { type: 'command', turnId: 't2', text: 'click 999', action: 'abandoned: a later Command came first', dropped: true, at: 1_100 },
      { type: 'done', turnId: 't2', outcome: 'cancelled', at: 9_000 },
    ])
    const commands = projection.entries().filter((entry) => entry.kind === 'command')
    expect(commands.map((entry) => [entry.text, entry.action, entry.muted ?? false])).toEqual([
      ['navigate slow', undefined, false],
      ['click 999', 'abandoned: a later Command came first', true],
      ['read', undefined, false],
    ])
    // Its words sit right before the later Command's, and the later run's lines stay with it.
    const kinds = projection.entries().map((entry) => entry.text)
    expect(kinds.indexOf('click 999')).toBe(kinds.indexOf('read') - 1)
    // A filed-back entry opens no run of its own: the live run stays the later Command's.
    expect(projection.liveRunId()).toBe('t3')
  })

  it('stamps entries with the event time and unique rising ids', () => {
    const feed = project(run('t1', 'open x', 1_000)).entries()
    expect(feed.map((entry) => entry.at)).toEqual([1_000, 1_001, 1_002, 1_004])
    const ids = feed.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
  })

  it('shows a failure once, as the Answer: a failed tool result renders nothing of its own (#333)', () => {
    const feed = project([
      { type: 'command', turnId: 't1', text: 'click 3', at: 1 },
      { type: 'tool_call', turnId: 't1', callId: 'c1', name: 'click', args: { ref: 3 }, at: 2 },
      { type: 'tool_result', turnId: 't1', callId: 'c1', name: 'click', ok: false, error: 'ref 3 refused: it no longer names the element you were shown. Continue from the page below', at: 3 },
      { type: 'display', turnId: 't1', text: "There's no item 3 on this page.", failure: true, at: 4 },
      { type: 'speak', turnId: 't1', text: "There's no item 3 on this page.", failure: true, at: 5 },
    ]).entries()
    expect(feed.map((entry) => [entry.kind, entry.text, entry.runId, entry.failure])).toEqual([
      ['command', 'click 3', undefined, undefined],
      ['tool', 'click [3]', 't1', undefined],
      ['display', "There's no item 3 on this page.", undefined, true],
    ])
  })

  it('names a run’s steps in plain words, never the internal stage names (#333)', () => {
    const feed = project([
      { type: 'command', turnId: 't1', text: 'read', at: 1 },
      { type: 'status', turnId: 't1', status: 'thinking', at: 2 },
      { type: 'status', turnId: 't1', status: 'acting', at: 3 },
      { type: 'status', turnId: 't1', status: 'speaking', at: 4 },
      { type: 'status', turnId: 't1', status: 'cancelled', at: 5 },
    ]).entries()
    expect(feed.filter((entry) => entry.kind === 'stage').map((entry) => entry.text)).toEqual(['Understanding', 'Working on the page', 'Reading aloud', 'Stopped'])
  })

  it('stamps every entry with the turn it came from, conversation lines included, and marks a failure line (#329)', () => {
    const feed = project([
      { type: 'command', turnId: 't1', text: 'read', at: 1 },
      { type: 'speak', turnId: 't1', text: "This page can't be read right now.", failure: true, at: 3 },
      { type: 'done', turnId: 't1', outcome: 'failed', at: 4 },
      { type: 'command', turnId: 't2', text: 'screenshot', at: 5 },
      { type: 'display', turnId: 't2', text: 'screenshot saved: /shots/1.jpg', at: 6 },
      { type: 'speak', text: 'Your download finished.', at: 7 },
    ]).entries()
    expect(feed.map((entry) => [entry.kind, entry.turnId, entry.failure])).toEqual([
      ['command', 't1', undefined],
      ['speak', 't1', true],
      ['command', 't2', undefined],
      ['display', 't2', undefined],
      ['speak', undefined, undefined],
    ])
  })

  it("a Stop's Answer is muted — a cancelled Command reads grey, neither done nor failed", () => {
    const feed = project([
      { type: 'command', turnId: 't1', text: 'stop', action: 'stop', at: 1 },
      { type: 'display', turnId: 't1', text: 'Stopped.', muted: true, at: 2 },
      { type: 'done', turnId: 't1', outcome: 'done', at: 3 },
    ]).entries()
    expect(feed.filter((entry) => entry.kind === 'display').map((entry) => [entry.text, entry.muted, entry.failure])).toEqual([['Stopped.', true, undefined]])
  })

  it('a Command entry carries the action taken, and a dropped Utterance is muted (#324)', () => {
    const feed = project([
      { type: 'command', turnId: 't1', text: 'click sign in', action: 'click [2] "Sign in"', at: 1 },
      { type: 'done', turnId: 't1', outcome: 'done', at: 2 },
      { type: 'command', turnId: 't2', text: 'um never mind', dropped: true, at: 3 },
      { type: 'done', turnId: 't2', outcome: 'done', at: 4 },
    ]).entries()
    expect(feed.map((entry) => [entry.kind, entry.text, entry.action, entry.muted])).toEqual([
      ['command', 'click sign in', 'click [2] "Sign in"', undefined],
      ['command', 'um never mind', undefined, true],
    ])
  })

  it('voice-half lines (heard words, mic errors) ride the feed as outcome entries', () => {
    const projection = createFeedProjection()
    projection.append({ kind: 'voice', text: 'heard "stop" (stopping)', at: 5 })
    projection.append({ kind: 'error', text: 'voice: mic gone', at: 6 })
    expect(projection.entries().map((entry) => [entry.kind, entry.role, entry.detail])).toEqual([
      ['voice', 'user', false],
      ['error', 'system', false],
    ])
  })

  describe('detail trim', () => {
    it('keeps stage lines ephemeral — trimmed beyond the cap, oldest first — and never trims outcome entries', () => {
      const projection = createFeedProjection()
      projection.onEvent({ type: 'command', turnId: 't1', text: 'go', at: 0 })
      for (let i = 0; i < MAX_DETAIL_ENTRIES + 10; i += 1) {
        projection.onEvent({ type: 'status', turnId: 't1', status: i % 2 === 0 ? 'thinking' : 'acting', at: i + 1 })
      }
      const feed = projection.entries()
      const detail = feed.filter((entry) => entry.detail)
      expect(detail).toHaveLength(MAX_DETAIL_ENTRIES)
      expect(detail[0]!.at).toBe(11)
      expect(feed[0]).toMatchObject({ kind: 'command', text: 'go' })
    })
  })

  describe('conversation structure (#54)', () => {
    it('assigns roles: your words are user lines, answers are assistant lines, the rest is system', () => {
      expect(feedRoleForKind('command')).toBe('user')
      expect(feedRoleForKind('voice')).toBe('user')
      expect(feedRoleForKind('display')).toBe('assistant')
      expect(feedRoleForKind('speak')).toBe('assistant')
      expect(feedRoleForKind('tool')).toBe('system')
      expect(feedRoleForKind('error')).toBe('system')
      expect(feedRoleForKind('stage')).toBe('system')
    })

    it("suppresses a turn's spoken line once its Card renders, whichever lands first", () => {
      const displayFirst = project([
        { type: 'display', turnId: 't1', text: 'Card', at: 1 },
        { type: 'speak', turnId: 't1', text: 'Spoken', at: 2 },
      ]).entries()
      expect(displayFirst.map((entry) => entry.kind)).toEqual(['display'])

      const speakFirst = project([
        { type: 'speak', turnId: 't1', text: 'Spoken', at: 1 },
        { type: 'display', turnId: 't1', text: 'Card', at: 2 },
      ]).entries()
      expect(speakFirst.map((entry) => entry.kind)).toEqual(['display'])
    })

    it('renders a spoken line when its turn has no Card, and never suppresses an unstamped announcement', () => {
      const feed = project([
        { type: 'speak', turnId: 't1', text: 'Just spoken', at: 1 },
        { type: 'display', turnId: 't2', text: 'Another turn', at: 2 },
        { type: 'speak', text: 'Download finished', at: 3 },
      ]).entries()
      expect(feed.map((entry) => entry.text)).toEqual(['Just spoken', 'Another turn', 'Download finished'])
    })
  })

  describe('run grouping (#55)', () => {
    it('stamps run noise with its run id and leaves conversation lines unstamped', () => {
      const feed = project(run('t1', 'open x', 1_000)).entries()
      expect(feed.map((entry) => [entry.kind, entry.runId])).toEqual([
        ['command', undefined],
        ['stage', 't1'],
        ['tool', 't1'],
        ['display', undefined],
      ])
    })

    it('tracks the live run from its command to its done', () => {
      const projection = createFeedProjection()
      const events = run('t1', 'open x', 1_000)
      projection.onEvent(events[0]!)
      expect(projection.liveRunId()).toBe('t1')
      for (const event of events.slice(1, -1)) projection.onEvent(event)
      expect(projection.liveRunId()).toBe('t1')
      projection.onEvent(events.at(-1)!)
      expect(projection.liveRunId()).toBeNull()
    })

    it("a straggler done from another turn never closes the live run", () => {
      const projection = createFeedProjection()
      projection.onEvent({ type: 'command', turnId: 't2', text: 'next', at: 1 })
      projection.onEvent({ type: 'done', turnId: 't1', at: 2 })
      expect(projection.liveRunId()).toBe('t2')
    })
  })

  it('clear drops every entry and the live run', () => {
    const projection = project(run('t1', 'open x', 1_000).slice(0, -1))
    projection.clear()
    expect(projection.entries()).toEqual([])
    expect(projection.liveRunId()).toBeNull()
  })
})
