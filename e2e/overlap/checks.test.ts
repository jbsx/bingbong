import { describe, expect, it } from 'vitest'
import { checkEnd, firstMediaFrom, lineOutcomes, type EndState } from './checks'
import type { RunRecords } from './timeline'

const end: EndState = {
  url: 'https://www.youtube.com/watch?v=1',
  title: 'Radiohead - Let Down - YouTube',
  text: 'Radiohead Let Down 4.2M views',
  media: [{ playing: true, src: 'blob:https://www.youtube.com/1', position: 42, volume: 0.6, loop: true }],
  said: ['Playing Let Down.', 'Stopped.'],
  lines: ['cancelled', 'done'],
}
const neverJudged = async (): Promise<boolean> => {
  throw new Error('no meaning to judge')
}

describe('the end state checked against a case’s expect', () => {
  it('passes when everything a person could see and hear is as expected', async () => {
    const failed = await checkEnd(
      { url: { host: 'youtube.com' }, view: { has: ['let  down'] }, media: { playing: true, has: 'let down', position: [30, 60], volume: 0.6, loop: true }, said: [{ is: 'Playing Let Down.' }], lines: ['cancelled', 'done'] },
      end,
      neverJudged,
    )
    expect(failed).toBeNull()
  })

  it.each([
    [{ url: { host: 'wikipedia.org' } }, 'the page is on www.youtube.com, not wikipedia.org'],
    [{ url: { is: 'https://www.youtube.com/' } }, 'the page is https://www.youtube.com/watch?v=1, not https://www.youtube.com/'],
    [{ view: { has: ['Creep'] } }, '"Creep" is not in view'],
    [{ media: { playing: false } }, 'media is playing'],
    [{ media: { has: 'creep' } }, 'the media is not "creep" (Radiohead - Let Down - YouTube)'],
    [{ media: { position: [0, 10] } }, 'the media is at 42 s, not 0–10 s'],
    [{ media: { volume: [0.8, 1] } }, 'the volume is 0.6, not 0.8–1'],
    [{ media: { loop: false } }, 'the media is on loop'],
    [{ said: [{ is: 'Stopped.' }, { is: 'Playing Let Down.' }] }, 'nothing said was "Playing Let Down." after "Stopped."'],
    [{ lines: ['done', 'done'] }, 'the lines came to cancelled, done, not done, done'],
  ] as const)('names the first failed check in words: %j', async (expected, words) => {
    expect(await checkEnd(expected, end, neverJudged)).toBe(words)
  })

  it('a sentence heard for less than it takes whole was cut (#490)', async () => {
    const read = (ms: number | null): EndState => ({ ...end, speech: [{ text: 'Let Down, Radiohead, six years ago.', ms, wholeMs: 4_000 }] })
    expect(await checkEnd({ speech: 'whole' }, read(4_200), neverJudged)).toBeNull()
    expect(await checkEnd({ speech: 'whole' }, read(1_500), neverJudged)).toBe('"Let Down, Radiohead, six years ago." was cut (1.5 s of 4 s)')
    // Still sounding when the run ended: `spoken` marks a stop's end too, so it was never cut.
    expect(await checkEnd({ speech: 'whole' }, read(null), neverJudged)).toBeNull()
  })

  it('nothing else in the Feed counts a line read as no Command (#490)', async () => {
    const heard: EndState = { ...end, lines: ['done', 'dropped'] }
    expect(await checkEnd({ lines: ['done'] }, heard, neverJudged)).toBeNull()
    expect(await checkEnd({ lines: ['done'], nothingElse: true }, heard, neverJudged)).toBe('the lines came to done, dropped, not done')
  })

  it('talk heard and dropped is no line, unless the case expects a line dropped', async () => {
    expect(await checkEnd({ lines: ['done'] }, { ...end, lines: ['done', 'dropped'] }, neverJudged)).toBeNull()
    expect(await checkEnd({ lines: ['dropped', 'done'] }, { ...end, lines: ['done', 'dropped'] }, neverJudged)).toBe('the lines came to done, dropped, not dropped, done')
  })

  it('a line taken into another is no Command of its own', async () => {
    expect(await checkEnd({ lines: ['done', 'none'] }, { ...end, lines: ['done'] }, neverJudged)).toBeNull()
  })

  it('nothing playing fails a playing expect, and a meaning goes to the judge', async () => {
    expect(await checkEnd({ media: { playing: true } }, { ...end, media: [] }, neverJudged)).toBe('nothing is playing')
    const asked: string[] = []
    const judge = async (means: string, said: readonly string[]) => (asked.push(`${means} | ${said.join(' / ')}`), false)
    expect(await checkEnd({ said: [{ means: 'it stopped the music' }] }, end, judge)).toBe('nothing said meant "it stopped the music"')
    expect(asked).toEqual(['it stopped the music | Playing Let Down. / Stopped.'])
  })

  it('a correction is checked on its shape, never judged: Playing … instead., naming other than the first media (#486)', async () => {
    const shape = { said: [{ startsWith: 'Playing', endsWith: 'instead.', notFirstMedia: true }] } as const
    const corrected = (sentence: string): EndState => ({ ...end, said: [sentence], firstMedia: 'Johnny Cash - Hurt - YouTube' })
    expect(await checkEnd(shape, corrected('Playing “Christina Aguilera - Hurt (Official Video)” instead.'), neverJudged)).toBeNull()
    expect(await checkEnd(shape, corrected('Playing “Johnny Cash - Hurt” instead.'), neverJudged)).toBe(
      'nothing said started "Playing" and ended "instead." and named other than the first media',
    )
    expect(await checkEnd(shape, corrected('Playing “Christina Aguilera - Hurt”.'), neverJudged)).not.toBeNull()
    expect(await checkEnd(shape, corrected('Playing instead.'), neverJudged)).not.toBeNull()
    // In order like an exact sentence: the shape must come after the one before it.
    expect(await checkEnd({ said: [{ is: 'Stopped.' }, { startsWith: 'Playing' }] }, end, neverJudged)).toBe('nothing said started "Playing" after "Stopped."')
  })
})

describe('the first media a person saw opened', () => {
  it('is the first page from line 1 with a media source on it', () => {
    const sample = (t: number, title: string, src: string) => ({ t, url: '', title, text: '', media: src === '' ? [] : [{ playing: false, src, position: 0, volume: 1, loop: false }] })
    const pane = [sample(1, 'Old - YouTube', 'blob:a'), sample(5, '', ''), sample(6, 'Johnny Cash - Hurt - YouTube', 'blob:b'), sample(9, 'Christina Aguilera - Hurt - YouTube', 'blob:c')]
    expect(firstMediaFrom(pane, 2)).toBe('Johnny Cash - Hurt - YouTube')
    expect(firstMediaFrom(pane, 10)).toBeUndefined()
  })
})

describe('what the Feed shows each line came to', () => {
  it('one outcome per Task begun after line 1, its last hop’s ending; a dropped line is dropped', () => {
    const records: RunRecords = {
      pane: [],
      events: [
        { t: 1, event: { type: 'command', turnId: 'setup', text: 'navigate x', at: 0 } },
        { t: 2, event: { type: 'done', turnId: 'setup', outcome: 'done', at: 0 } },
        { t: 10, event: { type: 'command', turnId: 'a', text: 'find it', task: { id: 'a', hop: 0 }, at: 0 } },
        { t: 11, event: { type: 'done', turnId: 'a', outcome: 'done', at: 0 } },
        { t: 12, event: { type: 'command', turnId: 'a2', text: 'find it', task: { id: 'a', hop: 1 }, at: 0 } },
        { t: 13, event: { type: 'command', turnId: 'b', text: 'nope', dropped: true, at: 0 } },
        { t: 14, event: { type: 'done', turnId: 'b', at: 0 } },
        { t: 15, event: { type: 'done', turnId: 'a2', outcome: 'cancelled', at: 0 } },
        { t: 16, event: { type: 'command', turnId: 'c', text: 'stop', at: 0 } },
      ],
    }
    expect(lineOutcomes(records, 10)).toEqual(['cancelled', 'dropped', 'running'])
  })

  it('a later hop of a Task begun before line 1 (the start’s Errand going on) is no line', () => {
    const records: RunRecords = {
      pane: [],
      events: [
        { t: 1, event: { type: 'command', turnId: 'q', text: 'errand open it', task: { id: 'q', hop: 0 }, at: 0 } },
        { t: 10, event: { type: 'command', turnId: 'a', text: 'the second', task: { id: 'a', hop: 0 }, at: 0 } },
        { t: 11, event: { type: 'done', turnId: 'a', outcome: 'done', at: 0 } },
        { t: 12, event: { type: 'command', turnId: 'q3', text: 'play the bends', task: { id: 'q', hop: 2 }, at: 0 } },
      ],
    }
    expect(lineOutcomes(records, 10)).toEqual(['done'])
  })
})
