import { describe, expect, it } from 'vitest'
import { placeMs, spanBegun, spansOf, stageOpen, wallBefore, type RunRecords } from './timeline'

const A = 10_000
const pane = (t: number, url: string, playing = false) => ({ t, url, title: '', text: '', media: playing ? [{ playing: true, src: 'blob:x', position: 1, volume: 1, loop: false }] : [] })

const records: RunRecords = {
  events: [
    { t: A + 50, event: { type: 'command', turnId: 'turn-1', text: 'play let down', task: { id: 'turn-1', hop: 0 }, at: 0 } },
    { t: A + 100, event: { type: 'status', turnId: 'turn-1', status: 'thinking', at: 0 } },
    { t: A + 900, event: { type: 'status', turnId: 'turn-1', status: 'acting', at: 0 } },
    { t: A + 1200, event: { type: 'status', turnId: 'turn-1', status: 'loading', at: 0 } },
    { t: A + 2600, event: { type: 'done', turnId: 'turn-1', outcome: 'done', at: 0 } },
    { t: A + 2700, event: { type: 'speak', turnId: 'turn-1', text: 'Playing Let Down.', at: 0 } },
    { t: A + 4100, event: { type: 'spoken', turnId: 'turn-1', at: 0 } },
  ],
  pane: [pane(A - 500, 'https://duckduckgo.com/'), pane(A + 1000, 'https://duckduckgo.com/'), pane(A + 1500, 'https://www.youtube.com/watch?v=1'), pane(A + 3200, 'https://www.youtube.com/watch?v=1', true)],
}

describe('the spans a person could see in line 1’s life', () => {
  it('counts every span and moment from line 1’s arrival', () => {
    expect(spansOf(records, A)).toEqual({
      shown: 50,
      changed: 1500,
      loading: [1200, 2600],
      speaking: [2700, 4100],
      'media-not-started': [50, 3200],
    })
  })

  it('places a point inside its span, a moment at the moment, and says when the span never came', () => {
    const spans = spansOf(records, A)
    expect(placeMs({ kind: 'while', span: 'loading', fraction: 0.5 }, spans)).toBe(1900)
    expect(placeMs({ kind: 'after', event: 'changed' }, spans)).toBe(1500)
    expect(placeMs({ kind: 'ms', ms: 2200 }, {})).toBe(2200)
    expect(placeMs({ kind: 'after', event: 'asked' }, spans)).toBe('line 1 never came to a point where the app asked')
  })

  it('a song already playing has not started the new one until the page has another', () => {
    const playing: RunRecords = { events: records.events, pane: [pane(A - 500, 'https://www.youtube.com/watch?v=0', true), pane(A + 800, 'https://www.youtube.com/watch?v=0', true), pane(A + 2000, 'https://www.youtube.com/watch?v=1', true)] }
    expect(spansOf(playing, A)['media-not-started']).toEqual([50, 2000])
  })

  it('a song that never starts was not started for all of line 1’s life, to its last event', () => {
    const unstarted: RunRecords = { ...records, pane: records.pane.map((sample) => ({ ...sample, media: [] })) }
    expect(spansOf(unstarted, A)['media-not-started']).toEqual([50, 4100])
  })

  it('a read still sounding when the run ended spans to its last record (#490)', () => {
    const reading: RunRecords = { events: records.events.slice(0, -1), pane: [...records.pane, pane(A + 90_000, 'https://www.youtube.com/watch?v=1', true)] }
    expect(spansOf(reading, A).speaking).toEqual([2700, 90_000])
  })
})

describe('a span as it begins, before anyone knows when it ends', () => {
  it('begins at its first sign: loading at the stage, speaking at the sentence, the media not started at the words shown', () => {
    const early: RunRecords = { events: records.events.slice(0, 4), pane: records.pane.slice(0, 3) }
    expect(spanBegun(early, A, 'loading')).toBe(1200)
    expect(spanBegun(early, A, 'media-not-started')).toBe(50)
    expect(spanBegun(early, A, 'speaking')).toBeUndefined()
    expect(spanBegun(records, A, 'speaking')).toBe(2700)
  })

  it('the media cannot be not started once it has', () => {
    const started: RunRecords = { events: records.events.slice(0, 1), pane: [pane(A - 500, 'https://duckduckgo.com/'), pane(A + 20, 'https://www.youtube.com/watch?v=1', true)] }
    expect(spanBegun(started, A, 'media-not-started')).toBeUndefined()
  })
})

describe('a wall before line 2 arrived', () => {
  it('is a page the browser classes a Blocker, or one that asks a person to prove they are no bot, seen before line 2', () => {
    const wall = { t: A + 900, url: 'https://accounts.google.com/v3/signin', title: 'Sign in', text: '', media: [] }
    const bot = { t: A + 900, url: 'https://www.youtube.com/watch?v=1', title: 'YouTube', text: 'Sign in to confirm you’re not a bot', media: [] }
    expect(wallBefore([pane(A, 'https://duckduckgo.com/'), wall], A + 2000)).toBe('a login-wall on accounts.google.com')
    expect(wallBefore([bot], A + 2000)).toBe('a challenge on www.youtube.com')
    expect(wallBefore([wall], A + 500)).toBeNull()
  })
})

describe('a stage still open keeps the run from ending', () => {
  // 11-answer-which-one p1 (#491): the Errand asked, `the second` was taken as its answer, and its next step began thinking.
  const errand: RunRecords = {
    events: [
      { t: A - 4031, event: { type: 'status', turnId: 'turn-1', status: 'thinking', at: 0 } },
      { t: A - 4030, event: { type: 'command', turnId: 'turn-1', text: 'errand open the album I am thinking of', task: { id: 'turn-1', hop: 0 }, at: 0 } },
      { t: A - 4028, event: { type: 'status', turnId: 'turn-2', status: 'thinking', at: 0 } },
      { t: A - 2516, event: { type: 'command', turnId: 'turn-2', text: 'Which Radiohead album are you thinking of?', task: { id: 'turn-1', hop: 1 }, at: 0 } },
      { t: A - 2515, event: { type: 'done', turnId: 'turn-2', outcome: 'done', at: 0 } },
      { t: A - 2515, event: { type: 'site_question', text: 'Which Radiohead album are you thinking of?', errand: 'question', at: 0 } },
      { t: A + 1, event: { type: 'command', turnId: 'turn-3', text: 'the second', task: { id: 'turn-3', hop: 0 }, at: 0 } },
      { t: A + 1, event: { type: 'done', turnId: 'turn-3', outcome: 'done', at: 0 } },
      { t: A + 2, event: { type: 'status', turnId: 'turn-4', status: 'thinking', at: 0 } },
    ],
    pane: [],
  }

  it('an Errand step thinking since line 1, with no done, is open', () => {
    expect(stageOpen(errand, A)).toBe(true)
  })

  it('every stage begun since line 1 ended with its done is not', () => {
    const ended: RunRecords = {
      ...errand,
      events: [...errand.events, { t: A + 6000, event: { type: 'status', turnId: 'turn-4', status: 'acting', at: 0 } }, { t: A + 9000, event: { type: 'done', turnId: 'turn-4', outcome: 'done', at: 0 } }],
    }
    expect(stageOpen(ended, A)).toBe(false)
  })

  it('a stage begun before line 1 is the start’s, not the run’s', () => {
    expect(stageOpen({ ...errand, events: errand.events.slice(0, 8) }, A)).toBe(false)
  })

  it('a question asked hands every stage before it to the person: the start’s Errand, waiting on its answer, is not deciding', () => {
    expect(stageOpen({ ...errand, events: errand.events.slice(0, 6) }, 0)).toBe(false)
    expect(stageOpen({ ...errand, events: errand.events.slice(0, 3) }, 0)).toBe(true)
  })

  it('a stage entered after its turn’s done opens it again', () => {
    const again: RunRecords = { ...errand, events: [...errand.events.slice(0, 8), { t: A + 50, event: { type: 'status', turnId: 'turn-3', status: 'loading', at: 0 } }] }
    expect(stageOpen(again, A)).toBe(true)
  })
})
