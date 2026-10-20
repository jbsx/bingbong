import { describe, expect, it } from 'vitest'
import { clockLines, columnBands, columnCards, IDLE_CARD_IDS, sanitizeIdleCards } from './columns'

describe('columnCards', () => {
  it('puts the weather down the left, the AI Usage down the middle and the Calendar, Weight and News down the right', () => {
    expect(columnCards('left', IDLE_CARD_IDS)).toEqual(['weather'])
    expect(columnCards('middle', IDLE_CARD_IDS)).toEqual(['usage'])
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
  it('reads the Voice Prompt, Now Playing, Up Next and the Last Page in that order, each only while it has something', () => {
    expect(clockLines(IDLE_CARD_IDS, { nowPlaying: true, upNext: true, lastPage: true })).toEqual(['voice', 'nowPlaying', 'upNext', 'lastPage'])
    expect(clockLines(IDLE_CARD_IDS, { nowPlaying: false, upNext: false, lastPage: true })).toEqual(['voice', 'lastPage'])
  })

  it('leaves out Now Playing and the Last Page when they are not pinned', () => {
    expect(clockLines(['weather'], { nowPlaying: true, upNext: true, lastPage: true })).toEqual(['voice', 'upNext'])
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
