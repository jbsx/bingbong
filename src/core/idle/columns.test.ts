import { describe, expect, it } from 'vitest'
import { clockLines, columnBands, columnCards, IDLE_CARD_IDS, middleAsks, middleRoom, sanitizeIdleCards, usageLayout } from './columns'

describe('columnCards', () => {
  it('puts the weather down the left, Now Playing over the AI Usage down the middle and the Calendar, Weight and News down the right', () => {
    expect(columnCards('left', IDLE_CARD_IDS)).toEqual(['weather'])
    expect(columnCards('middle', IDLE_CARD_IDS)).toEqual(['music', 'usage'])
    expect(columnCards('right', IDLE_CARD_IDS)).toEqual(['calendar', 'weight', 'news'])
  })

  it('keeps each card in its home whatever order the pins were saved in, and leaves an unpinned one out', () => {
    expect(columnCards('right', ['news', 'weather', 'calendar'])).toEqual(['calendar', 'news'])
  })
})

describe('sanitizeIdleCards', () => {
  it('reads a saved ordered list as the same set: known cards once each, in no order of the owner’s', () => {
    expect(sanitizeIdleCards(['news', 'weather', 'news', 'radio', 7])).toEqual(['weather', 'news'])
    expect(sanitizeIdleCards(['music', 'lastPage'])).toEqual(sanitizeIdleCards(['lastPage', 'music']))
  })

  it('pins every card when nothing was saved', () => {
    expect(sanitizeIdleCards(undefined)).toEqual([...IDLE_CARD_IDS])
  })
})

describe('clockLines', () => {
  it('reads the Voice Prompt, Up Next and the Last Page in that order, each only while it has something', () => {
    expect(clockLines(IDLE_CARD_IDS, { upNext: true, lastPage: true })).toEqual(['voice', 'upNext', 'lastPage'])
    expect(clockLines(IDLE_CARD_IDS, { upNext: false, lastPage: true })).toEqual(['voice', 'lastPage'])
  })

  it('leaves out the Last Page when it is not pinned', () => {
    expect(clockLines(['weather'], { upNext: true, lastPage: true })).toEqual(['voice', 'upNext'])
  })
})

describe('columnBands', () => {
  const calendar = { id: 'calendar', full: 340, small: 340, grows: false }
  const weight = { id: 'weight', full: 420, small: 200, grows: true }
  const news = { id: 'news', full: 240, small: 150, grows: true }
  const shown = (bands: ReturnType<typeof columnBands>): string[] => bands.map((band) => `${band.id} ${band.height} ${band.form}`)

  it('gives each card its full form when the Column holds them all', () => {
    expect(shown(columnBands([calendar, weight, news], 1000))).toEqual(['calendar 340 full', 'weight 420 full', 'news 240 full'])
  })

  it('hands a hidden card’s room to the Column-mates that grow, shared evenly', () => {
    expect(shown(columnBands([calendar, news], 1000))).toEqual(['calendar 340 full', 'news 660 full'])
    expect(shown(columnBands([weight, news], 1000))).toEqual(['weight 590 full', 'news 410 full'])
  })

  it('steps the lowest card down to its smaller form first when the Column runs out of height', () => {
    const busy = { ...calendar, full: 430 }
    expect(shown(columnBands([busy, weight, news], 1000))).toEqual(['calendar 430 full', 'weight 420 full', 'news 150 small'])
    expect(shown(columnBands([{ ...calendar, full: 700 }, weight, news], 1000))).toEqual(['calendar 340 small', 'weight 355 small', 'news 305 small'])
  })

  it('leaves the spare room unused when no card grows', () => {
    expect(shown(columnBands([calendar], 1000))).toEqual(['calendar 340 full'])
  })
})

describe('the middle Column (#365)', () => {
  // The owner's two providers, Claude with two more windows: their rings at F2's 228 px with the words under them, or at
  // the 184 px three providers take.
  const usage = { rings: { large: 362, compact: 318 } }
  const shown = (bands: ReturnType<typeof columnBands>): string[] => bands.map((band) => `${band.id} ${band.height} ${band.form}`)

  it('with no song, the AI Usage takes the Column under the clock and its lines in full, its rings at their size over the chart', () => {
    const bands = columnBands(middleAsks(IDLE_CARD_IDS, { music: false, usage }), middleRoom({ timer: false, lines: 2 }))
    expect(shown(bands)).toEqual(['usage 663 full'])
    expect(usageLayout(bands[0].height, usage.rings)).toEqual({ form: 'full', compact: false })
  })

  it('with a song alone, Now Playing takes its full card over the rings, the chart given up and the rings drawn smaller', () => {
    const bands = columnBands(middleAsks(IDLE_CARD_IDS, { music: true, usage }), middleRoom({ timer: false, lines: 2 }))
    expect(shown(bands)).toEqual(['music 280 full', 'usage 383 small'])
    expect(usageLayout(bands[1].height, usage.rings)).toEqual({ form: 'small', compact: true })
  })

  it('with a song under a Timer, Up Next and the Last Page, the card steps down and the spare goes back to a short chart', () => {
    const bands = columnBands(middleAsks(IDLE_CARD_IDS, { music: true, usage }), middleRoom({ timer: true, lines: 3 }))
    expect(shown(bands)).toEqual(['music 120 small', 'usage 530 small'])
    expect(usageLayout(bands[1].height, usage.rings)).toEqual({ form: 'full', compact: true })
  })

  it('keeps the rings at their size, chart or not, while the band holds them', () => {
    expect(usageLayout(560, usage.rings)).toEqual({ form: 'full', compact: false })
    expect(usageLayout(425, usage.rings)).toEqual({ form: 'small', compact: false })
    expect(usageLayout(424, usage.rings)).toEqual({ form: 'small', compact: true })
  })

  it('leaves out Now Playing when it is not pinned, and asks a note’s height for an unreachable dashboard', () => {
    expect(middleAsks(['usage'], { music: true, usage }).map((ask) => ask.id)).toEqual(['usage'])
    expect(middleAsks(IDLE_CARD_IDS, { music: true, usage: 'note' })).toEqual([
      { id: 'music', full: 280, small: 120, grows: false },
      { id: 'usage', full: 140, small: 140, grows: false },
    ])
    expect(middleAsks(IDLE_CARD_IDS, { music: false, usage: null })).toEqual([])
  })
})
