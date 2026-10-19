import { describe, expect, it } from 'vitest'
import { FakeBrowser } from '../../core/testing/doubles'
import type { MusicAction } from '../../core/music/musicWords'
import { createPlayer } from './player'
import { ScriptedYouTube, videoItem } from './scriptedYouTube'

// The Player (#343, CONTEXT.md): one queue in main, driving the watch
// page's video in the pane over CDP. Tested against a scripted YouTube:
// the results' data, the watch pages, the element.

const RESULTS = 'https://www.youtube.com/results?search_query='
const WATCH = 'https://www.youtube.com/watch?v='

function wired() {
  const browser = new FakeBrowser()
  const youtube = new ScriptedYouTube(browser)
  youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
  youtube.search('song b', videoItem('bbbbbbbbbbb', 'Song B'))
  youtube.search('song c', videoItem('ccccccccccc', 'Song C'))
  youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
  youtube.watches.set('bbbbbbbbbbb', { title: 'Song B' })
  youtube.watches.set('ccccccccccc', { title: 'Song C' })
  const player = createPlayer({ browser, fetchResults: youtube.fetchResults, sleep: async () => {} })
  const always = (): boolean => true
  const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, always)
  return { browser, youtube, player, perform }
}

describe('the Player', () => {
  it('`play <words>` searches, opens the pick and plays it', async () => {
    const { browser, player, perform } = wired()
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.navigations).toEqual([`${RESULTS}song+a`, `${WATCH}aaaaaaaaaaa`])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa' })
    expect(played.failure).toBeUndefined()
    expect(player.queue().current).toEqual({ id: 'aaaaaaaaaaa', title: 'Song A' })
  })

  it('`queue <words>` searches without leaving the song playing, and says where it sits', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await perform({ kind: 'search', place: 'end' }, 'song b')).toMatchObject({ answer: 'Queued “Song B” (1st).', video: 'bbbbbbbbbbb' })
    expect(await perform({ kind: 'search', place: 'end' }, 'song c')).toMatchObject({ answer: 'Queued “Song C” (2nd).' })
    expect(youtube.fetched).toEqual([`${RESULTS}song+b`, `${RESULTS}song+c`])
    expect(browser.navigations).toHaveLength(2)
    expect(player.queue().upNext.map((song) => song.title)).toEqual(['Song B', 'Song C'])
  })

  it('an end while `ad-showing` is set does not advance the queue', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    youtube.adShowing = true
    youtube.endVideo()
    await player.check()
    expect(browser.navigations.at(-1)).toBe(`${WATCH}aaaaaaaaaaa`)
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
  })

  it('an end without it opens the next queued id', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    youtube.endVideo()
    await player.check()
    expect(browser.navigations.at(-1)).toBe(`${WATCH}bbbbbbbbbbb`)
    expect(player.queue().current?.id).toBe('bbbbbbbbbbb')
  })

  it('an end with nothing queued stops: the page stays where the song ended, and nothing more opens', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    await player.check()
    expect(browser.navigations).toHaveLength(2)
    expect(player.queue().current).toBeNull()
  })

  it('a landing that is not a watch page fails the Command, says so, and the Player moves to the next queued song', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song c')
    youtube.watches.set('bbbbbbbbbbb', { title: 'Song B', fails: 'notWatch' })
    const failed = await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(failed).toMatchObject({ failure: true, answer: "“Song B” can't be played." })
    await player.settled()
    expect(browser.navigations.at(-1)).toBe(`${WATCH}ccccccccccc`)
    expect(player.queue().current?.id).toBe('ccccccccccc')
  })

  it('a watch page showing the player\'s error is no landing either', async () => {
    const { youtube, perform } = wired()
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A', fails: 'error' })
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ failure: true })
  })

  it('a search with no plain video fails in words', async () => {
    const { youtube, perform } = wired()
    youtube.search('nothing here', { channelRenderer: {} })
    expect(await perform({ kind: 'search', place: 'now' }, 'nothing here')).toMatchObject({ failure: true, answer: 'No videos found for “nothing here”.' })
  })

  it('a results page with no results data in it (consent, sign-in) fails as that, played or queued', async () => {
    const { perform } = wired()
    expect(await perform({ kind: 'search', place: 'now' }, 'walled')).toMatchObject({ failure: true, answer: "YouTube didn't show its results." })
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await perform({ kind: 'search', place: 'end' }, 'walled')).toMatchObject({ failure: true, answer: "YouTube didn't show its results." })
  })

  it('a `skip` a later Command overtakes leaves the queue as it was', async () => {
    const { browser, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    const opened = browser.navigations.length
    const skipped = await player.perform({ kind: 'skip' }, null, () => browser.navigations.length === opened)
    expect(skipped).toMatchObject({ superseded: true })
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
    expect(player.queue().upNext.map((song) => song.id)).toEqual(['bbbbbbbbbbb'])
  })

  it('drives the element: pause, play, loop, restart, volume, mute', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect((await perform({ kind: 'pause' })).answer).toBe('Paused.')
    expect(youtube.element.paused).toBe(true)
    expect((await perform({ kind: 'loop', on: true })).answer).toBe('Looping “Song A”.')
    expect((await perform({ kind: 'unpause' })).answer).toBe('Playing “Song A”.')
    expect(youtube.element).toMatchObject({ paused: false, loop: true })
    expect(player.queue().loop).toBe(true)
    expect((await perform({ kind: 'restart' })).answer).toBe('Restarted.')
    expect((await perform({ kind: 'volume', to: 40 })).answer).toBe('Volume 40.')
    expect((await perform({ kind: 'louder' })).answer).toBe('Volume 50.')
    expect((await perform({ kind: 'quieter' })).answer).toBe('Volume 40.')
    expect((await perform({ kind: 'mute', on: true })).answer).toBe('Muted.')
    expect((await perform({ kind: 'loop', on: false })).answer).toBe('Loop off.')
    expect(youtube.controls.map((control) => control.op)).toEqual(['pause', 'loop', 'play', 'restart', 'volume', 'nudge', 'nudge', 'mute', 'loop'])
  })

  it('`skip` plays the next queued song, and with none queued pauses and says so', async () => {
    const { browser, youtube, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    expect((await perform({ kind: 'skip' })).answer).toBe('Skipped to “Song B”.')
    expect(browser.navigations.at(-1)).toBe(`${WATCH}bbbbbbbbbbb`)
    expect((await perform({ kind: 'skip' })).answer).toBe('Nothing queued.')
    expect(youtube.element.paused).toBe(true)
    expect((await perform({ kind: 'previous' })).answer).toBe('Back to “Song B”.')
  })

  it('a verb with no video on the page fails in words', async () => {
    const { perform } = wired()
    expect(await perform({ kind: 'pause' })).toMatchObject({ failure: true, answer: 'Nothing is playing.' })
  })

  it('`pauseIfPlaying` pauses a playing video, and leaves a paused one be', async () => {
    const { player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await player.pauseIfPlaying()).toBe(true)
    expect(await player.pauseIfPlaying()).toBe(false)
  })

  it('a search superseded mid-way opens nothing more', async () => {
    const { browser, player } = wired()
    const outcome = await player.perform({ kind: 'search', place: 'now' }, 'song a', () => browser.navigations.length < 1)
    expect(outcome).toMatchObject({ superseded: true })
    expect(browser.navigations).toEqual([`${RESULTS}song+a`])
    expect(player.queue().current).toBeNull()
  })
})

describe('the Player\'s Now Playing (#344)', () => {
  it('is absent with no song, and published from the song and the element once one plays', async () => {
    const { youtube, player, perform } = wired()
    const seen: unknown[] = []
    player.onChange((state) => seen.push(state))
    expect(player.nowPlaying()).toBeNull()
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A', channel: 'Band A' })
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    await perform({ kind: 'search', place: 'end' }, 'song c')
    youtube.element = { ...youtube.element, currentTime: 42, duration: 200 }
    await player.check()
    expect(player.nowPlaying()).toEqual({
      id: 'aaaaaaaaaaa',
      title: 'Song A',
      channel: 'Band A',
      elapsedS: 42,
      durationS: 200,
      paused: false,
      loop: false,
      ended: false,
      queued: ['Song B', 'Song C'],
    })
    expect(seen.at(-1)).toEqual(player.nowPlaying())
    await perform({ kind: 'pause' })
    await perform({ kind: 'loop', on: true })
    expect(player.nowPlaying()).toMatchObject({ paused: true, loop: true })
  })

  it('names the next three queued titles, no more', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    for (const letter of ['d', 'e', 'f', 'g']) {
      youtube.search(`song ${letter}`, videoItem(letter.repeat(11), `Song ${letter.toUpperCase()}`))
      await perform({ kind: 'search', place: 'end' }, `song ${letter}`)
    }
    expect(player.nowPlaying()?.queued).toEqual(['Song D', 'Song E', 'Song F'])
  })

  it('at the end of an empty queue it stays, the song shown ended, and `play` plays it again from the start', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ id: 'aaaaaaaaaaa', title: 'Song A', ended: true })
    expect(await perform({ kind: 'unpause' })).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(youtube.controls.at(-1)).toEqual({ op: 'restart' })
    expect(player.nowPlaying()).toMatchObject({ id: 'aaaaaaaaaaa', ended: false, paused: false })
    expect(browser.navigations).toHaveLength(2)
  })

  it('"show the video" names the ended song too: the watch page is still there', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    expect(await perform({ kind: 'show' })).toMatchObject({ answer: 'Showing “Song A”.' })
  })
})

describe('the Player\'s Ducking (#344)', () => {
  it('ducks the element to 15 % of its volume and restores the volume it had', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'volume', to: 80 })
    await player.duck(true)
    expect(youtube.element.volume).toBe(12)
    // YouTube's own remembered volume is never told the floor.
    expect(youtube.playerVolume).toBe(80)
    await player.duck(true)
    expect(youtube.element.volume).toBe(12)
    await player.duck(false)
    expect(youtube.element.volume).toBe(80)
  })

  it('a `volume` verb while ducked sets the restored volume, not the floor', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'volume', to: 80 })
    await player.duck(true)
    expect((await perform({ kind: 'volume', to: 40 })).answer).toBe('Volume 40.')
    expect(youtube.element.volume).toBe(6)
    expect((await perform({ kind: 'louder' })).answer).toBe('Volume 50.')
    expect(youtube.element.volume).toBe(8)
    await player.duck(false)
    expect(youtube.element.volume).toBe(50)
    expect(youtube.playerVolume).toBe(50)
  })

  it('a song opened while ducked is ducked as it lands, and again at the poll should YouTube raise it', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await player.duck(true)
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.element.volume).toBe(15)
    youtube.element = { ...youtube.element, volume: 100 }
    await player.check()
    expect(youtube.element.volume).toBe(15)
    await player.duck(false)
    expect(youtube.element.volume).toBe(100)
  })

  it('with nothing playing, ducking touches no page', async () => {
    const { browser, player } = wired()
    await player.duck(true)
    await player.duck(false)
    expect(browser.evaluations).toEqual([])
  })
})

describe('YouTube\'s own idle prompt (#344)', () => {
  it('a pause the Player did not make, with "Continue watching?" up, is answered Yes — and the card never shows it paused', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.element = { ...youtube.element, paused: true }
    youtube.continuePrompt = true
    await player.check()
    expect(youtube.continued).toBe(1)
    expect(youtube.element.paused).toBe(false)
    expect(player.queue().paused).toBe(false)
    expect(player.nowPlaying()?.paused).toBe(false)
  })

  it('a pause the Player made is left alone, prompt or not', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'pause' })
    youtube.continuePrompt = true
    await player.check()
    expect(youtube.continued).toBe(0)
    expect(youtube.element.paused).toBe(true)
  })
})
