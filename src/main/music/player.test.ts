import { afterEach, describe, expect, it } from 'vitest'
import { WithheldResourceError } from '../../core/browser/unsettledAction'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { FakeBrowser } from '../../core/testing/doubles'
import type { MusicAction } from '../../core/music/musicWords'
import type { NowPlaying } from '../../core/music/nowPlaying'
import { EMPTY_REMEMBERED_SONGS, forgetVideo, forgetWords, recallSong, rememberSong } from '../../core/music/rememberedSongs'
import { loudnessFactor } from '../../core/music/loudness'
import { createPlayer, type PlayerConsent, type PlayerConsentTold, type PlayerStart, type SongMemory } from './player'
import { SHEET_DISMISSAL, ScriptedYouTube, scriptedAudio, videoItem } from './scriptedYouTube'

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

  it('`repeat` at the song\'s end plays it again from the start, and loops a song still playing (turn-mvqga9a7-v1g)', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await perform({ kind: 'loop', on: true, again: true })).toMatchObject({ answer: 'Looping “Song A”.' })
    expect(youtube.controls.at(-1)).toEqual({ op: 'loop', on: true })
    await perform({ kind: 'loop', on: false })
    youtube.endVideo()
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ ended: true })
    expect(await perform({ kind: 'loop', on: true, again: true })).toMatchObject({ answer: 'Playing “Song A” again.' })
    expect(youtube.controls.at(-1)).toEqual({ op: 'restart' })
    expect(player.nowPlaying()).toMatchObject({ id: 'aaaaaaaaaaa', ended: false, paused: false, loop: false })
  })

  it('`loop` at the song\'s end sets the loop and plays nothing: only the `repeat` lines play it again', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    await perform({ kind: 'loop', on: true })
    expect(youtube.controls.at(-1)).toEqual({ op: 'loop', on: true })
  })

  it('follows the element (#473): a loop set on the page alone shows Loop, and a pause from the page shows Paused', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.element = { ...youtube.element, loop: true }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ loop: true, paused: false })
    expect(player.queue().loop).toBe(true)
    youtube.element = { ...youtube.element, paused: true, currentTime: 12 }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ loop: true, paused: true, ended: false })
    expect(player.queue().paused).toBe(true)
    youtube.element = { ...youtube.element, paused: false, loop: false }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ loop: false, paused: false })
  })

  it('a paused element that has not played yet is a page still landing (#473): the card says Starting, not Paused', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.element = { ...youtube.element, paused: true, duration: null }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ paused: false, durationS: null })
    // Its length known, nothing of it elapsed: the autoplay gate, not a pause.
    youtube.element = { ...youtube.element, paused: true, duration: 180, currentTime: 0 }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ paused: false, durationS: 180 })
    youtube.element = { ...youtube.element, currentTime: 3 }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ paused: true })
  })

  it('an ended song playing again from the page (#473) leaves Ended and the bar moves: looping, it plays on with no end heard', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ ended: true, loop: false })
    // Still paused at its end: ended it stays, the page read each tick.
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ ended: true })
    youtube.element = { ...youtube.element, paused: false, loop: true, currentTime: 5 }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ id: 'aaaaaaaaaaa', ended: false, paused: false, loop: true, elapsedS: 5 })
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
    youtube.element = { ...youtube.element, currentTime: 40 }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ ended: false, elapsedS: 40 })
    expect(browser.navigations).toHaveLength(1)
    expect(youtube.controls).toEqual([])
  })

  it('an ended song set playing in its last second without loop (#473) is not back: the end rule pauses it again at once', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    youtube.element = { ...youtube.element, paused: false, loop: false, currentTime: 179.5, duration: 180 }
    await player.check()
    expect(player.nowPlaying()).toMatchObject({ ended: true })
    expect(player.queue().current).toBeNull()
  })

  it('once the pane leaves the ended song\'s page the poll stops reading it (#473): the watch script minds no video the Player never started', async () => {
    const { browser, youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.endVideo()
    await player.check()
    await browser.navigate(`${WATCH}bbbbbbbbbbb`)
    await player.check()
    const read = browser.evaluations.length
    await player.check()
    await player.check()
    expect(browser.evaluations).toHaveLength(read)
    expect(player.nowPlaying()).toMatchObject({ id: 'aaaaaaaaaaa', ended: true })
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

  it('a Media Op under the duck sets the level put back, so the release keeps it and the next duck marks it (#459)', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'volume', to: 55 })
    // The four kiosk lines of 2026-10-26: up a little, up a little, up a step, to 50 — each read from the level heard.
    for (const up of [5, 5, 10, null]) {
      await player.duck(true)
      // What the card reads meanwhile is the level put back, never the floor.
      const read = youtube.heard()
      expect(youtube.element.volume).toBe(Math.round(read * 0.15))
      const set = up === null ? 50 : read + up
      youtube.setHeard(set)
      expect(youtube.element.volume).toBe(Math.round(set * 0.15))
      await player.duck(false)
      expect(youtube.element.volume).toBe(set)
    }
    expect(youtube.element.volume).toBe(50)
    await player.duck(true)
    expect(youtube.heard()).toBe(50)
    expect(youtube.element.volume).toBe(8)
  })

  it('a volume verb on an element the poll has not marked yet marks it first, so the release keeps the verb\'s level (#459)', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'volume', to: 60 })
    await player.duck(true)
    // A fresh element, unmarked, at YouTube's level.
    youtube.duckMark = null
    youtube.element = { ...youtube.element, volume: 60 }
    expect((await perform({ kind: 'quieter' })).answer).toBe('Volume 50.')
    expect(youtube.element.volume).toBe(8)
    await player.duck(false)
    expect(youtube.element.volume).toBe(50)
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

  /** A `volume` Media Op (ADR 0080, #408): the element alone, YouTube's player never told — under a duck, its mark (#459). */
  const mediaOp = (youtube: ScriptedYouTube, to: number): void => youtube.setHeard(to)

  it('a Media Op\'s 20 under the duck, then `skip`, carries 20 matched into the next song, heard once the duck lets go (#459)', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    await player.duck(true)
    mediaOp(youtube, 20)
    await perform({ kind: 'skip' })
    // The new song plays at the duck's floor of the carried level, marked with that level.
    expect(youtube.heard()).toBeCloseTo((20 / AF) * BF, 1)
    expect(youtube.element.volume).toBe(3)
    await player.duck(false)
    expect(youtube.element.volume).toBeCloseTo(19.93, 1)
  })

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
    // The next page opens on an ad: the level is not carried over it as the page opens.
    youtube.preRollS = 5
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.element.volume).toBeCloseTo(100 * BF, 1)
    // The ad played through the start's reads (#488, #497); the song itself begins at 0 s.
    youtube.element = { ...youtube.element, volume: 100 * BF, currentTime: 0 }
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

  it('a song that opens on an ad under the duck, marked by the pane\'s duck at YouTube\'s own level, still takes the matched level (#461)', async () => {
    const { youtube, player, perform } = loud()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    mediaOp(youtube, 20)
    await player.check()
    await player.duck(true)
    // The pane's duck reaches the new page first: its element marked with the level YouTube opened it at, an ad's.
    youtube.paneDuck = 0.15
    youtube.preRollS = 5
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.heard()).toBeCloseTo(100 * BF, 1)
    await player.check()
    expect(youtube.heard()).toBeCloseTo(19.93, 1)
    expect(youtube.element.volume).toBe(3)
    await player.duck(false)
    expect(youtube.element.volume).toBeCloseTo(19.93, 1)
  })

  it('a song opened under a duck that held no song is heard at the level the pane\'s mark puts back, never its floor (#461)', async () => {
    const { youtube, player, perform } = loud()
    // The ear opens over a page with no Player song: the Player has nothing to duck, the pane holds.
    await player.duck(true)
    youtube.paneDuck = 0.15
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await player.check()
    // The duck lets go: the Player held none, the pane puts the mark's level back.
    await player.duck(false)
    youtube.paneDuck = null
    youtube.element = { ...youtube.element, volume: youtube.duckMark!.restore }
    youtube.duckMark = null
    // A Hot Listen opens before the next poll: the Player ducks the song from the level heard, not the floor the pane had left.
    await player.duck(true)
    expect(youtube.heard()).toBeCloseTo(100 * AF, 1)
    await player.duck(false)
    expect(youtube.element.volume).toBeCloseTo(100 * AF, 1)
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
      state: browser.state.bind(browser),
      evaluateInFrames: browser.evaluateInFrames.bind(browser),
      evaluate: <T>(expression: string): Promise<T> => {
        asked += 1
        return refusing ? Promise.reject(new WithheldResourceError('evaluate')) : browser.evaluate<T>(expression)
      },
      clearConsent: (options?: { readonly shown?: number }) => {
        asked += 1
        return refusing ? Promise.reject(new WithheldResourceError('clearConsent')) : browser.clearConsent(options)
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
    // The page's consent watch (#492) looks on in the background, its waits instant here: done before the spell, as it is long before a real one.
    await new Promise((resolve) => setTimeout(resolve, 0))
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

  it('a hold over a page being watched for a consent wall is one fault, and the watch asks nothing until it settles (#492)', async () => {
    const wired = custodyWired()
    wired.withhold()
    await wired.player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const asked = wired.asked()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The look and the landing's read already in flight are refused together; nothing is asked after.
    expect(asked).toBeLessThanOrEqual(2)
    expect(wired.asked()).toBe(asked)
    expect(wired.faults).toHaveLength(1)
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

  it('a pause adopted from the page a tick before the prompt shows (#473) is still answered: only the Player\'s own pause is left alone', async () => {
    const { youtube, player, perform } = wired()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.element = { ...youtube.element, paused: true, currentTime: 50 }
    await player.check()
    expect(player.nowPlaying()?.paused).toBe(true)
    youtube.continuePrompt = true
    await player.check()
    expect(youtube.continued).toBe(1)
    expect(youtube.element.paused).toBe(false)
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
  youtube.search('midnight drive', videoItem('first000000', 'Lumen - Midnight Drive (Official Video)', 'Lumen Music'), { channelRenderer: {} }, videoItem('second00000', 'Second', 'Second Channel'), videoItem('third000000', 'Third'))
  youtube.search('song b', videoItem('bbbbbbbbbbb', 'Song B'))
  for (const [id, title] of [['first000000', 'Lumen - Midnight Drive'], ['second00000', 'Second'], ['third000000', 'Third'], ['bbbbbbbbbbb', 'Song B']] as const) youtube.watches.set(id, { title })
  const songs = songMemory()
  const learned: string[] = []
  const proposed: string[] = []
  const player = createPlayer({ browser, fetchResults: youtube.fetchResults, sleep: async () => {}, songs, learn: (term) => learned.push(term), propose: (term) => proposed.push(term) })
  const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, () => true)
  const play = () => perform({ kind: 'search', place: 'now' }, 'midnight drive')
  /** The song plays on this long, and the poll hears it. */
  const playFor = async (seconds: number) => {
    youtube.element.currentTime = seconds
    await player.check()
  }
  return { browser, youtube, player, perform, play, playFor, songs, learned, proposed }
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

  it("proposes its channel's name once it plays through the retry chain's minute, admitted only when it recurs (#456)", async () => {
    const { perform, play, playFor, proposed } = remembering()
    await play()
    await playFor(10)
    // Corrected before it stayed: the wrong pick's channel teaches nothing, the one that stayed proposes its own.
    await perform({ kind: 'correct', step: 1 })
    await playFor(31)
    expect(proposed).toEqual([])
    await playFor(61)
    expect(proposed).toEqual(['Second Channel'])
    await playFor(90)
    expect(proposed).toEqual(['Second Channel'])
  })

  it('proposes nothing when a retry inside the minute plays another song, or the pick named no channel', async () => {
    const { perform, play, playFor, proposed } = remembering()
    await play()
    await playFor(31)
    // A retry between the stay and the minute: the pick was wrong after all.
    await perform({ kind: 'search', place: 'now' }, 'song b')
    await playFor(61)
    expect(proposed).toEqual([])
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

describe("a song's start (#488): Playing only when the element plays", () => {
  function starting() {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.search('song b', videoItem('bbbbbbbbbbb', 'Song B'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    youtube.watches.set('bbbbbbbbbbb', { title: 'Song B' })
    const starts: PlayerStart[] = []
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => {}, onStart: (start) => starts.push(start) })
    const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, () => true)
    const presses = (): number => youtube.controls.filter((op) => op.op === 'play').length
    return { youtube, player, perform, presses, starts }
  }

  it('a song that starts by itself is not pressed: Playing, and its start is recorded', async () => {
    const { perform, presses, starts } = starting()
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(presses()).toBe(0)
    expect(starts).toEqual([expect.objectContaining({ video: 'aaaaaaaaaaa', started: true, pressed: false, refused: null, background: false })])
  })

  it('a page whose element a press left holding no data is opened again once, in full, and the song plays there', async () => {
    const { youtube, perform, presses, starts } = starting()
    youtube.starts = 'reopen'
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(played).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(played.failure).toBeUndefined()
    expect(presses()).toBe(1)
    expect(starts).toEqual([
      expect.objectContaining({ started: false, pressed: true, reopened: false, element: expect.objectContaining({ ready: 0 }) }),
      expect.objectContaining({ started: true, pressed: false, reopened: true }),
    ])
  })

  it('a song that never starts until pressed is pressed once, then Playing', async () => {
    const { youtube, perform, presses, starts } = starting()
    youtube.starts = 'press'
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(played).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(played.failure).toBeUndefined()
    expect(presses()).toBe(1)
    expect(starts).toEqual([expect.objectContaining({ started: true, pressed: true })])
  })

  it('a song that plays a moment and pauses is pressed once: a moment of play is not a start', async () => {
    const { youtube, perform, presses } = starting()
    youtube.starts = 'stalls'
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(presses()).toBe(1)
  })

  it('a song whose press is refused, on its page and on that page opened again, fails, said as not started; the Queue keeps it, paused, and the reason is recorded', async () => {
    const { youtube, player, perform, presses, starts } = starting()
    youtube.starts = 'refuses'
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(played).toMatchObject({ failure: true, answer: "“Song A” opened but didn't start.", video: 'aaaaaaaaaaa', result: 'unstarted: id=aaaaaaaaaaa title="Song A" pressed reopened refused=NotAllowedError' })
    expect(presses()).toBe(2)
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
    expect(player.queue().paused).toBe(true)
    expect(player.nowPlaying()).toMatchObject({ paused: true })
    expect(starts).toEqual([expect.objectContaining({ started: false, pressed: true, reopened: false, refused: 'NotAllowedError' }), expect.objectContaining({ started: false, pressed: true, reopened: true, refused: 'NotAllowedError' })])
  })

  it('an element holding no data to play is not playing, however unpaused: pressed once on each page, then unstarted with no refusal', async () => {
    const { youtube, perform, presses, starts } = starting()
    youtube.readyState = 2
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ failure: true, unstarted: true })
    expect(presses()).toBe(2)
    expect(starts.at(-1)).toMatchObject({ started: false, pressed: true, reopened: true, refused: null, element: { paused: false, ended: false, ready: 2, time: 0 } })
  })

  it('a song left unstarted plays on `resume`', async () => {
    const { youtube, player, perform } = starting()
    youtube.starts = 'refuses'
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.starts = 'press'
    await perform({ kind: 'unpause' })
    expect(youtube.element.paused).toBe(false)
    expect(player.queue().paused).toBe(false)
  })

  it('a remembered song that opened but did not start is not forgotten: the song is fine, its start was not', async () => {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    const forgotten: string[] = []
    const songs: SongMemory = { recall: () => ({ id: 'aaaaaaaaaaa', title: 'Song A' }), remember: () => {}, forgetWords: (words) => forgotten.push(words), forgetVideo: () => false }
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => {}, songs })
    youtube.starts = 'refuses'
    expect(await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)).toMatchObject({ failure: true })
    expect(forgotten).toEqual([])
  })

  it('a queued song opened in the background is read, pressed and opened again too; left unstarted, it is held paused', async () => {
    const { youtube, player, perform, presses, starts } = starting()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    youtube.starts = 'refuses'
    youtube.endVideo()
    await player.check()
    await player.settled()
    expect(player.queue().current?.id).toBe('bbbbbbbbbbb')
    expect(presses()).toBe(2)
    expect(player.queue().paused).toBe(true)
    expect(starts.at(-1)).toMatchObject({ video: 'bbbbbbbbbbb', started: false, background: true })
  })

  it('a later Command while the song starts supersedes the wait: nothing is pressed, and the song stays current', async () => {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    youtube.starts = 'press'
    // The landing reads at once; the first wait on the start is where the later Command comes.
    let live = true
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => { live = false } })
    expect(await player.perform({ kind: 'search', place: 'now' }, 'song a', () => live)).toMatchObject({ superseded: true })
    expect(youtube.controls.filter((op) => op.op === 'play')).toEqual([])
    expect(player.queue().current?.id).toBe('aaaaaaaaaaa')
  })

  it('a Command ended while the start is being read at its bound is never pressed (#489, the overlap gate\'s 1-replace)', async () => {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    youtube.starts = 'press'
    // The later line ends this one while the start's read at the self-start bound is out: the pane is paused under it, so a press would start the song.
    let live = true
    let reads = 0
    const evaluator = browser.evaluator!
    browser.evaluator = (expression) => {
      if (expression.includes('YT_START') && (reads += 1) > 10) live = false
      return evaluator(expression)
    }
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => {} })
    expect(await player.perform({ kind: 'search', place: 'now' }, 'song a', () => live)).toMatchObject({ superseded: true })
    expect(youtube.controls.filter((op) => op.op === 'play')).toEqual([])
  })
})

describe('a pre-roll ad before the song (#497): the start counts only the song’s own time', () => {
  /** A 2:00 pre-roll, then the song: the Player never presses anything over it (the page's Skip is Jev's, a click of its ref). */
  const PRE_ROLL_S = 120
  function prerolled() {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    const starts: PlayerStart[] = []
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: async () => {}, onStart: (start) => starts.push(start) })
    const shown: (NowPlaying | null)[] = []
    player.onChange((nowPlaying) => shown.push(nowPlaying))
    return { youtube, player, starts, shown }
  }

  it('the ad plays out unpressed and unreopened, and the start is decided on the song: Playing once the song plays, the ad’s hold recorded', async () => {
    const { youtube, player, starts } = prerolled()
    youtube.preRollS = PRE_ROLL_S
    const played = await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa' })
    expect(played.failure).toBeUndefined()
    // The song itself was playing when the answer came: the ad had ended.
    expect(youtube.adShowing).toBe(false)
    expect(youtube.controls.filter((op) => op.op === 'play')).toEqual([])
    expect(starts).toEqual([expect.objectContaining({ started: true, pressed: false, reopened: false, ad: expect.any(Number) })])
    // The start's element read is the song's: its time from 0, not the ad's 2:00.
    expect(starts[0]!.element!.time).toBeLessThan(5)
  })

  it('while the ad plays, Now Playing carries it — its seconds and length off the element — and drops it once the song plays', async () => {
    const { youtube, player, shown } = prerolled()
    youtube.preRollS = PRE_ROLL_S
    await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    const ads = shown.flatMap((nowPlaying) => (nowPlaying?.ad ? [nowPlaying.ad] : []))
    expect(ads).toContainEqual({ elapsedS: 5, durationS: PRE_ROLL_S })
    // Counted from the element, each second once.
    expect(ads.map((ad) => ad.elapsedS)).toEqual([...new Set(ads.map((ad) => ad.elapsedS))].sort((a, b) => a - b))
    expect(player.nowPlaying()?.ad ?? null).toBeNull()
  })

  it('a line given during the ad finds the play still running: superseded there, it answers nothing and says no Playing', async () => {
    const { youtube, player, starts } = prerolled()
    youtube.preRollS = PRE_ROLL_S
    let reads = 0
    const live = (): boolean => (youtube.adShowing ? (reads += 1) < 40 : true)
    const played = await player.perform({ kind: 'search', place: 'now' }, 'song a', live)
    expect(played).toMatchObject({ superseded: true, answer: '' })
    expect(youtube.adShowing).toBe(true)
    expect(starts).toEqual([])
  })

  it('a pod of two ads, the marker off for a read between them: one start, held through both, and no ad left on Now Playing', async () => {
    const { youtube, player, starts } = prerolled()
    youtube.preRollS = [15, 8]
    expect(await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(youtube.controls.filter((op) => op.op === 'play')).toEqual([])
    expect(starts).toEqual([expect.objectContaining({ started: true, pressed: false, reopened: false })])
    // Held from the first ad's first read to the song's: both ads' reads, 250 ms each.
    expect(starts[0]!.ad).toBeGreaterThanOrEqual(22_000)
    expect(player.nowPlaying()?.ad ?? null).toBeNull()
  })

  it('the poll off the song’s page, mid-ad: no ad is left counting on Now Playing', async () => {
    const { youtube, player } = prerolled()
    await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    youtube.adShowing = true
    youtube.element = { ...youtube.element, currentTime: 9, duration: 30 }
    await player.check()
    expect(player.nowPlaying()?.ad).toEqual({ elapsedS: 9, durationS: 30 })
    // The element is gone (no player video): the count does not stand frozen.
    youtube.watches.delete('aaaaaaaaaaa')
    await player.check()
    expect(player.nowPlaying()?.ad ?? null).toBeNull()
  })

  it('a song with no ad records none', async () => {
    const { player, starts } = prerolled()
    await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    expect(starts).toEqual([expect.objectContaining({ started: true, ad: null })])
  })

  it('the poll over an ad in the song’s element: Now Playing says the ad, then the song once it plays', async () => {
    const { youtube, player } = prerolled()
    await player.perform({ kind: 'search', place: 'now' }, 'song a', () => true)
    youtube.adShowing = true
    youtube.element = { ...youtube.element, currentTime: 7.4, duration: 15 }
    await player.check()
    expect(player.nowPlaying()?.ad).toEqual({ elapsedS: 7, durationS: 15 })
    youtube.adShowing = false
    youtube.element = { ...youtube.element, currentTime: 2, duration: 180 }
    await player.check()
    expect(player.nowPlaying()?.ad ?? null).toBeNull()
  })
})

describe("a consent wall over a page the Player opened (#492): the browser's own clear", () => {
  function sheeted() {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.search('song b', videoItem('bbbbbbbbbbb', 'Song B'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    youtube.watches.set('bbbbbbbbbbb', { title: 'Song B' })
    const starts: PlayerStart[] = []
    const consents: PlayerConsent[] = []
    const told: PlayerConsentTold[] = []
    const player = createPlayer({
      browser,
      fetchResults: (url) => youtube.fetchResults(url),
      sleep: async () => {},
      onStart: (start) => starts.push(start),
      onConsent: (consent) => consents.push(consent),
      onConsentTold: (heard) => told.push(heard),
    })
    const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, () => true)
    const presses = (): number => youtube.controls.filter((op) => op.op === 'play').length
    return { browser, youtube, player, perform, presses, starts, consents, told }
  }

  it('a sheet that draws over the watch page after the landing is cleared, and the song starts with no press; the clear is recorded on the start', async () => {
    const { youtube, perform, presses, starts, consents } = sheeted()
    youtube.starts = 'sheet'
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(played).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(played.failure).toBeUndefined()
    expect(youtube.sheetsCleared).toBe(1)
    expect(presses()).toBe(0)
    expect(starts).toEqual([expect.objectContaining({ started: true, pressed: false, reopened: false, consent: expect.any(Number) })])
    expect(consents).toEqual([expect.objectContaining({ video: 'aaaaaaaaaaa', afterStart: false, line: SHEET_DISMISSAL })])
  })

  it('a clear still running when the start would press waits it out: no press, no reopen, and the song plays once the sheet leaves', async () => {
    const { youtube, perform, presses, starts } = sheeted()
    youtube.starts = 'sheet'
    youtube.sheetClearTurns = 5
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(played).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(youtube.sheetsCleared).toBe(1)
    expect(presses()).toBe(0)
    expect(starts).toEqual([expect.objectContaining({ started: true, pressed: false, reopened: false, consent: expect.any(Number) })])
  })

  it('a page with no wall is looked at once, at the landing — no poll (#496) — and its start records no clear', async () => {
    const { browser, perform, starts, consents } = sheeted()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentClears).toEqual([undefined])
    expect(starts).toEqual([expect.objectContaining({ started: true, consent: null })])
    expect(consents).toEqual([])
  })

  it('the clear a signal begins is given the page\'s showing: the look is skipped, the page already said the wall is up (#496)', async () => {
    const { browser, youtube, perform, consents } = sheeted()
    youtube.starts = 'sheet'
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.consentClears).toEqual([undefined, 1])
    expect(consents).toEqual([expect.objectContaining({ video: 'aaaaaaaaaaa', ms: expect.any(Number), drawToClickMs: expect.any(Number), gone: true })])
  })

  it('a wall signalled over media playing on a page the Player did not open is cleared, by kind (#496)', async () => {
    const { browser, consents } = sheeted()
    await browser.navigate('https://news.example/clip')
    browser.consentClear = () => 'dismissed consent dialog: clicked [2] "Reject all"'
    browser.drawConsent({ playing: true, showing: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentClears).toEqual([1])
    expect(consents).toEqual([expect.objectContaining({ video: null, ms: null, afterStart: true, line: 'dismissed consent dialog: clicked [2] "Reject all"' })])
  })

  it('a wall the page tells of while a clear is in flight is cleared once that clear returns: the page tells each showing once (#496)', async () => {
    const { browser, consents, told } = sheeted()
    await browser.navigate('https://news.example/clip')
    let release: (line: string | null) => void = () => {}
    browser.consentClear = () => new Promise<string | null>((resolve) => (release = resolve))
    browser.drawConsent({ playing: true, showing: 1 })
    // The sheet goes and comes while the first clear is out: a second showing, told during it.
    browser.drawConsent({ playing: true, showing: 2 })
    expect(browser.consentClears).toEqual([1])
    expect(told.map((heard) => [heard.road, heard.at])).toEqual([['kind', 'now'], ['kind', 'queued']])
    browser.consentClear = () => 'dismissed consent dialog: clicked [2] "Reject all"'
    release(null)
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentClears).toEqual([1, 2])
    expect(consents).toEqual([expect.objectContaining({ line: 'dismissed consent dialog: clicked [2] "Reject all"' })])
  })

  it('a wall signalled with nothing playing on a page the Player did not open is the next Command\'s collect\'s, as before', async () => {
    const { browser, told } = sheeted()
    await browser.navigate('https://news.example/article')
    browser.drawConsent({ playing: false, showing: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentClears).toEqual([])
    expect(told).toEqual([expect.objectContaining({ road: 'nothing-playing', at: null })])
  })

  it('a wall signalled over media the Player has just paused is not cleared: a clear lets a page start what its wall held', async () => {
    const { browser, player, told } = sheeted()
    await browser.navigate('https://news.example/clip')
    await player.pauseAll()
    browser.drawConsent({ playing: true, showing: 1, ageMs: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentClears).toEqual([])
    expect(told).toEqual([expect.objectContaining({ road: 'own-pause', at: null })])
  })

  it('the watch stops at the first clear: one sheet, one clear', async () => {
    const { browser, youtube, perform } = sheeted()
    youtube.starts = 'sheet'
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const looks = browser.consentLooks
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentLooks).toBe(looks)
    expect(youtube.sheetsCleared).toBe(1)
  })

  it('a pause ends the watch: a sheet cleared after it would start the song an ended Command opened (#489, the overlap gate\'s 1-replace)', async () => {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    youtube.starts = 'sheet'
    // Each wait a timer turn: the watch looks once per turn, as it looks once a second on the clock.
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: () => new Promise((resolve) => setTimeout(resolve, 0)) })
    let live = true
    const played = player.perform({ kind: 'search', place: 'now' }, 'song a', () => live)
    // The Command ends while its watch page is under the sheet: the runner pauses the pane.
    while (browser.consentLooks === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    live = false
    await player.pauseAll()
    await played
    for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(youtube.sheetsCleared).toBe(0)
  })

  it('a clear already out when the pause came is held: the page that starts its song as the sheet leaves is paused again (#489)', async () => {
    const browser = new FakeBrowser()
    const youtube = new ScriptedYouTube(browser)
    youtube.search('song a', videoItem('aaaaaaaaaaa', 'Song A'))
    youtube.watches.set('aaaaaaaaaaa', { title: 'Song A' })
    youtube.starts = 'sheet'
    youtube.sheetClearTurns = 20
    youtube.sheetStartsOnClear = true
    const player = createPlayer({ browser, fetchResults: (url) => youtube.fetchResults(url), sleep: () => new Promise((resolve) => setTimeout(resolve, 0)) })
    let live = true
    const played = player.perform({ kind: 'search', place: 'now' }, 'song a', () => live)
    // The clear the sheet's signal began is out (#496): the Command ends and the runner pauses the pane under it.
    while (!browser.consentClears.includes(1)) await new Promise((resolve) => setTimeout(resolve, 0))
    live = false
    await player.pauseAll()
    await played
    while (youtube.sheetsCleared === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(youtube.element.paused).toBe(true)
  })

  it('a song the page pauses after its start is not pressed again: a pause is never overridden', async () => {
    const { youtube, player, perform, presses } = sheeted()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    youtube.element = { ...youtube.element, paused: true }
    await player.check()
    await player.check()
    expect(presses()).toBe(0)
  })

  it('the watch ends once the pane leaves the song\'s page: a Command\'s page with nothing playing is never cleared', async () => {
    const { browser, perform } = sheeted()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    const looks = browser.consentLooks
    expect(looks).toBe(1)
    await browser.navigate('https://www.bbc.co.uk/news')
    browser.drawConsent({ playing: false, showing: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(browser.consentLooks).toBe(looks)
  })

  it('a browser with no clear opens and plays as before', async () => {
    const { browser, perform } = sheeted()
    Object.defineProperty(browser, 'clearConsent', { value: undefined })
    expect(await perform({ kind: 'search', place: 'now' }, 'song a')).toMatchObject({ answer: 'Playing “Song A”.' })
    expect(browser.consentLooks).toBe(0)
  })
})

// The audio road (#502): a song Jev read as music plays its bare audio
// stream outside the pane; a video, or any failure of the road, opens the
// watch page as before, shown.
describe('the audio road', () => {
  function withAudio() {
    const pane = wired()
    const audio = scriptedAudio(pane.youtube.watches)
    const player = createPlayer({ browser: pane.browser, fetchResults: (url) => pane.youtube.fetchResults(url), sleep: async () => {}, audio: { surface: audio.surface, resolve: audio.resolve } })
    const always = (): boolean => true
    const perform = (music: MusicAction, words: string | null = null) => player.perform(music, words, always)
    return { ...pane, audio, player, perform }
  }

  it('music plays the bare stream of the pick: the pane is never navigated', async () => {
    const { browser, audio, player, perform } = withAudio()
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(audio.resolved).toEqual(['aaaaaaaaaaa'])
    expect(audio.loaded).toEqual([{ id: 'aaaaaaaaaaa', stream: 'https://stream.example/aaaaaaaaaaa' }])
    expect(browser.navigations).toEqual([])
    expect(browser.landings).toEqual([])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa' })
    expect(played.failure).toBeUndefined()
    expect(played.shown).toBeUndefined()
    expect(player.road()).toBe('audio')
    expect(player.nowPlaying()).toMatchObject({ id: 'aaaaaaaaaaa', title: 'Song A' })
  })

  it('a video opens the watch page as before, shown, and never looks the stream up', async () => {
    const { browser, audio, player, perform } = withAudio()
    const played = await perform({ kind: 'search', place: 'now', video: true }, 'song a')
    expect(audio.resolved).toEqual([])
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', video: 'aaaaaaaaaaa', shown: true })
    expect(player.road()).toBe('page')
  })

  it('a video queued with nothing playing plays at once on the watch page, shown', async () => {
    const { browser, audio, perform } = withAudio()
    const played = await perform({ kind: 'search', place: 'end', video: true }, 'song a')
    expect(audio.resolved).toEqual([])
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', shown: true })
  })

  it('a video queued next opens on the watch page when its turn comes; the song before it stays on the road', async () => {
    const { browser, audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await perform({ kind: 'search', place: 'front', video: true }, 'song b')).toMatchObject({ answer: 'Queued “Song B” (1st).' })
    expect(browser.landings).toEqual([])
    const skipped = await perform({ kind: 'skip' })
    expect(audio.resolved).toEqual(['aaaaaaaaaaa'])
    expect(browser.landings).toEqual([`${WATCH}bbbbbbbbbbb`])
    expect(skipped).toMatchObject({ answer: 'Skipped to “Song B”.', shown: true })
    expect(player.road()).toBe('page')
  })

  it('a lookup that fails falls back to the watch page, shown: the line is still done', async () => {
    const { browser, audio, player, perform } = withAudio()
    audio.fails.add('aaaaaaaaaaa')
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', shown: true })
    expect(played.failure).toBeUndefined()
    expect(player.road()).toBe('page')
  })

  it('a stream that will not start falls back to the watch page, shown, the stream stopped', async () => {
    const { browser, audio, perform } = withAudio()
    audio.youtube.starts = 'refuses'
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(played).toMatchObject({ answer: 'Playing “Song A”.', shown: true })
    expect(audio.stops).toBeGreaterThan(0)
  })

  it('a verb on a song on the audio road reaches the stream\'s element, never the pane', async () => {
    const { youtube, audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await perform({ kind: 'pause' })).toMatchObject({ answer: 'Paused.' })
    expect(audio.youtube.controls).toContainEqual({ op: 'pause' })
    expect(youtube.controls).toEqual([])
    expect(player.queue().paused).toBe(true)
  })

  it('the poll hears the stream\'s end and opens the next queued song on the same road', async () => {
    const { audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    audio.youtube.endVideo()
    await player.check()
    await player.settled()
    expect(audio.loaded.map((load) => load.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    expect(player.queue().current?.id).toBe('bbbbbbbbbbb')
  })

  it('a queued video reached when the song before it ends opens on the watch page and is shown; a queued song stays on the road, unshown', async () => {
    const { browser, audio, player, perform } = withAudio()
    let shown = 0
    player.onShown(() => {
      shown += 1
    })
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    await perform({ kind: 'search', place: 'end', video: true }, 'song c')
    audio.youtube.endVideo()
    await player.check()
    await player.settled()
    expect(player.queue().current?.id).toBe('bbbbbbbbbbb')
    expect(browser.landings).toEqual([])
    expect(shown).toBe(0)
    audio.youtube.endVideo()
    await player.check()
    await player.settled()
    expect(player.queue().current?.id).toBe('ccccccccccc')
    expect(browser.landings).toEqual([`${WATCH}ccccccccccc`])
    expect(player.road()).toBe('page')
    expect(shown).toBe(1)
  })

  it('a queued song the road cannot play is passed over in the background: the pane, perhaps on a page of its own, is never taken', async () => {
    const { browser, audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'end' }, 'song b')
    await perform({ kind: 'search', place: 'end' }, 'song c')
    audio.fails.add('bbbbbbbbbbb')
    audio.youtube.endVideo()
    await player.check()
    await player.settled()
    expect(browser.navigations).toEqual([])
    expect(browser.landings).toEqual([])
    expect(player.queue().current?.id).toBe('ccccccccccc')
    expect(player.road()).toBe('audio')
  })

  it('a song on the page, then music: the page\'s video is paused as the stream takes over', async () => {
    const { youtube, audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now', video: true }, 'song a')
    await perform({ kind: 'search', place: 'now' }, 'song b')
    expect(youtube.controls).toContainEqual({ op: 'pause' })
    expect(audio.loaded.map((load) => load.id)).toEqual(['bbbbbbbbbbb'])
    expect(player.road()).toBe('audio')
  })

  it('music, then a video: the stream stops as the watch page opens', async () => {
    const { browser, audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await perform({ kind: 'search', place: 'now', video: true }, 'song b')
    expect(audio.stops).toBe(1)
    expect(browser.landings).toEqual([`${WATCH}bbbbbbbbbbb`])
    expect(player.road()).toBe('page')
  })

  it('`show` on the audio road opens the song\'s watch page where the stream stood, the stream stopped', async () => {
    const { browser, audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    audio.youtube.element = { ...audio.youtube.element, currentTime: 42 }
    const shown = await perform({ kind: 'show' })
    expect(shown).toMatchObject({ answer: 'Showing “Song A”.' })
    expect(audio.stops).toBe(1)
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa&t=42s`])
    expect(player.road()).toBe('page')
  })

  it('an idle `stop` pauses the stream too', async () => {
    const { audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(await player.pauseAll()).toBe(true)
    expect(audio.youtube.element.paused).toBe(true)
    expect(player.queue().paused).toBe(true)
  })

  it('the duck lowers the stream\'s element', async () => {
    const { audio, player, perform } = withAudio()
    await perform({ kind: 'search', place: 'now' }, 'song a')
    await player.duck(true)
    expect(audio.youtube.controls.some((op) => op.op === 'duck')).toBe(true)
  })

  it('with no audio road wired every play is the watch page, and the road reads page', async () => {
    const { browser, player, perform } = wired()
    const played = await perform({ kind: 'search', place: 'now' }, 'song a')
    expect(browser.landings).toEqual([`${WATCH}aaaaaaaaaaa`])
    expect(played.shown).toBeUndefined()
    expect(player.road()).toBe('page')
  })
})
