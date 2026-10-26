import { afterEach, describe, expect, it } from 'vitest'
import { WithheldResourceError } from '../../core/browser/unsettledAction'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { FakeBrowser } from '../../core/testing/doubles'
import type { MusicAction } from '../../core/music/musicWords'
import { EMPTY_REMEMBERED_SONGS, forgetVideo, forgetWords, recallSong, rememberSong } from '../../core/music/rememberedSongs'
import { loudnessFactor } from '../../core/music/loudness'
import { createPlayer, type SongMemory } from './player'
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
  const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => {} })
  const always = (): boolean => true
  const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, always)
  return { browser, youtube, player, perform }
}

describe('the Player', () => {
  it('`play <words>` fetches the results, opens the pick and plays it: the pane draws no results page', async () => {
    const { browser, youtube, player, perform } = wired()
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(youtube.fetched).toEqual([`${RESULTS}song+a`])
    expect(browser.navigations).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa' })
    expect(played.failure).toBeUndefined()
    expect(player.queue().current).toEqual({ id: 'aaaaaaaaaaa', title: 'Song A' })
  })

  it('opens the watch page with a land: no page read, the Player reads the landing itself', async () => {
    const { browser, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
  })

  it('a land off the watch page (a consent wall) is navigated again in full, once, before the song fails', async () => {
    const { browser, youtube, perform } = wired()
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A', fails: 'notWatch' })
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ failure: true })
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(browser.navigations.filter((url) => url === `${WATCH}aaaaaaaaaaa`)).toHaveLength(2)
  })

  it('a watch page showing the player\'s error is not navigated again', async () => {
    const { browser, youtube, perform } = wired()
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A', fails: 'error' })
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.navigations.filter((url) => url === `${WATCH}aaaaaaaaaaa`)).toHaveLength(1)
  })

  it('a fetch with no results data (a consent wall) reads the results page in the pane instead', async () => {
    const { browser, youtube, player, perform } = wired()
    youtube.fetchResults = async () => '<html>Before you continue to YouTube</html>'
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa' })
    expect(browser.navigations).toEqual([`${RESULTS}song+a`, `${WATCH}aaaaaaaaaaa`])
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
  })

  it('a fetch that fails reads the results page in the pane instead', async () => {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    const player = createPlayer({ browser, fetchResults: async () => Promise.reject(new Error('net::ERR_BLOCKED_BY_CLIENT')), sleep: async () => {} })
    expect(await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)).toMatchObject({ video: 'aaaaaaaaaaa' })
    expect(browser.navigations[0]).toBe(`${RESULTS}song+a`)
  })

  it('a results page whose cards are not drawn yet (an empty landing) is no wall: its data decides', async () => {
    const { browser, youtube, player, perform } = wired()
    youtube.fetchResults = async () => '<html>no data</html>'
    const navigate = browser.navigate.bind(browser)
    browser.navigate = async (url) => `${await navigate(url)}\n#  — ${url}\nviewport 985x575 scroll 0/575\nsignature 2347a05e\n[1] button "Guide"`
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa' })
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
  })

  it('`queue <words>` searches without leaving the song playing, and says where it sits', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await perform({ kind: 'search', place: 'end' }, 'song b')).toMatchObject({ answer: 'Queued “Song B” (1st).', video: 'bbbbbbbbbbb' })
    expect(await perform({ kind: 'search', place: 'end' }, 'song c')).toMatchObject({ answer: 'Queued “Song C” (2nd).' })
    expect(youtube.fetched).toEqual([`${RESULTS}song+a`, `${RESULTS}song+b`, `${RESULTS}song+c`])
    expect(browser.navigations).toHaveLength(1)
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
    expect(browser.navigations).toHaveLength(1)
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

  it('`skip` plays the next queued song, and with none queued does nothing and says so: the song plays on (2026-10-21 audit)', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    expect((await perform({ kind: 'skip' })).answer).toBe('Skipped to “Song B”.')
    expect(browser.navigations.at(-1)).toBe(`${WATCH}bbbbbbbbbbb`)
    const controls = youtube.controls.length
    const navigations = browser.navigations.length
    expect(await perform({ kind: 'skip' })).toEqual({ result: 'queue empty', answer: 'Nothing queued.' })
    // Nothing touched: no pause, no navigation, the song still the Queue's current and not shown ended.
    expect(youtube.controls.length).toBe(controls)
    expect(browser.navigations.length).toBe(navigations)
    expect(youtube.element.paused).toBe(false)
    expect(player.queue().current?.id).toBe('bbbbbbbbbbb')
    expect(player.nowPlaying()?.ended).toBe(false)
    expect((await perform({ kind: 'previous' })).answer).toBe('Back to “Song A”.')
  })

  it('a verb with no video on the page fails in words', async () => {
    const { perform } = wired()
    expect(await perform({ kind: 'pause' })).toMatchObject({ failure: true, answer: 'Nothing is playing.' })
  })

  it('`pauseAll` pauses a playing video, and leaves a paused one be', async () => {
    const { player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await player.pauseAll()).toBe(true)
    expect(await player.pauseAll()).toBe(false)
  })

  it('`pauseAll` pauses what plays in every frame too (#377): an embed playing alone is a pause, and the Queue is left as it was', async () => {
    const { browser, player } = wired()
    let playing = 1
    browser.frameEvaluator = (expression) => {
      if (!expression.includes('/* FRAME_PAUSE_ALL */')) return []
      const paused = playing
      playing = 0
      return [paused, 0]
    }
    expect(await player.pauseAll()).toBe(true)
    expect(await player.pauseAll()).toBe(false)
    expect(player.queue().current).toBeNull()
  })

  it('a search superseded mid-way opens nothing more', async () => {
    const { browser, youtube, player } = wired()
    const outcome = await player.perform({ kind: 'search', place: 'now' }, 'song a', () => youtube.fetched.length < 1)
    expect(outcome).toMatchObject({ superseded: true })
    expect(browser.navigations).toEqual([])
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
      muted: false,
      ended: false,
      queued: ['Song B', 'Song C'],
    })
    expect(seen.at(-1)).toEqual(player.nowPlaying())
    await perform({ kind: 'pause' })
    await perform({ kind: 'loop', on: true })
    expect(player.nowPlaying()).toMatchObject({ paused: true, loop: true })
  })

  it('says the element muted while it is (#365): by the verb, and by the poll when YouTube mutes it itself', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    const seen: unknown[] = []
    player.onChange((state) => seen.push(state))
    await perform({ kind: 'mute', on: true })
    expect(player.nowPlaying()?.muted).toBe(true)
    expect(seen.at(-1)).toMatchObject({ muted: true })
    await perform({ kind: 'mute', on: false })
    expect(player.nowPlaying()?.muted).toBe(false)
    youtube.element = { ...youtube.element, muted: true }
    await player.check()
    expect(player.nowPlaying()?.muted).toBe(true)
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
    expect(browser.navigations).toHaveLength(1)
  })

  it('"show the video" names the ended song too: the watch page is still there', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    expect(await perform({ kind: 'show' })).toMatchObject({ answer: 'Showing “Song A”.' })
  })

  it('"show the video" with no song held names the video on the page — one the Player never started (#362)', async () => {
    const { browser, youtube, perform } = wired()
    await browser.navigate(`${WATCH}bbbbbbbbbbb`)
    expect(await perform({ kind: 'show' })).toMatchObject({ result: 'showing: the page\'s video', answer: 'Showing “Song B”.' })
    expect(youtube.controls).toEqual([{ op: 'read' }])
    await browser.navigate('https://example.com/')
    expect(await perform({ kind: 'show' })).toMatchObject({ answer: 'Nothing is playing.', failure: true })
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

describe('the level heard carries into the next song (#460)', () => {
  /** JTRDwh0BHG4 and kX_QK6T5_4E: two loud tracks, the issue's probe. */
  function loud() {
    const w = wired()
    w.youtube.loudness.set('aaaaaaaaaaa', 5.22)
    w.youtube.loudness.set('bbbbbbbbbbb', 5.25)
    return w
  }

  const AF = loudnessFactor(5.22)
  const BF = loudnessFactor(5.25)

  /** A `volume` Media Op (ADR 0080, #408): the element alone, YouTube's player never told. */
  const mediaOp = (youtube: ScriptedYouTube, to: number): void => {
    youtube.element = { ...youtube.element, volume: to }
  }

  it('a Media Op\'s 20 then `skip` leaves the next song at 20 × its factor ÷ the last one\'s, about 19.9', async () => {
    const { youtube, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(youtube.element.volume).toBeCloseTo(100 * AF, 1)
    await perform({ kind: 'search', place: 'end' }, 'song b')
    mediaOp(youtube, 20)
    await perform({ kind: 'skip' })
    expect(youtube.element.volume).toBeCloseTo(19.93, 1)
    // YouTube's own remembered level is not what carried it.
    expect(youtube.playerVolume).toBe(100)
  })

  it('the queue moving on at a song\'s end carries it the same', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    mediaOp(youtube, 20)
    youtube.endVideo()
    await player.check()
    expect(player.queue().current?.id).toBe('bbbbbbbbbbb')
    expect(youtube.element.volume).toBeCloseTo(19.93, 1)
  })

  it('a level YouTube set itself (its own slider) is the level YouTube would give the next song', async () => {
    const { youtube, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.playerVolume = 50
    youtube.element = { ...youtube.element, volume: 50 * AF }
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.element.volume).toBeCloseTo(50 * BF, 1)
  })

  it('with no loudness in either response the level carries as it is', async () => {
    const { youtube, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 20)
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.element.volume).toBe(20)
  })

  it('a quiet track is never turned up past the level on YouTube\'s scale', async () => {
    const { youtube, perform } = loud()
    youtube.loudness.set('ccccccccccc', -11.56)
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 20)
    await perform({ kind: 'search', place: 'now' }, 'song c')
    expect(youtube.element.volume).toBeCloseTo(36.48, 1)
  })

  it('a song that opens on an ad takes the level once the song itself plays, and again at the poll should YouTube reset it', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 20)
    await player.check()
    // The next page opens on an ad (the scripted page shows it from the leaving read on, so the poll's read is the one carried).
    youtube.adShowing = true
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.element.volume).toBeCloseTo(100 * BF, 1)
    youtube.adShowing = false
    youtube.element = { ...youtube.element, volume: 100 * BF }
    await player.check()
    expect(youtube.element.volume).toBeCloseTo(19.93, 1)
    // YouTube puts its own level back as the song starts: the poll puts the matched one back over it.
    youtube.element = { ...youtube.element, volume: 100 * BF, currentTime: 0.5 }
    await player.check()
    expect(youtube.element.volume).toBeCloseTo(19.93, 1)
    // Heard playing at it, the song is the person's again: a level set now stands.
    youtube.element = { ...youtube.element, currentTime: 2 }
    await player.check()
    mediaOp(youtube, 70)
    await player.check()
    expect(youtube.element.volume).toBe(70)
  })

  it('a song opened while ducked gets the floor of the matched level, and the duck lets go to it', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 40)
    await player.check()
    await player.duck(true)
    expect(youtube.element.volume).toBe(6)
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.element.volume).toBeCloseTo(40 * (BF / AF) * 0.15, 1)
    await player.duck(false)
    expect(youtube.element.volume).toBeCloseTo(39.86, 1)
  })

  it('a Media Op as the song opens stands: the poll puts the carried level back over YouTube\'s own alone', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 20)
    await perform({ kind: 'search', place: 'now' }, 'song b')
    mediaOp(youtube, 50)
    await player.check()
    expect(youtube.element.volume).toBe(50)
  })

  it('a `volume` verb as the song opens stands, though YouTube plays it at its own level', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 20)
    await perform({ kind: 'search', place: 'now' }, 'song b')
    await perform({ kind: 'volume', to: 30 })
    // YouTube's setVolume plays the element at its level × the track's factor (measured 2026-10-26).
    youtube.element = { ...youtube.element, volume: 30 * BF }
    await player.check()
    expect(youtube.element.volume).toBeCloseTo(30 * BF, 1)
  })

  it('a `skip` as the song opens carries the level set on it, not the one it was carrying', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    await perform({ kind: 'search', place: 'end' }, 'song c')
    mediaOp(youtube, 20)
    await perform({ kind: 'skip' })
    mediaOp(youtube, 50)
    await perform({ kind: 'skip' })
    expect(player.queue().current?.id).toBe('ccccccccccc')
    expect(youtube.element.volume).toBeCloseTo(50 / BF, 1)
  })
})

describe('a browser custody withholds (#433)', () => {
  afterEach(() => setFaultSink(null))

  /** The Player over a custody that refuses every call until `settle()`, then lets the page through. */
  function custodyWired() {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    let refusing = false
    let asked = 0
    let settle = (): void => {}
    let settledEdge: Promise<void> = Promise.resolve()
    const guarded = {
      navigate: browser.navigate.bind(browser),
      land: browser.land.bind(browser),
      evaluateInFrames: browser.evaluateInFrames.bind(browser),
      evaluate: <T>(expression: string): Promise<T> => {
        asked += 1
        return refusing ? Promise.reject(new WithheldResourceError('evaluate')) : browser.evaluate<T>(expression)
      },
    }
    const custody = { settled: () => settledEdge }
    const player = createPlayer({ browser: guarded, custody, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => {} })
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    return {
      browser,
      player,
      faults,
      asked: () => asked,
      withhold() {
        refusing = true
        settledEdge = new Promise<void>((resolve) => {
          settle = () => {
            refusing = false
            resolve()
          }
        })
      },
      settle: () => settle(),
    }
  }

  it('one refused evaluate and one fault for the spell, however long it lasts, and one read of the song on settling', async () => {
    const wired = custodyWired()
    await wired.player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    wired.withhold()
    const before = wired.asked()
    // A minute of the 1 s poll, the duck a spoken line sets beside it.
    await wired.player.duck(true)
    for (let tick = 0; tick < 60; tick += 1) await wired.player.check()
    await wired.player.duck(false)
    expect(wired.asked() - before).toBe(1)
    expect(wired.faults.filter((fault) => fault.site === 'music.player.evaluate')).toHaveLength(1)
    const evaluated = wired.browser.evaluations.length
    wired.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Resumed on the edge, not the next tick: the song is read once, and asked again from then on.
    expect(wired.browser.evaluations.length).toBeGreaterThan(evaluated)
    expect(wired.faults).toHaveLength(1)
    const resumed = wired.asked()
    await wired.player.check()
    expect(wired.asked()).toBeGreaterThan(resumed)
  })

  it('a refusal that is not custody\'s is reported every time, as before', async () => {
    const wired = custodyWired()
    await wired.player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    wired.browser.evaluator = () => {
      throw new Error('Script not run')
    }
    await wired.player.check()
    await wired.player.check()
    expect(wired.faults.filter((fault) => fault.site === 'music.player.evaluate')).toHaveLength(2)
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

/** Remembered Songs in memory, as the store keeps them on disk. */
function songMemory(): SongMemory & { all(): readonly string[] } {
  let songs = EMPTY_REMEMBERED_SONGS
  return {
    recall: (words) => recallSong(songs, words),
    remember: (words, song) => {
      songs = rememberSong(songs, words, song, 0)
    },
    forgetWords: (words) => {
      songs = forgetWords(songs, words)
    },
    forgetVideo: (id) => {
      const forgot = forgetVideo(songs, id)
      songs = forgot.songs
      return forgot.forgot
    },
    all: () => songs.songs.map((song) => `${song.words} → ${song.id}`),
  }
}

/** A search with three plain videos, and a Player that remembers and learns. */
function remembering() {
  const browser = new FakeBrowser()
  const youtube = new ScriptedYouTube(browser)
  youtube.search('midnight drive', videoItem('first000000', 'Lumen - Midnight Drive (Official Video)'), { channelRenderer: {} }, videoItem('second00000', 'Second'), videoItem('third000000', 'Third'))
  youtube.search('song b', videoItem('bbbbbbbbbbb', 'Song B'))
  for (const [id, title] of [['first000000', 'Lumen - Midnight Drive'], ['second00000', 'Second'], ['third000000', 'Third'], ['bbbbbbbbbbb', 'Song B']] as const) youtube.watches.set(id, { title })
  const songs = songMemory()
  const learned: string[] = []
  const player = createPlayer({ browser, fetchResults: youtube.fetchResults, sleep: async () => {}, songs, learn: (term) => learned.push(term) })
  const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, () => true)
  const play = () => perform({ kind: 'search', place: 'now' }, 'midnight drive')
  /** The song plays on this long, and the poll hears it. */
  const playFor = async (seconds: number) => {
    youtube.element.currentTime = seconds
    await player.check()
  }
  return { browser, youtube, player, perform, play, playFor, songs, learned }
}

describe('correcting the pick (#345)', () => {
  it('`not that one` opens the next plain video of the kept results, then the one after, then says none are left', async () => {
    const { browser, player, perform, play } = remembering()
    expect(await play()).toMatchObject({ video: 'first000000', pick: 'searched' })
    const opened = browser.navigations.length
    expect(await perform({ kind: 'correct', step: 1 })).toMatchObject({ answer: 'Playing “Second” instead.', video: 'second00000' })
    // No second search: the kept list is moved along.
    expect(browser.navigations.slice(opened)).toEqual([`${WATCH}second00000`])
    expect(await perform({ kind: 'correct', step: 1 })).toMatchObject({ answer: 'Playing “Third” instead.', video: 'third000000' })
    expect(await perform({ kind: 'correct', step: 1 })).toMatchObject({ answer: 'No more results.' })
    expect(player.queue().current?.id).toBe('third000000')
    expect(await perform({ kind: 'correct', step: -1 })).toMatchObject({ answer: 'Playing “Second” instead.', video: 'second00000' })
    // The wrong picks were never played: `previous` has nothing to go back to.
    expect(player.queue().played).toEqual([])
  })

  it('with nothing searched there is nothing to correct', async () => {
    const { perform } = remembering()
    expect(await perform({ kind: 'correct', step: 1 })).toMatchObject({ answer: 'Nothing to correct.' })
  })
})

describe('a pick that stayed (#345)', () => {
  it('is remembered past 30 s, and the next `play` of its words opens it with no results page', async () => {
    const { browser, perform, playFor, songs } = remembering()
    await perform({ kind: 'search', place: 'now' }, 'midnight drive')
    await playFor(29)
    expect(songs.all()).toEqual([])
    await playFor(31)
    expect(songs.all()).toEqual(['midnight drive → first000000'])
    const opened = browser.navigations.length
    expect(await perform({ kind: 'search', place: 'now' }, 'Midnight  Drive.')).toMatchObject({ answer: 'Playing “Lumen - Midnight Drive (Official Video)”.', pick: 'remembered' })
    expect(browser.navigations.slice(opened)).toEqual([`${WATCH}first000000`])
  })

  it('a poll that comes while the pick is still opening, another song current, does not lose its stay', async () => {
    const { browser, player, perform, play, playFor, songs } = remembering()
    await perform({ kind: 'search', place: 'now' }, 'song b')
    const page = browser.evaluator!
    let polled = false
    browser.evaluator = (expression) => {
      if (!polled && expression.includes('/* YT_WATCH */') && (browser.state().url ?? '').includes('first000000')) {
        polled = true
        void player.check()
      }
      return page(expression)
    }
    await play()
    expect(polled).toBe(true)
    await playFor(31)
    expect(songs.all()).toEqual(['midnight drive → first000000'])
  })

  it('a correction past either end changes nothing: the song playing may still stay', async () => {
    const { perform, play, playFor, songs } = remembering()
    await play()
    expect(await perform({ kind: 'correct', step: -1 })).toMatchObject({ answer: 'That was the first result.' })
    await playFor(31)
    expect(songs.all()).toEqual(['midnight drive → first000000'])
  })

  it('`the one before` on a remembered pick has nothing before it, and searches nothing', async () => {
    const { browser, perform, play, playFor, songs } = remembering()
    await play()
    await playFor(31)
    await play()
    const opened = browser.navigations.length
    expect(await perform({ kind: 'correct', step: -1 })).toMatchObject({ answer: 'That was the first result.' })
    expect(browser.navigations).toHaveLength(opened)
    expect(songs.all()).toEqual(['midnight drive → first000000'])
  })

  it('its trimmed title joins the Learned Terms', async () => {
    const { play, playFor, learned } = remembering()
    await play()
    await playFor(31)
    expect(learned).toEqual(['Lumen Midnight Drive', 'Lumen', 'Midnight Drive'])
  })

  it('a correction on a remembered song forgets it, searches again and passes the wrong one by', async () => {
    const { browser, youtube, perform, play, playFor, songs } = remembering()
    await play()
    await playFor(31)
    await play()
    const opened = browser.navigations.length
    const searched = youtube.fetched.length
    expect(await perform({ kind: 'correct', step: 1 })).toMatchObject({ answer: 'Playing “Second” instead.', video: 'second00000' })
    expect(youtube.fetched.slice(searched)).toEqual([`${RESULTS}midnight+drive`])
    expect(browser.navigations.slice(opened)).toEqual([`${WATCH}second00000`])
    expect(songs.all()).toEqual([])
  })

  it('a correction inside 30 s leaves the wrong pick unremembered, and the next `play` searches', async () => {
    const { youtube, perform, play, playFor, songs } = remembering()
    await play()
    await playFor(10)
    await perform({ kind: 'correct', step: 1 })
    await playFor(31)
    // The corrected pick stayed: it is the one remembered.
    expect(songs.all()).toEqual(['midnight drive → second00000'])
    await perform({ kind: 'forget' })
    const searched = youtube.fetched.length
    expect(await play()).toMatchObject({ pick: 'searched' })
    expect(youtube.fetched[searched]).toBe(`${RESULTS}midnight+drive`)
  })

  it('`forget this song` forgets the song playing, and says when it was not remembered', async () => {
    const { perform, play, playFor, songs } = remembering()
    expect(await perform({ kind: 'forget' })).toMatchObject({ answer: 'Nothing is playing.' })
    await play()
    expect(await perform({ kind: 'forget' })).toMatchObject({ answer: '“Lumen - Midnight Drive (Official Video)” wasn\'t remembered.' })
    // Forgotten before it stayed: it is not remembered at 30 s either.
    await playFor(31)
    expect(songs.all()).toEqual([])
    await play()
    await playFor(31)
    expect(await perform({ kind: 'forget' })).toMatchObject({ answer: 'Forgot “Lumen - Midnight Drive (Official Video)”.' })
    expect(songs.all()).toEqual([])
  })

  it('a `skip` inside 30 s remembers nothing, and a queued song is no pick', async () => {
    const { perform, play, playFor, songs, learned } = remembering()
    await play()
    await perform({ kind: 'search', place: 'end' }, 'song b')
    await playFor(10)
    await perform({ kind: 'skip' })
    await playFor(45)
    expect(songs.all()).toEqual([])
    expect(learned).toEqual([])
  })

  it('an ad\'s time is not the song\'s', async () => {
    const { youtube, play, playFor, songs } = remembering()
    await play()
    youtube.adShowing = true
    await playFor(31)
    expect(songs.all()).toEqual([])
  })
})
