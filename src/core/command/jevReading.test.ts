import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { MediaFacts } from '../browser/snapshot'
import type { Command, CommandPage, CommandRef } from './command'
import { mediaChangesOf } from './mediaOp'
import { commandQuestions, commandState, dismissPhraseQuestions, doneAction, doneFacts, doneLine, hopQuestions, onResults, partialQuestions, readCommandAnswers, readDismissChoice, readProgress, readSteps, readVerdict, refIdentityOf, runnerUpOf, setAsideOf, slotSpans, whereQuestions, type HopContext } from './jevReading'

/** The ten song-op labels the retired Capability layer offered (#374): the media ref's own ops stand for each. */
const RETIRED_LABELS = ['loop', 'loop_off', 'restart', 'pause', 'unpause', 'louder', 'quieter', 'mute', 'unmute', 'volume']

// One Jev call per Command the Local Match cannot settle (#324, ADR
// 0076): the state is the transcript, the page's address and title, the
// text in view (#390) and its numbered refs; three Choices are asked in parallel —
// the verb (an action, never a spoken word, #353), the target among the
// refs plus `none`, the Slot among the transcript's contiguous word spans.
// The top Choice is acted on at any confidence; only `none` as the verb
// drops the Utterance.

const PAGE: CommandPage = {
  url: 'https://example.com/',
  title: 'Example',
  refs: [
    { ref: 1, kind: 'link', label: 'Home', href: 'https://example.com/', inputType: null },
    { ref: 2, kind: 'button', label: 'Sign in', href: null, inputType: null },
    { ref: 3, kind: 'input', label: 'Search', href: null, inputType: 'search' },
  ],
}

function choice(label: string, confidence = 0.9): DecisionChoiceAnswer {
  return { type: 'choice', choice: label, confidence, probabilities: { [label]: confidence } }
}

describe('the state Jev reads', () => {
  it('carries the transcript, the page and the numbered refs with label, kind and href', () => {
    const state = commandState('click the first video', PAGE)
    expect(state).toBe(
      [
        'The user spoke to a web browser: "click the first video"',
        'Page: https://example.com/ — "Example"',
        'Refs (number, kind, label, address, states):',
        '[1] link "Home" https://example.com/',
        '[2] button "Sign in"',
        '[3] input[search] "Search"',
      ].join('\n'),
    )
  })

  it("carries each ref's Ref State after its label, so a stale label is not all Jev knows of a switch", () => {
    const captions = { ref: 4, kind: 'button' as const, label: 'Subtitles/closed captions unavailable', href: null, inputType: null, states: ['pressed=true', 'keyshortcuts="c"'] }
    const menu = { ref: 5, kind: 'link' as const, label: 'Account', href: 'https://example.com/me', inputType: null, states: ['expanded=false'] }
    const page = { ...PAGE, refs: [...PAGE.refs, captions, menu] }
    expect(commandState('turn off captions', page).split('\n').slice(-2)).toEqual([
      '[4] button "Subtitles/closed captions unavailable" pressed=true keyshortcuts="c"',
      '[5] link "Account" https://example.com/me expanded=false',
    ])
    expect(commandQuestions('turn off captions', page).action.options['click-4']).toBe('click [4] button "Subtitles/closed captions unavailable" pressed=true keyshortcuts="c"')
  })

  it("names what a closed trigger opens after its states (#388), so the words behind it are on the card", () => {
    const settings = { ref: 4, kind: 'button' as const, label: 'Settings', href: null, inputType: null, states: ['hasPopup=menu', 'expanded=false'], holds: ['Ambient mode', 'Sleep timer Off'] }
    const state = commandState('turn on ambient mode', { ...PAGE, refs: [...PAGE.refs, settings] })
    expect(state.split('\n').slice(-1)).toEqual(['[4] button "Settings" hasPopup=menu expanded=false menu holds "Ambient mode", "Sleep timer Off"'])
    expect(commandQuestions('turn on ambient mode', { ...PAGE, refs: [...PAGE.refs, settings] }).action.options['click-4']).toBe('click [4] button "Settings" hasPopup=menu expanded=false menu holds "Ambient mode", "Sleep timer Off"')
  })

  it("names the host of the frame a ref was read in after its label (#377, ADR 0081): the embedded video is another site's", () => {
    const play = { ref: 4, kind: 'button' as const, label: 'Play', href: null, inputType: null, frame: 'youtube.com', states: ['pressed=false'] }
    const state = commandState('play the video', { ...PAGE, refs: [...PAGE.refs, play] })
    expect(state.split('\n').slice(-2)).toEqual(['[3] input[search] "Search"', '[4] button "Play" in youtube.com pressed=false'])
  })
})

describe('the text in view in the state Jev reads (#390)', () => {
  it('gains one line under the page: each block quoted, in order, joined by a dot', () => {
    const state = commandState('what is the weather', { ...PAGE, viewportText: ['Clear', 'Gurugram, India', '4 PM 30°', 'Say "hi"'] })
    expect(state.split('\n').slice(1, 3)).toEqual(['Page: https://example.com/ — "Example"', 'Text in view: "Clear" · "Gurugram, India" · "4 PM 30°" · "Say \\"hi\\""'])
  })

  it('carries every block the collect kept, with no cap of its own (#392): the forecast below the masthead stays on the card', () => {
    const blocks = Array.from({ length: 60 }, (_, index) => `${index} `.padEnd(300, 'x'))
    const line = commandState('read it', { ...PAGE, viewportText: blocks }).split('\n')[2]!
    expect(line).toBe(`Text in view: ${blocks.map((block) => JSON.stringify(block)).join(' · ')}`)
  })

  it('leaves out a block that is a label already on the card, a ref or a link further down (#392)', () => {
    const page = { ...PAGE, viewportText: ['Home', 'Sign in', 'News', 'Sunny intervals', 'Sign in to comment'] }
    const hop: HopContext = { hop: 1, visited: ['https://example.com/'], actions: ['search weather'], links: [{ label: 'News', href: 'https://example.com/news' }] }
    expect(commandState('what is the weather', page, hop).split('\n')[4]).toBe('Text in view: "Sunny intervals" · "Sign in to comment"')
  })

  it('says how many blocks in view the collect could not keep, so a cut never reads as all there is (#392)', () => {
    expect(commandState('read it', { ...PAGE, viewportText: ['Clear'], viewportTextMore: 3 }).split('\n')[2]).toBe('Text in view: "Clear" · … (3 more blocks in view)')
    expect(commandState('read it', { ...PAGE, viewportText: ['Clear'], viewportTextMore: 1 }).split('\n')[2]).toBe('Text in view: "Clear" · … (1 more block in view)')
  })

  it('writes no line when no text is in view, or every block is a label on the card', () => {
    expect(commandState('read it', { ...PAGE, viewportText: [] })).toBe(commandState('read it', PAGE))
    expect(commandState('read it', { ...PAGE, viewportText: ['Home', 'Search'] })).toBe(commandState('read it', PAGE))
  })

  it('stands before the dialog line, on a hop as on the first ask', () => {
    const page = { ...PAGE, viewportText: ['Clear'], dialog: { text: 'Sign in', refs: [2] } }
    const hop: HopContext = { hop: 1, visited: ['https://example.com/'], actions: ['search weather'], links: [] }
    expect(commandState('what is the weather', page, hop).split('\n').slice(3, 6)).toEqual(['Page: https://example.com/ — "Example"', 'Text in view: "Clear"', 'A dialog is open: "Sign in"'])
  })
})

describe('the state Jev reads with a dialog open (#336)', () => {
  it('gains one line naming the dialog and its text', () => {
    const state = commandState('exit out of this', { ...PAGE, dialog: { text: 'Sign in to X', refs: [2] } })
    expect(state.split('\n')[2]).toBe('A dialog is open: "Sign in to X"')
  })
})

describe('a playing media element in the state Jev reads (#363, ADR 0079)', () => {
  const SONG = { title: 'Highs and Lows', paused: false, currentTime: 62.4, duration: 124, loop: true, muted: true }

  it('carries one line under the page naming the song, where it is, and its loop and mute', () => {
    const state = commandState('loop the song', { ...PAGE, media: SONG })
    expect(state.split('\n')[2]).toBe('Playing: "Highs and Lows" 1:02 / 2:04, loop on, muted')
    expect(commandState('loop the song', { ...PAGE, media: { ...SONG, paused: true, loop: false, muted: false, duration: Infinity } }).split('\n')[2]).toBe('Paused: "Highs and Lows" 1:02, loop off')
  })

  it('names the one unlabelled media ref by what plays, in the state and the action card — a page with two leaves them as they are', () => {
    const player = { ref: 7, kind: 'media' as const, label: '', href: null, inputType: null }
    const page = { ...PAGE, refs: [...PAGE.refs, player], media: SONG }
    expect(commandState('loop the song', page).split('\n')).toContain('[7] media "Highs and Lows"')
    expect(commandQuestions('loop the song', page).action.options['click-7']).toBe('click [7] media "Highs and Lows"')
    const two = { ...page, refs: [...page.refs, { ...player, ref: 8 }] }
    expect(commandState('loop the song', two).split('\n')).toContain('[7] media ""')
    expect(commandState('loop the song', { ...page, media: undefined }).split('\n')).toContain('[7] media ""')
  })

  it("tells a change the DOM does not show in Done so far: a click that ticked Loop changed something", () => {
    const before = { ...PAGE, media: { ...SONG, loop: false, muted: false } }
    const after = { ...PAGE, media: { ...SONG, currentTime: 63 } }
    const facts = doneFacts(before, after, { changed: false })
    expect(facts).toEqual({ changed: true, media: ['loop turned on', 'muted'] })
    expect(doneLine({ verb: 'click', target: 2, slot: null }, before, facts)).toBe('click "Sign in" (loop turned on; muted)')
    expect(doneFacts(after, { ...after, media: { ...SONG, currentTime: 0.4, paused: true } }, { changed: true })).toEqual({ changed: true, media: ['the video went back to 0:00', 'the video paused'] })
    expect(doneFacts(before, before, { changed: false })).toEqual({ changed: false })
  })

  // Replay 2026-10-22 of a gear click's hop 1: `click ""` left the Verdict's yes at 0.52–0.64, `click [6]` 0.83–0.84, the Mark Ask's wording 0.95–0.97 (#382).
  it('names a target with no words by its number in Done so far, and one the Mark Ask found by the image', () => {
    const page = { ...PAGE, refs: [...PAGE.refs, { ref: 6, kind: 'button' as const, label: '', href: null, inputType: null }] }
    const opened = { changed: true as const, appeared: ['Dark theme'] }
    expect(doneLine({ verb: 'click', target: 6, slot: null }, page, opened)).toBe('click [6] (the address did not change; "Dark theme" appeared)')
    expect(doneLine({ verb: 'click', target: 6, slot: null, marked: true }, page, opened)).toBe(`click [6], the control the user's words named on the image of the page (the address did not change; "Dark theme" appeared)`)
    expect(doneLine({ verb: 'click', target: 2, slot: null, marked: true }, page, opened)).toBe('click "Sign in" (the address did not change; "Dark theme" appeared)')
  })
})

// Replay 2026-10-22 of "Exit out of full screen." hop 1 (turn-mvjdwnew-a), 3× each: click "Full screen (f)" at 0.48–0.66 unchanged; with both lines, none 0.87–0.90 and the Verdict yes 1.00 (#387).
describe('full screen in the state Jev reads (#387)', () => {
  const SONG = { title: 'Highs and Lows', paused: false, currentTime: 62.4, duration: 124, loop: false, muted: false }

  it('carries one line under Playing, or under Page when nothing plays, saying whether the page is in full screen', () => {
    expect(commandState('exit full screen', { ...PAGE, media: SONG, fullScreen: true }).split('\n').slice(1, 4)).toEqual(['Page: https://example.com/ — "Example"', 'Playing: "Highs and Lows" 1:02 / 2:04, loop off', 'Full screen: on'])
    expect(commandState('go full screen', { ...PAGE, fullScreen: false }).split('\n')[2]).toBe('Full screen: off')
    // A page read without the fact says nothing of it.
    expect(commandState('go full screen', PAGE)).not.toContain('Full screen')
  })

  it('names a full-screen change first in the action\'s facts in Done so far, whether the page read as changed or not', () => {
    const before = { ...PAGE, fullScreen: true }
    const after = { ...PAGE, refs: [...PAGE.refs, { ref: 4, kind: 'button' as const, label: 'Guide', href: null, inputType: null }], fullScreen: false }
    const left = doneFacts(before, after, { changed: true }, 2)
    expect(doneLine({ verb: 'click', target: 2, slot: null }, before, left)).toBe('click "Sign in" (the page left full screen; its state did not change; the address did not change; "Guide" appeared)')
    const went = doneFacts({ ...PAGE, fullScreen: false }, { ...PAGE, fullScreen: true }, { changed: false })
    expect(went).toEqual({ changed: true, fullScreen: true })
    expect(doneLine({ verb: 'press', target: null, slot: 'f' }, PAGE, went)).toMatch(/\(the page went full screen\)$/)
    // Unread on either side is no change.
    expect(doneFacts(PAGE, { ...PAGE, fullScreen: true }, { changed: false })).toEqual({ changed: false })
  })
})

describe('Media Ops (#372, ADR 0080): a media ref offers the element\'s own ops on the action card, on any site', () => {
  const FACTS: MediaFacts = { paused: false, ended: false, currentTime: 16.2, duration: 111, volume: 1, muted: false, loop: true, rate: 1, seekable: { start: 0, end: 111 }, tracks: 0, captions: null, hiddenTrack: false, buffering: false, failed: false }
  const VIDEO: CommandRef = { ref: 7, kind: 'media', label: 'YE - HIGHS AND LOWS', href: null, inputType: null, media: FACTS }
  const WATCH: CommandPage = { url: 'https://www.youtube.com/watch?v=kt_0b4RwerY', title: 'YE - HIGHS AND LOWS - YouTube', refs: [{ ref: 1, kind: 'button', label: 'Pause (k)', href: null, inputType: null }, VIDEO, { ref: 8, kind: 'button', label: 'Mute (m)', href: null, inputType: null }] }
  const ELEVEN = ['play', 'pause', 'forward', 'back', 'restart', 'volume', 'mute', 'unmute', 'loop', 'unloop', 'rate']
  const withFacts = (facts: Partial<typeof FACTS>): CommandPage => ({ ...WATCH, refs: WATCH.refs.map((ref) => (ref.ref === 7 ? { ...ref, media: { ...FACTS, ...facts } } : ref)) })

  it('offers every op whatever the element\'s state, each a whole action naming the ref, and the amount Choice beside them', () => {
    const questions = commandQuestions('skip 10 seconds ahead', WATCH)
    const card = questions.action.options
    for (const op of ELEVEN) expect(card).toHaveProperty(`${op}-7`)
    expect(card['forward-7']).toBe('go forward in [7] "YE - HIGHS AND LOWS" by a length of time, the amount Choice saying how far')
    expect(card['back-7']).toBe('go back in [7] "YE - HIGHS AND LOWS" by a length of time, the amount Choice saying how far')
    expect(card['mute-7']).toBe('mute [7] "YE - HIGHS AND LOWS"')
    expect(card['unmute-7']).toBe('unmute [7] "YE - HIGHS AND LOWS"')
    // Both of a pair, whatever the state: withholding the inverse sends Jev to the page's toggle (ADR 0080).
    const muted = commandQuestions('mute the video', withFacts({ muted: true, loop: false, paused: true })).action.options
    for (const op of ELEVEN) expect(muted).toHaveProperty(`${op}-7`)
    // No op on a button, and none without text tracks.
    for (const label of Object.keys(card)) expect(label).not.toMatch(/^(play|pause|forward|back|restart|volume|mute|unmute|loop|unloop|rate|captions|uncaptions)-[18]$/)
    expect(card).not.toHaveProperty('captions-7')
    expect(questions).toHaveProperty('amount')
    expect(Object.keys((questions as { amount: { options: Record<string, string> } }).amount.options)).toEqual(['words', 'moment', 'little', 'chunk', 'lot', 'half', 'end'])
  })

  it('withholds by ability alone: the captions pair only with text tracks, the seeks only with a seekable range', () => {
    const tracked = commandQuestions('turn on captions', withFacts({ tracks: 2, captions: null })).action.options
    expect(tracked['captions-7']).toBe('turn captions (subtitles) on for [7] "YE - HIGHS AND LOWS"')
    expect(tracked['uncaptions-7']).toBe('turn captions off for [7] "YE - HIGHS AND LOWS"')
    const stream = commandQuestions('skip ahead', withFacts({ seekable: null })).action.options
    for (const op of ['forward', 'back', 'restart']) expect(stream).not.toHaveProperty(`${op}-7`)
    for (const op of ['play', 'pause', 'volume', 'mute', 'unmute', 'loop', 'unloop', 'rate']) expect(stream).toHaveProperty(`${op}-7`)
  })

  it('offers no op, and asks no amount, on a page with no media ref — nor on a media ref read without its facts', () => {
    const none = commandQuestions('skip 10 seconds ahead', PAGE)
    expect(Object.keys(none.action.options).some((label) => /^(play|pause|forward)-\d+$/.test(label))).toBe(false)
    expect(none).not.toHaveProperty('amount')
    const bare = commandQuestions('pause it', { ...WATCH, refs: [{ ...VIDEO, media: undefined }] })
    expect(bare.action.options).not.toHaveProperty('pause-7')
    expect(bare).not.toHaveProperty('amount')
    expect(hopQuestions('skip ahead', WATCH, { hop: 1, visited: [WATCH.url], actions: [], links: [] })).toHaveProperty('amount')
    expect(partialQuestions('skip ahead', WATCH)).toHaveProperty('amount')
  })

  it("carries the element's state on its ref line: playing, elapsed/duration or live, volume or muted, loop, speed when not normal, captions with text tracks, buffering, failed", () => {
    expect(commandState('mute it', WATCH).split('\n')).toContain('[7] media "YE - HIGHS AND LOWS" playing 0:16/1:51 volume 100% loop on')
    const line = (facts: Partial<typeof FACTS>): string => commandState('mute it', withFacts(facts)).split('\n').find((l) => l.startsWith('[7] '))!
    expect(line({ paused: true, muted: true, loop: false, rate: 1.5, tracks: 2, captions: 'en' })).toBe('[7] media "YE - HIGHS AND LOWS" paused 0:16/1:51 muted loop off speed 1.5× captions en')
    expect(line({ duration: Infinity, seekable: { start: 100, end: 3700 }, currentTime: 3690, tracks: 1, buffering: true })).toBe('[7] media "YE - HIGHS AND LOWS" playing live 1:01:30 volume 100% loop on captions off buffering')
    expect(line({ ended: true, failed: true })).toBe('[7] media "YE - HIGHS AND LOWS" ended 0:16/1:51 volume 100% loop on failed')
    // A track hidden with none showing says nothing (#389): on at Vimeo and BBC, which draw their own, off at Plyr.
    expect(line({ tracks: 1, captions: null, hiddenTrack: true })).toBe('[7] media "YE - HIGHS AND LOWS" playing 0:16/1:51 volume 100% loop on')
    expect(line({ tracks: 2, captions: 'en', hiddenTrack: false })).toBe('[7] media "YE - HIGHS AND LOWS" playing 0:16/1:51 volume 100% loop on captions en')
    // A change tells the same words: showing to hidden says nothing; to every track disabled, captions off.
    const tracked = { ...FACTS, tracks: 1, captions: 'en' }
    expect(mediaChangesOf(tracked, { ...tracked, captions: null, hiddenTrack: true })).toEqual([])
    expect(mediaChangesOf(tracked, { ...tracked, captions: null })).toEqual(['captions off'])
    expect(mediaChangesOf({ ...tracked, captions: null, hiddenTrack: true }, tracked)).toEqual(['captions en'])
    // The Ref State the tree gave comes first, as on every ref; the card's click line carries the same.
    const stated = { ...WATCH, refs: WATCH.refs.map((ref) => (ref.ref === 7 ? { ...ref, states: ['focused'] } : ref)) }
    expect(commandQuestions('mute it', stated).action.options['click-7']).toBe('click [7] media "YE - HIGHS AND LOWS" focused playing 0:16/1:51 volume 100% loop on')
  })

  it("carries its Player Switches on its line, each by its own label and on or off, naming nothing itself; never on the Playing: line (#389)", () => {
    const switches = [{ ref: 12, label: 'Subtitles/closed captions unavailable', on: true }, { ref: 19, label: 'Dislike this video', on: false }]
    const page: CommandPage = { ...WATCH, refs: WATCH.refs.map((ref) => (ref.ref === 7 ? { ...ref, switches } : ref)), media: { title: 'YE - HIGHS AND LOWS', paused: false, currentTime: 16, duration: 111, loop: true, muted: false } }
    const state = commandState('disable captions', page).split('\n')
    expect(state).toContain('[7] media "YE - HIGHS AND LOWS" playing 0:16/1:51 volume 100% loop on [12] "Subtitles/closed captions unavailable" on, [19] "Dislike this video" off')
    expect(state.filter((l) => /^(Playing|Paused):/.test(l)).join('\n')).not.toMatch(/Subtitles/)
    expect(commandQuestions('disable captions', page).action.options['click-7']).toMatch(/loop on \[12\] "Subtitles\/closed captions unavailable" on, \[19\] "Dislike this video" off$/)
    // No switches, nothing more on the line.
    expect(commandState('disable captions', { ...page, refs: WATCH.refs }).split('\n')).toContain('[7] media "YE - HIGHS AND LOWS" playing 0:16/1:51 volume 100% loop on')
  })

  it('reads an op label as a media Command on that ref: a seek with its rung and seconds, a volume or a speed with its level', () => {
    const read = (label: string, text: string, amount?: string) => readCommandAnswers({ action: choice(label), slot: choice('none'), ...(amount !== undefined ? { amount: choice(amount) } : {}) }, text, WATCH)
    expect(read('pause-7', 'pause the video', 'words')).toEqual({ verb: 'media', target: 7, slot: null, mediaOp: { op: 'pause' } })
    expect(read('forward-7', 'skip 10 seconds ahead', 'words')).toEqual({ verb: 'media', target: 7, slot: null, mediaOp: { op: 'forward', rung: 'words', seconds: 10 } })
    expect(read('back-7', 'go back a minute', 'words')).toMatchObject({ mediaOp: { op: 'back', rung: 'words', seconds: 60 } })
    expect(read('forward-7', 'skip ahead two minutes', 'words')).toMatchObject({ mediaOp: { op: 'forward', rung: 'words', seconds: 120 } })
    expect(read('back-7', 'go back to the start', 'end')).toMatchObject({ mediaOp: { op: 'back', rung: 'end', seconds: 16.2 } })
    expect(read('forward-7', 'skip to the end', 'end')).toMatchObject({ mediaOp: { op: 'forward', rung: 'end', seconds: 94.8 } })
    expect(read('forward-7', 'skip half of it', 'half')).toMatchObject({ mediaOp: { op: 'forward', rung: 'half', seconds: 55.5 } })
    expect(read('forward-7', 'skip a bit', 'chunk')).toMatchObject({ mediaOp: { op: 'forward', rung: 'chunk', seconds: 11.1 } })
    // A `words` rung with no number in the words falls back to a little, told as such; no amount asked reads as a little too.
    expect(read('forward-7', 'skip ahead', 'words')).toMatchObject({ mediaOp: { op: 'forward', rung: 'little', seconds: 5.55 } })
    expect(read('forward-7', 'skip ahead')).toMatchObject({ mediaOp: { op: 'forward', rung: 'little' } })
    expect(read('volume-7', 'set the volume to 30')).toEqual({ verb: 'media', target: 7, slot: null, mediaOp: { op: 'volume', to: 30 } })
    expect(read('volume-7', 'turn it down')).toMatchObject({ mediaOp: { op: 'volume', to: 90 } })
    expect(read('volume-7', 'turn it down by 25')).toMatchObject({ mediaOp: { op: 'volume', to: 75 } })
    expect(read('rate-7', 'play it at 1.5x')).toMatchObject({ mediaOp: { op: 'rate', to: 1.5 } })
    expect(read('rate-7', 'slow it down')).toMatchObject({ mediaOp: { op: 'rate', to: 0.75 } })
    expect(read('rate-7', 'speed it up')).toMatchObject({ mediaOp: { op: 'rate', to: 1.25 } })
    expect(read('forward-7', 'skip ahead 1 minute 30 seconds', 'words')).toMatchObject({ mediaOp: { op: 'forward', rung: 'words', seconds: 90 } })
    expect(read('loop-7', 'loop it')).toMatchObject({ mediaOp: { op: 'loop' } })
    expect(read('restart-7', 'start it again')).toMatchObject({ mediaOp: { op: 'restart' } })
  })

  it('reads an op the element cannot take, or on no media ref, as no Command — and a volume or speed the words give no level for', () => {
    const read = (label: string, text: string, page: CommandPage = WATCH) => readCommandAnswers({ action: choice(label), slot: choice('none'), amount: choice('words') }, text, page)
    expect(read('forward-7', 'skip ahead', withFacts({ seekable: null })).verb).toBe('none')
    expect(read('captions-7', 'captions on').verb).toBe('none')
    expect(read('captions-7', 'captions on', withFacts({ tracks: 1 }))).toMatchObject({ verb: 'media', mediaOp: { op: 'captions' } })
    expect(read('pause-1', 'pause').verb).toBe('none')
    expect(read('pause-9', 'pause').verb).toBe('none')
    expect(read('volume-7', 'the volume').verb).toBe('none')
    expect(read('rate-7', 'the speed').verb).toBe('none')
  })

  it("gives the song's ops one line each, the media ref's own: the Player has none beside them; a song to play, the Queue's walk and show are its Appliance Verbs (#374)", () => {
    const appliance = { queued: true }
    const withVideo = Object.keys(commandQuestions('loop the song', WATCH, undefined, { appliance }).action.options)
    for (const op of RETIRED_LABELS) expect(withVideo).not.toContain(op)
    expect(withVideo).toEqual(expect.arrayContaining(['play', 'play_next', 'queue', 'skip', 'previous', 'show', 'loop-7', 'pause-7']))
    expect(Object.keys(hopQuestions('loop the song', WATCH, { hop: 1, visited: [], actions: [], links: [] }, { appliance }).action.options)).not.toContain('loop')
    // With no media ref read (the pane blank), no line loops or pauses at all: the song's ops are its ref's alone.
    const noVideo = Object.keys(commandQuestions('loop the song', { ...PAGE, media: { title: 'Highs and Lows', paused: false, currentTime: 3, duration: 100, loop: false, muted: false } }, undefined, { appliance }).action.options)
    for (const op of RETIRED_LABELS) expect(noVideo).not.toContain(op)
    expect(noVideo).toEqual(expect.arrayContaining(['skip', 'show']))
  })

  it("says beside the ops that words saying click, press or tap name a button on the page, never the element's own op; a card with no ops says nothing of it (#374)", () => {
    expect(commandQuestions('click play', WATCH).action.instructions).toMatch(/click, press or tap .* never an op on the video or audio itself\.$/)
    expect(commandQuestions('click play', PAGE).action.instructions).not.toMatch(/click, press or tap/)
  })

  it('orders the card refs, then media ops, then opens, then menus under the cap: the menus give way before the ops', () => {
    // 232 clicks and the eleven ops fill the 255 exactly beside none and the eleven ref-less verbs: nothing is left for the link or a menu.
    const refs: CommandRef[] = [...Array.from({ length: 231 }, (_, n) => ({ ref: n + 1, kind: 'button' as const, label: `Ref ${n + 1}`, href: null, inputType: null })), { ...VIDEO, ref: 232 }]
    const labels = Object.keys(hopQuestions('pause it', { ...WATCH, refs }, { hop: 1, visited: [], actions: [], links: [{ label: 'More', href: 'https://www.youtube.com/more' }] }).action.options)
    expect(labels.length).toBe(255)
    expect(labels.filter((label) => label.startsWith('click-'))).toHaveLength(232)
    expect(labels).toEqual(expect.arrayContaining(['pause-232', 'rate-232']))
    expect(labels).not.toContain('open-1')
    expect(labels.some((label) => label.startsWith('menu-'))).toBe(false)
    expect(labels.indexOf('pause-232')).toBeGreaterThan(labels.indexOf('click-232'))
    // One ref fewer, and the link takes the room before any menu does.
    expect(Object.keys(hopQuestions('pause it', { ...WATCH, refs: refs.slice(1) }, { hop: 1, visited: [], actions: [], links: [{ label: 'More', href: 'https://www.youtube.com/more' }] }).action.options)).toContain('open-1')
  })

  it('AC4: "Done so far" tells what an action changed on a media ref from its own facts — elapsed, paused, muted, loop — and the page\'s media line says nothing twice', () => {
    const after = withFacts({ currentTime: 26.2, muted: true, loop: false, paused: true })
    const facts = doneFacts(WATCH, after, { changed: false }, 7)
    // The ref's Ref State did not flip, so no state clause: the element's own facts are what changed.
    expect(facts).toEqual({ changed: true, media: ['paused', '0:16 → 0:26', 'muted', 'loop off'] })
    expect(doneLine({ verb: 'click', target: 7, slot: null }, WATCH, facts)).toBe('click "YE - HIGHS AND LOWS" (paused; 0:16 → 0:26; muted; loop off)')
    // The page's own media line (#363) tells the same change once, in the ref's words, when the acted ref is the element.
    const song = { title: 'YE - HIGHS AND LOWS', paused: false, currentTime: 16.2, duration: 111, loop: true, muted: false }
    expect(doneFacts({ ...WATCH, media: song }, { ...after, media: { ...song, currentTime: 26.2, muted: true, loop: false, paused: true } }, { changed: false }, 7)).toMatchObject({ media: ['paused', '0:16 → 0:26', 'muted', 'loop off'] })
    // Time running on between two reads is a fact of the element, as the Verdict reads it; a ref that did not move is not told as changed.
    expect(doneFacts(WATCH, WATCH, { changed: false }, 7)).toEqual({ changed: false })
    expect(doneLine({ verb: 'media', target: 7, slot: null, mediaOp: { op: 'forward', rung: 'words', seconds: 10 } }, WATCH, { changed: true, media: ['0:16 → 0:26'] })).toBe('skip forward 10 s "YE - HIGHS AND LOWS" (0:16 → 0:26)')
  })

  it('a Media Op is set aside by its card label (ruling 8, #373): forward-7 goes, the ref\'s click and its other ops stay, and its reading is no Command', () => {
    const aside = setAsideOf({ verb: 'media', target: 7, slot: null, mediaOp: { op: 'forward', rung: 'words', seconds: 10 } }, WATCH)
    expect(aside).toEqual({ act: 'forward', ...refIdentityOf(VIDEO, WATCH) })
    const hop: HopContext = { hop: 1, visited: [WATCH.url], actions: ['skip forward 10 s "YE - HIGHS AND LOWS" (nothing changed)'], links: [], setAside: [aside!] }
    const card = Object.keys(hopQuestions('skip ahead', WATCH, hop).action.options)
    expect(card).not.toContain('forward-7')
    expect(card).toEqual(expect.arrayContaining(['click-7', 'back-7', 'pause-7', 'menu-7']))
    expect(readCommandAnswers({ action: choice('forward-7'), slot: choice('none'), amount: choice('words'), outcome: choice('not_yet') }, 'skip ahead', WATCH, hop).verb).toBe('none')
  })

  it('maps a fraction onto a live stream\'s seekable window', () => {
    const live = withFacts({ duration: Infinity, seekable: { start: 1000, end: 1600 }, currentTime: 1500 })
    const read = (label: string, amount: string) => readCommandAnswers({ action: choice(label), slot: choice('none'), amount: choice(amount) }, 'go back a bit', live)
    expect(read('back-7', 'chunk')).toMatchObject({ mediaOp: { op: 'back', rung: 'chunk', seconds: 60 } })
    expect(read('back-7', 'end')).toMatchObject({ mediaOp: { op: 'back', rung: 'end', seconds: 500 } })
    expect(read('forward-7', 'end')).toMatchObject({ mediaOp: { op: 'forward', rung: 'end', seconds: 100 } })
  })
})

describe('the questions', () => {
  it('asks the action card among the refs and the ref-less verbs, the Slot among the word spans', () => {
    const questions = commandQuestions('type hello in search', { ...PAGE, url: 'about:blank' })
    expect(Object.keys(questions)).toEqual(['action', 'slot', 'extent'])
    expect(questions.action.type).toBe('choice')
    expect(Object.keys(questions.action.options)).toEqual([
      'click-1',
      'click-2',
      'type-3',
      'click-3',
      'menu-1',
      'menu-2',
      'menu-3',
      'navigate',
      'search',
      'scroll_up',
      'scroll_down',
      'back',
      'forward',
      'reload',
      'press',
      'read',
      'clear',
      'stop',
      'none',
    ])
    expect(questions.action.options['click-2']).toBe('click [2] button "Sign in"')
    expect(Object.keys(questions.slot.options)).toEqual(['none', 's0-0', 's0-1', 's0-2', 's0-3', 's1-1', 's1-2', 's1-3', 's2-2', 's2-3', 's3-3'])
    expect(questions.slot.options['s1-1']).toBe('hello')
    expect(questions.slot.options['s0-3']).toBe('type hello in search')
  })

  it('keeps the Slot spans under the Choice cap by shortening the longest span, never by dropping words', () => {
    const long = Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ')
    const spans = slotSpans(long)
    expect(spans.length).toBeLessThanOrEqual(254)
    // Every single word is a span; the longest spans are the ones left out.
    expect(spans.filter((span) => span.start === span.end)).toHaveLength(40)
    expect(Math.max(...spans.map((span) => span.end - span.start + 1))).toBeLessThan(40)
  })
})

describe('the Where Ask (#379, ADR 0082): the same action card, asked where the thing the words name would be', () => {
  const SITE = { ...PAGE, url: 'https://www.youtube.com/watch?v=x' }

  it('offers every option the first card offered, with the question and its none changed — the where beside it, never the steps', () => {
    const first = commandQuestions('turn on ambient mode and loop it', SITE)
    const where = whereQuestions('turn on ambient mode and loop it', SITE)
    // The Verdict rides the Where Ask (#394), worded as a hop's.
    expect(Object.keys(where)).toEqual(['action', 'slot', 'extent', 'where', 'outcome'])
    expect(where.outcome).toEqual(hopQuestions('turn on ambient mode and loop it', SITE, { hop: 1, visited: [], actions: [], links: [] }).outcome)
    expect(Object.keys(where.action.options)).toEqual(Object.keys(first.action.options))
    expect(where.action.options['click-2']).toBe(first.action.options['click-2'])
    expect(where.action.options.search).toBe(first.action.options.search)
    expect(where.action.options.none).toBe('a remark or noise, nothing to look for')
    expect(where.action.instructions).toBe(
      'The words are a command for something this page does not show. Which one action would reveal it, or find it? Each option is a whole action: a numbered ref with what is done to it, or a verb that needs no ref. Choose none when the words are a remark or noise, nothing to look for.',
    )
    expect(where.slot).toEqual(first.slot)
  })

  it('leaves the first ask as it was measured', () => {
    const first = commandQuestions('turn on ambient mode', SITE)
    expect(first.action.instructions).toMatch(/^Which one action does the browser take for the user's words\? .* Choose none when the words are not a command\.$/)
    expect(first.action.options.none).toBe('not a command for this page: a remark, a question, a name, noise')
  })
})

describe('reading the answers', () => {
  it('acts on the top choices: the action, the span', () => {
    expect(readCommandAnswers({ action: choice('type-3', 0.4), slot: choice('s1-1', 0.5) }, 'type hello in search', PAGE)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
  })

  it('drops the Utterance only on a none action', () => {
    expect(readCommandAnswers({ action: choice('none', 0.2), slot: choice('s0-0') }, 'what time is it', PAGE)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('ignores the answers an action does not need', () => {
    expect(readCommandAnswers({ action: choice('scroll_down'), slot: choice('s0-1') }, 'scroll down please', PAGE)).toEqual({ verb: 'scroll_down', target: null, slot: null })
    expect(readCommandAnswers({ action: choice('back'), slot: choice('none') }, 'go back', PAGE)).toEqual({ verb: 'back', target: null, slot: null })
    expect(readCommandAnswers({ action: choice('click-2'), slot: choice('s0-1') }, 'click sign in', PAGE)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('reads press through the Slot, Enter when the Slot names no key', () => {
    expect(readCommandAnswers({ action: choice('press'), slot: choice('s1-1') }, 'press escape', PAGE)).toMatchObject({ verb: 'press', slot: 'escape', key: { key: 'Escape' }, times: 1 })
    expect(readCommandAnswers({ action: choice('press'), slot: choice('none') }, 'submit it', PAGE)).toMatchObject({ verb: 'press', key: { key: 'Enter' } })
  })

  it('falls back to the words after the verb when the Slot answers none for an action that needs one', () => {
    expect(readCommandAnswers({ action: choice('navigate'), slot: choice('none') }, 'please open youtube', PAGE)).toEqual({ verb: 'search', target: null, slot: 'please open youtube' })
    expect(readCommandAnswers({ action: choice('navigate'), slot: choice('none') }, 'open youtube', PAGE)).toEqual({ verb: 'navigate', target: null, slot: 'youtube' })
    expect(readCommandAnswers({ action: choice('type-3'), slot: choice('none') }, 'type hello', PAGE)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
  })

  it('offers the verbs as actions, never a spoken word (#353): navigate and search, no open', () => {
    const options = commandQuestions('open the tweet', PAGE).action.options
    expect(options).toHaveProperty('navigate')
    expect(options).toHaveProperty('search')
    expect(options).not.toHaveProperty('open')
  })

  it('navigates an address-shaped navigate, and searches words with no ref named off a site', () => {
    expect(readCommandAnswers({ action: choice('navigate'), slot: choice('none') }, 'open youtube', PAGE)).toEqual({ verb: 'navigate', target: null, slot: 'youtube' })
    expect(readCommandAnswers({ action: choice('search'), slot: choice('none') }, "open elon musk's profile", { ...PAGE, url: 'about:blank' })).toEqual({ verb: 'search', target: null, slot: "elon musk's profile" })
  })

  it('a search of a bare word is a search, not its .com: Jev said search', () => {
    expect(readCommandAnswers({ action: choice('search'), slot: choice('s1-1') }, 'search rust', { ...PAGE, url: 'about:blank' })).toEqual({ verb: 'search', target: null, slot: 'rust' })
  })

  it('drops a click on a page with no refs', () => {
    expect(readCommandAnswers({ action: choice('click-1'), slot: choice('none') }, 'click it', { ...PAGE, refs: [] })).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('offers a menu per ref with its description, and reads menu-N as a menu on that ref (#363)', () => {
    expect(commandQuestions('loop the video', PAGE).action.options['menu-2']).toBe('right-click [2] to open its menu')
    expect(readCommandAnswers({ action: choice('menu-2'), slot: choice('none') }, 'loop the video', PAGE)).toEqual({ verb: 'menu', target: 2, slot: null })
  })
})

describe('the hop reading (#328, ADR 0076 amendment)', () => {
  const SEARCH: CommandPage = {
    url: 'https://duckduckgo.com/?q=latest+elon+musk+tweet',
    title: 'latest elon musk tweet at DuckDuckGo',
    refs: [
      { ref: 1, kind: 'link', label: 'DuckDuckGo home', href: 'https://duckduckgo.com/', inputType: null },
      { ref: 2, kind: 'input', label: 'Search', href: null, inputType: 'search' },
      { ref: 3, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const LINKS = [
    { label: 'DuckDuckGo home', href: 'https://duckduckgo.com/' },
    { label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk' },
    { label: 'Settings', href: 'https://duckduckgo.com/settings' },
    { label: 'Elon Musk - Wikipedia', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FElon_Musk' },
    { label: 'Elon Musk news', href: 'https://www.reuters.com/elon' },
  ]

  it('offers no done, at hop 0 or a later hop: done-ness is the Verdict\'s alone (#370)', () => {
    expect(commandQuestions('pull up the latest elon musk tweet', PAGE).action.options).not.toHaveProperty('done')
    expect(commandQuestions('pull up the latest elon musk tweet', SEARCH, { hop: 1, visited: [], actions: [], links: [] }).action.options).not.toHaveProperty('done')
  })

  it("offers the whole page's result links on a search landing — not the engine's own, not a ref's again", () => {
    const hop = { hop: 1, visited: [SEARCH.url], actions: ['open latest elon musk tweet'], links: LINKS }
    const options = commandQuestions('pull up the latest elon musk tweet', SEARCH, hop).action.options
    expect(Object.keys(options).filter((label) => /^(click|type|open)-/.test(label))).toEqual(['click-1', 'type-2', 'click-2', 'click-3', 'open-1', 'open-2'])
    expect(options['open-1']).toBe('open result link "Elon Musk - Wikipedia" https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FElon_Musk')
    expect(options['open-2']).toBe('open result link "Elon Musk news" https://www.reuters.com/elon')
    // A result link below the fold is opened at its address.
    expect(readCommandAnswers({ action: choice('open-2'), slot: choice('none'), outcome: choice('not_yet') }, 'pull up the latest elon musk tweet', SEARCH, hop)).toEqual({
      verb: 'navigate',
      target: null,
      slot: 'https://www.reuters.com/elon',
    })
  })

  it('offers every page link further down off a search landing, so a link below the fold costs no scroll (owner\'s rule 2026-10-19)', () => {
    const hop = { hop: 1, visited: [], actions: [], links: LINKS }
    const options = commandQuestions('click it', PAGE, hop).action.options
    expect(Object.keys(options).slice(0, 4)).toEqual(['click-1', 'click-2', 'type-3', 'click-3'])
    expect(Object.keys(options).some((label) => label.startsWith('open-'))).toBe(true)
    expect(commandState('click it', PAGE, hop)).toContain('Links further down the page (name, address):')
  })

  it('never offers an address already visited in the Task, a redirect to one included', () => {
    const hop = { hop: 2, visited: [SEARCH.url, 'https://x.com/elonmusk', 'https://en.wikipedia.org/wiki/Elon_Musk'], actions: [], links: LINKS }
    const options = commandQuestions('pull up the latest elon musk tweet', SEARCH, hop).action.options
    expect(Object.keys(options).filter((label) => /^(click|type|open)-/.test(label))).toEqual(['click-1', 'type-2', 'click-2', 'open-1'])
    expect(options['open-1']).toContain('reuters')
  })

  it("keeps a ref whose address is this page's: an href=\"#\" control or an anchor leads nowhere visited (2026-10-21)", () => {
    const watch: CommandPage = {
      url: 'https://example.com/watch?v=1',
      title: 'Watch',
      refs: [
        { ref: 1, kind: 'link', label: 'Show more', href: 'https://example.com/watch?v=1#', inputType: null },
        { ref: 2, kind: 'link', label: 'Comments', href: 'https://example.com/watch?v=1#comments', inputType: null },
        { ref: 3, kind: 'link', label: 'Home', href: 'https://example.com/', inputType: null },
        { ref: 4, kind: 'link', label: 'Next video', href: 'https://example.com/watch?v=2', inputType: null },
      ],
    }
    const hop = { hop: 1, visited: ['https://example.com/', watch.url], actions: [], links: [] }
    const options = Object.keys(commandQuestions('show more', watch, hop).action.options)
    expect(options).toContain('click-1')
    expect(options).toContain('click-2')
    expect(options).toContain('click-4')
    // The page before is still off the card.
    expect(options).not.toContain('click-3')
  })

  it('carries the hop number, the addresses visited and the actions taken in the state', () => {
    const hop = { hop: 1, visited: [SEARCH.url], actions: ['open latest elon musk tweet'], links: LINKS }
    const state = commandState('pull up the latest elon musk tweet', SEARCH, hop)
    expect(state).toContain('This is step 2 of the task. Done so far: open latest elon musk tweet')
    expect(state).toContain(`Pages visited: ${SEARCH.url}`)
    expect(state).toContain('Result links further down the page (name, address):')
    expect(state).toContain('[link-2] link "Elon Musk news" https://www.reuters.com/elon')
  })
})

describe('open past the first hop (#332)', () => {
  const SEARCH: CommandPage = {
    url: "https://duckduckgo.com/?q=elon+musk's+latest+tweet",
    title: "elon musk's latest tweet at DuckDuckGo",
    refs: [
      { ref: 1, kind: 'link', label: 'DuckDuckGo home', href: 'https://duckduckgo.com/', inputType: null },
      { ref: 2, kind: 'input', label: 'Search', href: null, inputType: 'search' },
      { ref: 3, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const TEXT = "Open elon musk's latest tweet"
  const hop = { hop: 1, visited: [SEARCH.url], actions: ["Searched the web for “elon musk's latest tweet”"], links: [] }
  // The action card a later hop gives: search on top, two results close behind.
  const action = (probabilities: Record<string, number>, top = 'search'): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })

  it('opens the most probable offered click on the card, never searching the words again', () => {
    expect(readCommandAnswers({ action: action({ search: 0.63, 'click-3': 0.17, 'click-1': 0.16 }), slot: choice('s1-4') }, TEXT, SEARCH, hop)).toEqual({ verb: 'click', target: 3, slot: null })
  })

  it('opens a result link further down at its address when it ranks above every ref', () => {
    const links = [{ label: 'Elon Musk news', href: 'https://www.reuters.com/elon' }]
    expect(readCommandAnswers({ action: action({ search: 0.6, 'open-1': 0.3, 'click-3': 0.1 }), slot: choice('s1-4') }, TEXT, SEARCH, { ...hop, links })).toEqual({ verb: 'navigate', target: null, slot: 'https://www.reuters.com/elon' })
  })

  it('has no next step when the card gives no offered click or open any probability', () => {
    expect(readCommandAnswers({ action: action({ search: 1 }), slot: choice('s1-4') }, TEXT, SEARCH, hop)).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers({ action: action({ search: 1, 'click-3': 0 }), slot: choice('s1-4') }, TEXT, SEARCH, hop)).toEqual({ verb: 'none', target: null, slot: null })
    // A visited address is not offered, so its probability counts for nothing.
    const visited = { ...hop, visited: [SEARCH.url, 'https://x.com/elonmusk'] }
    expect(readCommandAnswers({ action: action({ search: 0.8, 'click-3': 0.2 }), slot: choice('s1-4') }, TEXT, SEARCH, visited)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('leaves hop 0 searching the words off a site, and an address navigated at any hop', () => {
    const answers = { action: action({ search: 0.63, 'click-3': 0.17 }), slot: choice('s1-4') }
    expect(readCommandAnswers(answers, TEXT, SEARCH)).toEqual({ verb: 'search', target: null, slot: "elon musk's latest tweet" })
    expect(readCommandAnswers({ action: choice('navigate'), slot: choice('s1-1') }, 'open x.com/elonmusk', SEARCH, hop)).toEqual({ verb: 'navigate', target: null, slot: 'x.com/elonmusk' })
  })
})

describe('open past the first hop off a search landing (#342): with no click named, the Task ends where it stands', () => {
  // The logged hop 2 of #340's live run: the Task had reached the profile
  // the user asked for, Jev read open over done and named no target.
  const PROFILE: CommandPage = {
    url: 'https://x.com/realDonaldTrump',
    title: 'Donald J. Trump (@realDonaldTrump) / X',
    refs: [
      { ref: 1, kind: 'link', label: 'DonaldJTrump.com', href: 'https://www.donaldjtrump.com/', inputType: null },
      { ref: 2, kind: 'link', label: 'Search', href: 'https://x.com/explore', inputType: null },
    ],
  }
  const TEXT = 'go to donald trumps profile'
  const hop = { hop: 2, visited: ['https://x.com/home', 'https://x.com/realDonaldTrump'], actions: [], links: [], searched: ['x.com'] }
  const action = (probabilities: Record<string, number>, top = 'search'): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })

  it('reads search and search terms on top as no next step, though a click has some probability', () => {
    expect(readCommandAnswers({ action: action({ search: 0.99, 'click-1': 0.01 }), slot: choice('s2-4') }, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('reads a top click that names nothing offered as no next step too, the click under it not reached for', () => {
    expect(readCommandAnswers({ action: action({ 'click-9': 0.6, 'click-2': 0.3 }, 'click-9'), slot: choice('s2-4') }, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('still clicks a ref Jev tops the card with, off a search landing as on one', () => {
    expect(readCommandAnswers({ action: action({ 'click-2': 0.7, search: 0.3 }, 'click-2'), slot: choice('s2-4') }, TEXT, PROFILE, hop)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('counts a site’s own search page as a search landing: the most probable offered result is opened there', () => {
    const SITE_SEARCH: CommandPage = { ...PROFILE, url: 'https://x.com/search?q=donald+trump', title: 'donald trump - Search / X' }
    expect(readCommandAnswers({ action: action({ search: 0.8, 'click-1': 0.15 }), slot: choice('s2-4') }, TEXT, SITE_SEARCH, hop)).toEqual({ verb: 'click', target: 1, slot: null })
    const links = [{ label: 'donaldjtrump.com', href: 'https://www.donaldjtrump.com/news' }]
    expect(readCommandAnswers({ action: action({ search: 0.7, 'open-1': 0.2, 'click-1': 0.1 }), slot: choice('s2-4') }, TEXT, SITE_SEARCH, { ...hop, links })).toEqual({
      verb: 'navigate',
      target: null,
      slot: 'https://www.donaldjtrump.com/news',
    })
  })
})

describe("a Web Engine's landing read before its results drew (2026-10-19): a hop opens a result or nothing, never the engine's chrome", () => {
  // The logged hop 1 of "Open Elon Musk's latest tweet": DuckDuckGo's page
  // some 700 ms after the search, its script yet to draw a result. Jev read
  // search with none on top and the Search button at 0.03 — and the hop
  // clicked Search, which re-submitted the words, hop after hop to the cap.
  const EMPTY: CommandPage = {
    url: "https://duckduckgo.com/?q=Elon+Musk%27s+latest+tweet",
    title: "Elon Musk's latest tweet at DuckDuckGo",
    refs: [
      { ref: 1, kind: 'link', label: 'DuckDuckGo home DuckDuckGo', href: 'https://duckduckgo.com/', inputType: null },
      { ref: 2, kind: 'input', label: 'Search privately', href: null, inputType: 'text' },
      { ref: 3, kind: 'button', label: 'Search', href: null, inputType: null },
      { ref: 5, kind: 'link', label: 'All', href: "https://duckduckgo.com/?q=Elon+Musk%27s+latest+tweet&ia=web", inputType: null },
    ],
  }
  const DRAWN: CommandPage = { ...EMPTY, refs: [...EMPTY.refs, { ref: 7, kind: 'link', label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk', inputType: null }] }
  const TEXT = "Open Elon Musk's latest tweet"
  // The footer's links leave the engine's host, so the whole page offers them as results.
  const footer = [{ label: 'iOS Browser', href: 'https://apps.apple.com/app/duckduckgo-private-browser/id663592361' }]
  const hop = { hop: 1, visited: [EMPTY.url], actions: ["search Elon Musk's latest tweet (opened duckduckgo.com/?q=Elon+Musk%27s+latest+tweet)"], links: footer }
  const action = (probabilities: Record<string, number>, top = 'search'): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })
  const none = { verb: 'none', target: null, slot: null }

  it('reads search on top with the Search button barely offered as no next step', () => {
    expect(readCommandAnswers({ action: action({ search: 0.46, 'click-3': 0.03, 'type-2': 0.02 }), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual(none)
  })

  it('opens no footer link either: with no result in view, nothing further down is one', () => {
    expect(readCommandAnswers({ action: action({ search: 0.6, 'open-1': 0.3, 'click-3': 0.1 }), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual(none)
  })

  it('reads none on top as no next step, whatever the chrome under it holds', () => {
    expect(readCommandAnswers({ action: action({ none: 0.8, 'click-3': 0.15 }, 'none'), slot: choice('none') }, TEXT, EMPTY, hop)).toEqual(none)
    expect(readCommandAnswers({ action: action({ none: 0.8, 'type-2': 0.15 }, 'none'), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual(none)
  })

  it('still acts on a ref Jev tops the card with, chrome or not', () => {
    expect(readCommandAnswers({ action: action({ 'click-3': 0.7, search: 0.3 }, 'click-3'), slot: choice('s1-4') }, TEXT, EMPTY, hop)).toEqual({ verb: 'click', target: 3, slot: null })
  })

  it('opens the most probable result once the results are drawn, never the chrome ranked above it', () => {
    expect(readCommandAnswers({ action: action({ search: 0.6, 'click-3': 0.3, 'click-7': 0.1 }), slot: choice('s1-4') }, TEXT, DRAWN, hop)).toEqual({ verb: 'click', target: 7, slot: null })
  })

  it("leaves a site's own search page as it was: the most probable offered click, whatever it is", () => {
    const SITE_SEARCH: CommandPage = { url: 'https://x.com/search?q=elon', title: 'elon - Search / X', refs: [{ ref: 2, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null }] }
    expect(readCommandAnswers({ action: action({ search: 0.9, 'click-2': 0.1 }), slot: choice('s1-4') }, TEXT, SITE_SEARCH, { ...hop, visited: [SITE_SEARCH.url], links: [] })).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('leaves hop 0 as it was: the words are searched', () => {
    expect(readCommandAnswers({ action: action({ search: 0.93, 'click-3': 0.03 }), slot: choice('s1-4') }, TEXT, EMPTY)).toEqual({ verb: 'search', target: null, slot: "Elon Musk's latest tweet" })
  })
})

describe('none past the first hop: the Task ends where it stands, though a ref has some probability', () => {
  // The logged hop 3 of "cross out the pop-up": hop 0 closed X's login
  // dialog, then each hop read click over a target of none and clicked the
  // ref Jev barely offered — the login page, Back, then the bio's link.
  const PROFILE: CommandPage = {
    url: 'https://x.com/ElonMusk',
    title: 'Elon Musk (@elonmusk) / X',
    refs: [
      { ref: 2, kind: 'button', label: 'Back', href: null, inputType: null },
      { ref: 11, kind: 'link', label: 'Terafab.AI', href: 'http://terafab.ai/', inputType: null },
      { ref: 50, kind: 'link', label: 'Continue to X', href: 'https://x.com/i/jf/onboarding/web?mode=login', inputType: null },
    ],
  }
  const TEXT = 'cross out the pop-up'
  const hop = { hop: 3, visited: ['https://x.com/ElonMusk'], actions: [], links: [] }
  const action = (probabilities: Record<string, number>, top: string): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })

  it('reads none on top as no next step, though a click has some probability', () => {
    expect(readCommandAnswers({ action: action({ none: 0.88, 'click-11': 0.05, 'click-50': 0.04, 'click-2': 0.01 }, 'none'), slot: choice('none') }, TEXT, PROFILE, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('still clicks a ref Jev tops the card with', () => {
    expect(readCommandAnswers({ action: action({ 'click-2': 0.7, none: 0.3 }, 'click-2'), slot: choice('none') }, TEXT, PROFILE, hop)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it("a site's results the Task's own words led to are a landing whatever the parameter is called: a search on top opens the most probable click", () => {
    const answers = { action: action({ search: 0.6, 'click-11': 0.3 }, 'search'), slot: choice('none') }
    const results = { ...PROFILE, url: 'https://www.youtube.com/results?search_query=lofi+beats' }
    expect(readCommandAnswers(answers, TEXT, results, { ...hop, terms: ['lofi beats'] })).toEqual({ verb: 'click', target: 11, slot: null })
    expect(readCommandAnswers(answers, TEXT, results, hop)).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers(answers, TEXT, { ...PROFILE, url: 'https://duckduckgo.com/?q=elon+musk' }, hop)).toEqual({ verb: 'click', target: 11, slot: null })
  })
})

describe('the Site Scope (#340): where the words point, asked at hop 0 on a site', () => {
  const X: CommandPage = {
    url: 'https://x.com/home',
    title: 'Home / X',
    refs: [
      { ref: 1, kind: 'link', label: 'Home', href: 'https://x.com/home', inputType: null },
      { ref: 2, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const TEXT = 'go to donald trumps profile'
  const read = (where: string, action: string | DecisionChoiceAnswer = 'search') => ({ action: typeof action === 'string' ? choice(action) : action, slot: choice('s2-4'), where: choice(where) })
  const spread = (top: string): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: 0.67, probabilities: { [top]: 0.67, 'click-2': 0.17, 'click-1': 0.09 } })

  it('asks a third Choice on a site: on this page, on this site, or elsewhere on the web', () => {
    const questions = commandQuestions(TEXT, X)
    expect(Object.keys(questions)).toEqual(['action', 'slot', 'extent', 'where'])
    expect('where' in questions && Object.keys(questions.where.options)).toEqual(['page', 'site', 'web'])
    expect('where' in questions && questions.where.options.site).toContain('x.com')
  })

  it('asks no where on a blank page, or on a Web Engine’s results or front page', () => {
    for (const url of ['about:blank', 'https://duckduckgo.com/?q=trump', 'https://www.google.com/']) expect(Object.keys(commandQuestions(TEXT, { ...X, url }))).toEqual(['action', 'slot', 'extent'])
  })

  it('reads search, search terms and where = site as a search scoped to the site, the Slot kept as the words — a navigate of such words too', () => {
    expect(readCommandAnswers(read('site'), TEXT, X)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile', site: 'x.com' })
    expect(readCommandAnswers(read('site', 'navigate'), TEXT, X)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile', site: 'x.com' })
  })

  it('reads where = web as the whole web searched', () => {
    expect(readCommandAnswers(read('web'), TEXT, X)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile' })
  })

  it('reads where = page as the most probable click on the card, never a search (#353)', () => {
    // The logged "Open the tweet." on x.com/ElonMusk: where page 0.64 — and a web search for "the tweet".
    expect(readCommandAnswers(read('page', spread('search')), 'open the tweet', X)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(readCommandAnswers({ ...read('page', spread('navigate')), slot: choice('s1-2') }, 'open the tweet', X)).toEqual({ verb: 'click', target: 2, slot: null })
    // A bare word Jev reads as a navigation is an address, whatever where says: Jev said so.
    expect(readCommandAnswers(read('page', spread('navigate')), 'open the tweet', X)).toEqual({ verb: 'navigate', target: null, slot: 'tweet' })
    // No click given any probability: no Command, and no search either.
    expect(readCommandAnswers(read('page'), TEXT, X)).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers(read('page', { type: 'choice', choice: 'search', confidence: 1, probabilities: { search: 1, 'click-2': 0 } }), TEXT, X)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('keeps a click a click, and an address-shaped navigate an address, whatever where says', () => {
    expect(readCommandAnswers(read('site', 'click-2'), 'go to elon musk', X)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(readCommandAnswers({ ...read('site', 'navigate'), slot: choice('s2-2') }, 'go to youtube', X)).toEqual({ verb: 'navigate', target: null, slot: 'youtube' })
  })
})

describe('the Site Scope at a later hop (#341): a hop may search once, on a site the Task has not searched', () => {
  const X: CommandPage = {
    url: 'https://x.com/',
    title: 'X. It’s what’s happening / X',
    refs: [
      { ref: 1, kind: 'link', label: 'Sign in', href: 'https://x.com/login', inputType: null },
      { ref: 2, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null },
    ],
  }
  const RESULTS: CommandPage = {
    url: 'https://duckduckgo.com/?q=site%3Ax.com+donald+trumps+profile',
    title: 'site:x.com donald trumps profile at DuckDuckGo',
    refs: [{ ref: 3, kind: 'link', label: 'Donald J. Trump (@realDonaldTrump) / X', href: 'https://x.com/realDonaldTrump', inputType: null }],
  }
  const TEXT = 'go to twitter and open donald trumps profile'
  const hop = { hop: 1, visited: ['https://x.com/'], actions: ['open twitter (opened x.com)'], links: [] }
  const read = (where: string, action: DecisionChoiceAnswer = choice('search')) => ({ action, slot: choice('s5-7'), where: choice(where) })
  const card = (probabilities: Record<string, number>): DecisionChoiceAnswer => ({ type: 'choice', choice: 'search', confidence: probabilities.search ?? 0, probabilities })

  it('asks where at a later hop on a site the Task has not searched', () => {
    const questions = commandQuestions(TEXT, X, hop)
    expect(Object.keys(questions)).toEqual(['action', 'slot', 'extent', 'where'])
    expect('where' in questions && questions.where.options.site).toContain('x.com')
  })

  it('asks no where on a results landing, or on a site the Task has already searched', () => {
    expect(Object.keys(commandQuestions(TEXT, RESULTS, { ...hop, hop: 2 }))).toEqual(['action', 'slot', 'extent'])
    expect(Object.keys(commandQuestions(TEXT, { ...X, url: 'https://x.com/realDonaldTrump' }, { ...hop, hop: 3, searched: ['x.com'] }))).toEqual(['action', 'slot', 'extent'])
  })

  it('reads search, search terms and where = site at a later hop as a search scoped to the site', () => {
    expect(readCommandAnswers(read('site'), TEXT, X, hop)).toEqual({ verb: 'search', target: null, slot: 'donald trumps profile', site: 'x.com' })
  })

  it('reads where = page or web at a later hop as #332 has it: never a search — the most probable offered result on a landing, no next step off one (#342)', () => {
    for (const where of ['page', 'web']) {
      expect(readCommandAnswers(read(where, card({ search: 0.7, 'click-3': 0.2 })), TEXT, RESULTS, { ...hop, hop: 2 })).toEqual({ verb: 'click', target: 3, slot: null })
      expect(readCommandAnswers(read(where, card({ search: 0.7, 'click-2': 0.2 })), TEXT, X, hop)).toEqual({ verb: 'none', target: null, slot: null })
      expect(readCommandAnswers(read(where), TEXT, X, hop)).toEqual({ verb: 'none', target: null, slot: null })
    }
  })

  it('never searches a site twice in one Task, whatever where says', () => {
    expect(readCommandAnswers(read('site', card({ search: 0.7, 'click-2': 0.2 })), TEXT, X, { ...hop, searched: ['x.com'] })).toEqual({ verb: 'none', target: null, slot: null })
    expect(readCommandAnswers(read('site', choice('click-2')), TEXT, X, { ...hop, searched: ['x.com'] })).toEqual({ verb: 'click', target: 2, slot: null })
  })
})

describe('the Verdict: a hop is asked whether what was asked for is done', () => {
  const PROFILE: CommandPage = {
    url: 'https://x.com/elonmusk',
    title: 'Elon Musk (@elonmusk) / X',
    refs: [
      { ref: 1, kind: 'link', label: 'Elon Musk @elonmusk 2h Grok might turn out to be your favorite employee', href: null, inputType: null },
      { ref: 2, kind: 'link', label: '2h', href: 'https://x.com/elonmusk/status/1', inputType: null },
      { ref: 3, kind: 'link', label: 'Log in with username or email', href: 'https://x.com/login', inputType: null },
    ],
  }
  /** The profile with the sign-in sheet over it: its controls first, on the dialog layer. */
  const COVERED: CommandPage = {
    ...PROFILE,
    refs: [
      { ref: 1, kind: 'button', label: 'Close', href: null, inputType: null },
      { ref: 2, kind: 'link', label: 'Log in', href: 'https://x.com/login', inputType: null },
      { ref: 3, kind: 'link', label: 'Sign up', href: 'https://x.com/signup', inputType: null },
      { ref: 4, kind: 'link', label: 'Elon Musk @elonmusk 2h Grok might turn out to be your favorite employee', href: null, inputType: null },
      { ref: 5, kind: 'link', label: 'Log in with username or email', href: 'https://x.com/login', inputType: null },
    ],
    dialog: { text: 'Don’t miss what’s happening', refs: [1, 2, 3] },
  }
  const hop = { hop: 1, visited: [PROFILE.url], actions: ['search Elon Musk (opened x.com/elonmusk)'], links: [] }
  const answer = (choice: string, confidence = 0.9): DecisionChoiceAnswer => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } })
  const reading = { action: answer('click-1'), slot: answer('none') }

  it('asks the outcome at a hop, among yes, in the way and not yet, beside the action card, the Slot and where', () => {
    const questions = hopQuestions('open elon musks latest tweet', PROFILE, hop)
    expect(Object.keys(questions)).toEqual(['action', 'slot', 'extent', 'where', 'outcome', 'progress'])
    expect(Object.keys(questions.outcome.options)).toEqual(['yes', 'in_the_way', 'not_yet'])
    expect(questions.outcome.instructions).toContain('if a pop-up, sign-in prompt or challenge covers the page now, choose in_the_way')
    expect(questions.outcome.instructions).toContain('the action they asked for has happened')
  })

  it('tells the Verdict a cookie strip that covers nothing is not in the way (#404)', () => {
    const questions = hopQuestions('open elon musks latest tweet', PROFILE, hop)
    expect(questions.outcome.instructions).toContain('a cookie strip or other notice on the page that covers nothing is not in the way')
    expect(questions.outcome.instructions).not.toContain('cookie notice or challenge covers')
  })

  it('asks the dismiss Choice over a pop-up (#354): escape and every dialog control a dismissal may click, with what a close is and what is a way through', () => {
    const covered = {
      ...PROFILE,
      refs: [
        ...PROFILE.refs,
        { ref: 7, kind: 'link' as const, label: 'Log in', href: 'https://x.com/login', inputType: null },
        { ref: 8, kind: 'button' as const, label: 'Sign in', href: null, inputType: null },
        { ref: 9, kind: 'button' as const, label: 'Close', href: null, inputType: null },
        { ref: 10, kind: 'button' as const, label: 'Not now', href: null, inputType: null },
      ],
      dialog: { text: 'Don’t miss what’s happening', refs: [7, 8, 9, 10] },
    }
    const questions = hopQuestions('open elon musks latest tweet', covered, hop)
    expect(Object.keys(questions)).toEqual(['action', 'slot', 'extent', 'where', 'outcome', 'progress', 'dismiss'])
    expect(Object.keys(questions.dismiss!.options)).toEqual(['escape', 'ref-9', 'ref-10'])
    expect(questions.dismiss!.instructions).toContain('Which control closes it and leaves the page behind as it was')
    expect(questions.dismiss!.instructions).toContain('Never one that goes through it: sign in, sign up, subscribe, accept, agree, allow, install')
    expect(hopQuestions('open elon musks latest tweet', PROFILE, hop).dismiss).toBeUndefined()
    // Only a way through, or links: nothing to offer beside Escape, so nothing is asked.
    expect(hopQuestions('open elon musks latest tweet', { ...covered, dialog: { text: 'Join', refs: [7, 8] } }, hop).dismiss).toBeUndefined()
    expect(readDismissChoice({ ...reading, outcome: answer('in_the_way'), dismiss: answer('ref-10', 0.8) }, covered)).toEqual({ choice: { ref: 10 }, confidence: 0.8 })
    expect(readDismissChoice({ ...reading, outcome: answer('in_the_way'), dismiss: answer('escape', 0.6) }, covered)).toEqual({ choice: 'escape', confidence: 0.6 })
    expect(readDismissChoice({ ...reading, outcome: answer('in_the_way'), dismiss: answer('ref-8', 0.9) }, covered)).toBeNull()
    expect(readDismissChoice({ ...reading, outcome: answer('in_the_way') }, covered)).toBeNull()
  })

  it('asks no outcome at hop 0: a Command is read before anything was done', () => {
    expect(Object.keys(commandQuestions('open elon musks latest tweet', PROFILE))).toEqual(['action', 'slot', 'extent', 'where'])
  })

  it('reads the Verdict with its confidence, null when none was asked or the answer names no outcome', () => {
    expect(readVerdict({ ...reading, outcome: answer('in_the_way', 0.85) })).toEqual({ outcome: 'in_the_way', confidence: 0.85 })
    expect(readVerdict(reading)).toBeNull()
    expect(readVerdict({ ...reading, outcome: answer('maybe') })).toBeNull()
  })

  it('leaves the Command reading as it was: the Verdict is beside the action card, not in it', () => {
    expect(readCommandAnswers({ ...reading, outcome: answer('yes') }, 'open elon musks latest tweet', PROFILE, hop)).toEqual({ verb: 'click', target: 1, slot: null })
  })

  describe('"Done so far" in facts', () => {
    const click = { verb: 'click' as const, target: 1, slot: null }
    const CLICKED = 'click "Elon Musk @elonmusk 2h Grok might turn out to be your favorite employee"'

    it('names the address a click opened, as before, and the pop-up that covers it', () => {
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, COVERED, { changed: true, opened: 'https://x.com/elonmusk/status/1' }))).toBe(
        `${CLICKED} (opened x.com/elonmusk/status/1; a pop-up covers it: "Close", "Log in" and "Sign up")`,
      )
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, PROFILE, { changed: true, opened: 'https://x.com/elonmusk/status/1' }))).toBe(`${CLICKED} (opened x.com/elonmusk/status/1)`)
    })

    it('tells a click that stayed on its address by what appeared: a pop-up over the page, its controls first', () => {
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, COVERED, { changed: true }))).toBe(
        `${CLICKED} (the address did not change; a pop-up appeared over the page: "Close", "Log in" and "Sign up")`,
      )
    })

    it('names what appeared with no pop-up, and says only that the page changed when nothing new is there', () => {
      const more: CommandPage = { ...PROFILE, refs: [...PROFILE.refs, { ref: 4, kind: 'button', label: 'Show more', href: null, inputType: null }] }
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, more, { changed: true }))).toBe(`${CLICKED} (the address did not change; "Show more" appeared)`)
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, PROFILE, { changed: true }))).toBe(`${CLICKED} (the page changed)`)
    })

    it('says the pop-up closed when the page it covered is clear again', () => {
      expect(doneLine(click, COVERED, doneFacts(COVERED, PROFILE, { changed: true }))).toBe('click "Close" (the pop-up closed)')
    })

    it('told again after a re-read found the pop-up gone: it covered the page, and closed (post mortem 2026-10-19)', () => {
      expect(doneLine(click, PROFILE, { changed: true, opened: 'https://x.com/elonmusk/status/1', covered: true, closed: true })).toBe(
        `${CLICKED} (opened x.com/elonmusk/status/1; a pop-up covered it, and closed)`,
      )
      expect(doneLine(click, PROFILE, { changed: true, covered: true, closed: true })).toBe(`${CLICKED} (the address did not change; a pop-up appeared over the page, and closed)`)
    })

    it('keeps nothing changed as it was, whatever the page shows', () => {
      expect(doneLine(click, PROFILE, doneFacts(PROFILE, COVERED, { changed: false }))).toBe(`${CLICKED} (nothing changed)`)
    })

    it('names at most three controls, cut at 40 characters, and no pop-up that was already open', () => {
      const wide: CommandPage = { ...COVERED, refs: [...COVERED.refs, { ref: 6, kind: 'button', label: 'A control whose label runs on far past forty characters', href: null, inputType: null }] }
      expect(doneLine(click, COVERED, doneFacts(COVERED, wide, { changed: true }))).toBe('click "Close" (the address did not change; "A control whose label runs on far past…" appeared)')
    })
  })

  describe('"Done so far" tells what the action did to its target first (#366)', () => {
    const CAPTIONS = 'Subtitles/closed captions keyboard shortcut c'
    const WATCH: CommandPage = {
      url: 'https://www.youtube.com/watch?v=1',
      title: 'A video',
      refs: [
        { ref: 11, kind: 'button', label: 'Play (k)', href: null, inputType: null, states: [] },
        { ref: 12, kind: 'button', label: CAPTIONS, href: null, inputType: null, states: ['pressed=false'] },
        { ref: 13, kind: 'input', label: 'Search', href: null, inputType: 'text', states: [] },
      ],
    }
    const withRef = (page: CommandPage, ref: number, change: Partial<CommandPage['refs'][number]>): CommandPage => ({ ...page, refs: page.refs.map((one) => (one.ref === ref ? { ...one, ...change } : one)) })
    const appeared = (page: CommandPage, ...labels: string[]): CommandPage => ({ ...page, refs: [...page.refs, ...labels.map((label, n) => ({ ref: 20 + n, kind: 'button' as const, label, href: null, inputType: null }))] })
    const clickRef = (target: number) => ({ verb: 'click' as const, target, slot: null })

    it('leads with the toggle that flipped, the page facts after it', () => {
      const after = appeared(withRef(WATCH, 12, { states: ['pressed=true'] }), 'Add a comment…')
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, after, { changed: true }, 12))).toBe(
        `click "${CAPTIONS}" ("${CAPTIONS}" went from pressed=false to pressed=true; the address did not change; "Add a comment…" appeared)`,
      )
    })

    it('leads with the target before a pop-up, and still names at most three controls that appeared', () => {
      const after = { ...appeared(withRef(WATCH, 12, { states: ['pressed=true'] }), 'One', 'Two', 'Three', 'Four'), dialog: { text: 'Menu', refs: [23] } }
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, after, { changed: true }, 12))).toBe(
        `click "${CAPTIONS}" ("${CAPTIONS}" went from pressed=false to pressed=true; the address did not change; a pop-up appeared over the page: "Four", "One" and "Two")`,
      )
    })

    it('tells a target that opened another address by the address alone: the page it was on is gone', () => {
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, { ...WATCH, refs: [] }, { changed: true, opened: 'https://www.youtube.com/watch?v=2' }, 12))).toBe(`click "${CAPTIONS}" (opened youtube.com/watch?v=2)`)
    })

    it('knows a control that changed its own label by its place: the same number and kind, a label the page did not show', () => {
      const after = withRef(WATCH, 11, { label: 'Pause (k)' })
      expect(doneLine(clickRef(11), WATCH, doneFacts(WATCH, after, { changed: true }, 11))).toBe('click "Play (k)" ("Play (k)" now reads "Pause (k)")')
      const pressed = withRef(WATCH, 11, { label: 'Pause (k)', states: ['pressed=true'] })
      expect(doneLine(clickRef(11), WATCH, doneFacts(WATCH, pressed, { changed: true }, 11))).toBe('click "Play (k)" ("Play (k)" now reads "Pause (k)" and went from pressed=false to pressed=true)')
      // Another control in its place, a label the page already showed: the target is gone.
      const moved = { ...WATCH, refs: [{ ...WATCH.refs[1]!, ref: 11 }, { ...WATCH.refs[2]!, ref: 12 }] }
      expect(doneLine(clickRef(11), WATCH, doneFacts(WATCH, moved, { changed: true }, 11))).toBe('click "Play (k)" ("Play (k)" is no longer on the page)')
      // A pop-up's control in its place, or a link to elsewhere: not the target either.
      const sheet = { ...withRef(WATCH, 11, { label: 'Close' }), dialog: { text: 'Sign in', refs: [11] } }
      expect(doneLine(clickRef(11), WATCH, doneFacts(WATCH, sheet, { changed: true }, 11))).toBe('click "Play (k)" (the address did not change; a pop-up appeared over the page: "Close")')
      const link = { ...WATCH, refs: [{ ref: 1, kind: 'link' as const, label: 'Home', href: 'https://a.com/', inputType: null }] }
      expect(doneLine(clickRef(1), link, doneFacts(link, { ...link, refs: [{ ...link.refs[0]!, label: 'About', href: 'https://a.com/about' }] }, { changed: true }, 1))).toBe(
        'click "Home" ("Home" is no longer on the page; the address did not change; "About" appeared)',
      )
    })

    it('tells the target, not another control of its label, when a menu renumbers the page (live run 2026-10-21: two "Settings" on YouTube, a "Code" tab and button on GitHub)', () => {
      const page: CommandPage = {
        ...WATCH,
        refs: [
          { ref: 5, kind: 'button', label: 'Settings', href: null, inputType: null },
          { ref: 13, kind: 'button', label: 'Settings', href: null, inputType: null, states: ['hasPopup=menu', 'expanded=false'] },
          { ref: 14, kind: 'link', label: 'Code', href: 'https://github.com/a/b', inputType: null },
          { ref: 15, kind: 'button', label: 'Code', href: null, inputType: null, states: ['hasPopup=menu', 'expanded=false'] },
        ],
      }
      const menu = (n: number): CommandRef[] => [1, 2].map((ref) => ({ ref, kind: 'button' as const, label: `Option ${n}.${ref}`, href: null, inputType: null }))
      const opened = (target: number): CommandPage => ({
        ...page,
        refs: [...menu(target), ...page.refs.map((one) => ({ ...one, ref: one.ref + 2, ...(one.ref === target ? { states: ['hasPopup=menu', 'expanded=true'] } : {}) }))],
      })
      expect(doneLine(clickRef(13), page, doneFacts(page, opened(13), { changed: true }, 13))).toBe(
        'click "Settings" ("Settings" went from expanded=false to expanded=true; the address did not change; "Option 13.1" and "Option 13.2" appeared)',
      )
      expect(doneLine(clickRef(15), page, doneFacts(page, opened(15), { changed: true }, 15))).toBe('click "Code" ("Code" went from expanded=false to expanded=true; the address did not change; "Option 15.1" and "Option 15.2" appeared)')
    })

    it('names the value a type left in its field', () => {
      const typed = { verb: 'type' as const, target: 13, slot: 'weather in London' }
      const after = withRef(WATCH, 13, { states: ['value="weather in London"'] })
      expect(doneLine(typed, WATCH, doneFacts(WATCH, after, { changed: true }, 13))).toBe('type "weather in London" into "Search" ("Search" went from no value to value="weather in London")')
    })

    it('tells each flip of expanded, checked, selected and disabled, and both of two flips on one ref', () => {
      const told = (from: string[], to: string[]): string => doneLine(clickRef(11), WATCH, doneFacts(withRef(WATCH, 11, { states: from }), withRef(WATCH, 11, { states: to }), { changed: true }, 11))
      expect(told(['expanded=false'], ['expanded=true'])).toBe('click "Play (k)" ("Play (k)" went from expanded=false to expanded=true)')
      expect(told(['checked=true'], ['checked=false'])).toBe('click "Play (k)" ("Play (k)" went from checked=true to checked=false)')
      expect(told(['selected=false'], ['selected=true'])).toBe('click "Play (k)" ("Play (k)" went from selected=false to selected=true)')
      // Ref State drops a `false` that is no toggle's: a control no longer disabled loses the state.
      expect(told(['disabled=true'], [])).toBe('click "Play (k)" ("Play (k)" went from disabled=true to disabled=false)')
      expect(told(['pressed=false', 'expanded=false'], ['pressed=true', 'expanded=true'])).toBe('click "Play (k)" ("Play (k)" went from pressed=false to pressed=true and from expanded=false to expanded=true)')
    })

    it('leaves focus out: every click and type moves it, so its flip says nothing of what the action did (replay 2026-10-21)', () => {
      const told = (from: string[], to: string[]): string => doneLine(clickRef(11), WATCH, doneFacts(withRef(WATCH, 11, { states: from }), withRef(WATCH, 11, { states: to }), { changed: true }, 11))
      expect(told(['pressed=false'], ['focused=true', 'pressed=true'])).toBe('click "Play (k)" ("Play (k)" went from pressed=false to pressed=true)')
      expect(told([], ['focused=true'])).toBe('click "Play (k)" (its state did not change)')
    })

    it('reads a ref with no states as one whose tree said nothing: a page read drops an empty list (snapshot)', () => {
      const bare = withRef(WATCH, 11, { states: undefined })
      expect(doneLine(clickRef(11), bare, doneFacts(bare, withRef(WATCH, 11, { states: ['pressed=true'] }), { changed: true }, 11))).toBe('click "Play (k)" ("Play (k)" went from pressed=false to pressed=true)')
      expect(doneLine(clickRef(11), withRef(WATCH, 11, { states: ['disabled=true'] }), doneFacts(withRef(WATCH, 11, { states: ['disabled=true'] }), bare, { changed: true }, 11))).toBe('click "Play (k)" ("Play (k)" went from disabled=true to disabled=false)')
      expect(doneLine(clickRef(11), bare, doneFacts(bare, bare, { changed: true }, 11))).toBe('click "Play (k)" (its state did not change)')
    })

    it('tells no target gone when a pop-up opened or closed: the page under a pop-up is not read whole, and a closed pop-up takes its controls with it', () => {
      const sheet = { ...WATCH, refs: [{ ref: 1, kind: 'button' as const, label: 'Close', href: null, inputType: null }], dialog: { text: 'Sign in', refs: [1] } }
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, sheet, { changed: true }, 12))).toBe(`click "${CAPTIONS}" (the address did not change; a pop-up appeared over the page: "Close")`)
      expect(doneLine(clickRef(1), sheet, doneFacts(sheet, WATCH, { changed: true }, 1))).toBe('click "Close" (the pop-up closed)')
    })

    it('tells a target whose state changed though the page reads unchanged', () => {
      const after = withRef(WATCH, 12, { states: ['pressed=true'] })
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, after, { changed: false }, 12))).toBe(`click "${CAPTIONS}" ("${CAPTIONS}" went from pressed=false to pressed=true)`)
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, WATCH, { changed: false }, 12))).toBe(`click "${CAPTIONS}" (nothing changed)`)
    })

    it('says the target is no longer on the page when the page it left has no such control', () => {
      const after = { ...WATCH, refs: WATCH.refs.filter((ref) => ref.ref !== 12) }
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, after, { changed: true }, 12))).toBe(`click "${CAPTIONS}" ("${CAPTIONS}" is no longer on the page)`)
    })

    it('says its state did not change when the target is there as it was — a fact, not silence', () => {
      const after = appeared(WATCH, 'Add a comment…')
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, after, { changed: true }, 12))).toBe(`click "${CAPTIONS}" (its state did not change; the address did not change; "Add a comment…" appeared)`)
      expect(doneLine(clickRef(12), WATCH, doneFacts(WATCH, WATCH, { changed: true }, 12))).toBe(`click "${CAPTIONS}" (its state did not change)`)
    })
  })
})

describe('a results page known by the Task\'s words (owner\'s rule 2026-10-19)', () => {
  const hop = (terms: string[]) => ({ hop: 1, visited: [], actions: [], links: [], terms })

  it('an address the Search URL test reads is one, words or none', () => {
    expect(onResults('https://duckduckgo.com/?q=lofi', undefined)).toBe(true)
  })

  it.each([
    ['https://www.youtube.com/results?search_query=lofi+beats', 'lofi beats'],
    ['https://www.amazon.co.uk/s?k=usb+c+cable&ref=nb', 'USB-C cable'],
    ['https://www.ebay.co.uk/sch/i.html?_nkw=film+camera', 'film camera'],
    ['https://example.com/find/garden%20chairs', 'garden chairs'],
  ])('%s carries "%s"', (url, term) => {
    expect(onResults(url, hop([term]))).toBe(true)
    expect(onResults(url, hop([]))).toBe(false)
  })

  it('a page that carries none of the words is no results page', () => {
    expect(onResults('https://www.youtube.com/watch?v=abc', hop(['lofi beats']))).toBe(false)
    expect(onResults('https://www.youtube.com/results?search_query=lofi+beats', hop(['jazz']))).toBe(false)
  })
})

describe('a dismiss phrase over a pop-up (owner\'s rule 2026-10-19)', () => {
  const SHEET: CommandPage = {
    url: 'https://x.com/elonmusk',
    title: 'X',
    refs: [
      { ref: 8, kind: 'button', label: 'Sign in', href: null, inputType: null },
      { ref: 9, kind: 'button', label: 'Close', href: null, inputType: null },
    ],
    dialog: { text: 'Sign in to X', refs: [8, 9] },
  }

  it('asks the Command\'s questions and the dismiss Choice in one call; none with no control to choose', () => {
    expect(Object.keys(dismissPhraseQuestions('close', SHEET)!)).toEqual(['action', 'slot', 'extent', 'where', 'dismiss'])
    expect(dismissPhraseQuestions('close', { ...SHEET, dialog: { text: 'Sign in', refs: [8] } })).toBeNull()
  })

  it('tells Jev to decline a cookie notice\'s optional cookies', () => {
    expect(dismissPhraseQuestions('close', SHEET)!.dismiss.instructions).toContain('continue without accepting')
  })

  it("names each control's Ref State among the dismiss options, so the focused close is told from the rest", () => {
    const focused = { ...SHEET, refs: [SHEET.refs[0], { ...SHEET.refs[1], states: ['focused=true'] }] }
    expect(Object.values(dismissPhraseQuestions('close', focused)!.dismiss.options)).toContain('button "Close" focused=true')
  })
})

describe('the steps Choice (#364, ADR 0076 "a line is Steps")', () => {
  const BLANK: CommandPage = { ...PAGE, url: 'about:blank' }
  const LINE = 'start the song from the beginning and put it on loop'
  const stepsOf = (text: string) => {
    const questions = commandQuestions(text, BLANK)
    return 'steps' in questions ? questions.steps?.options : undefined
  }

  it('is asked at hop 0 beside the others, one option per conjunction boundary labelled with its two halves, and none', () => {
    expect(Object.keys(commandQuestions(LINE, BLANK))).toEqual(['action', 'slot', 'extent', 'steps'])
    expect(stepsOf(LINE)).toEqual({ none: 'one command: the whole line', w7: 'start the song from the beginning | put it on loop' })
  })

  it('offers each of and, then, and then and a comma once, the conjunction left out of both halves', () => {
    expect(stepsOf('open youtube then search cats')).toEqual({ none: 'one command: the whole line', w3: 'open youtube | search cats' })
    expect(stepsOf('open youtube and then search cats')).toEqual({ none: 'one command: the whole line', w4: 'open youtube | search cats' })
    expect(stepsOf('scroll down, click the first one, and read it')).toEqual({
      none: 'one command: the whole line',
      w2: 'scroll down | click the first one, and read it',
      w7: 'scroll down, click the first one | read it',
    })
    expect(stepsOf('play highs and lows pomme')).toEqual({ none: 'one command: the whole line', w3: 'play highs | lows pomme' })
  })

  it('is not asked for a line with no conjunction, or one that starts or ends on one; nor at a later hop, on a partial, or when left out', () => {
    expect(Object.keys(commandQuestions('scroll down please', BLANK))).toEqual(['action', 'slot', 'extent'])
    expect(Object.keys(commandQuestions('and then', BLANK))).toEqual(['action', 'slot', 'extent'])
    expect(Object.keys(commandQuestions('open youtube and', BLANK))).toEqual(['action', 'slot', 'extent'])
    expect(Object.keys(hopQuestions(LINE, BLANK, { hop: 1, visited: [], actions: [], links: [] }))).not.toContain('steps')
    expect(Object.keys(partialQuestions(LINE, BLANK))).toEqual(['action', 'slot', 'extent', 'complete'])
    expect(Object.keys(commandQuestions(LINE, BLANK, undefined, { steps: false }))).toEqual(['action', 'slot', 'extent'])
  })

  it('reads a boundary as the two Steps, and none or a label it did not offer as one Command', () => {
    const answers = (steps: string) => ({ action: choice('none'), slot: choice('none'), steps: choice(steps) })
    expect(readSteps(answers('w7'), LINE)).toEqual({ at: 7, first: 'start the song from the beginning', rest: 'put it on loop' })
    expect(readSteps(answers('none'), LINE)).toBeNull()
    expect(readSteps(answers('w3'), LINE)).toBeNull()
    expect(readSteps({ action: choice('none'), slot: choice('none') }, LINE)).toBeNull()
  })

  it('tells a Step its place in the line and what the Steps before it did, the line on its own labelled line', () => {
    const state = commandState('put it on loop', BLANK, undefined, { line: LINE, step: 2, of: 2, done: ['Step 1 "start the song from the beginning": restart'] })
    expect(state.split('\n').slice(0, 3)).toEqual([
      'The user spoke to a web browser: "put it on loop"',
      `Step 2 of 2 of the line: ${JSON.stringify(LINE)}`,
      'Done so far: Step 1 "start the song from the beginning": restart',
    ])
  })
})

describe('Appliance Verbs (#374)', () => {
  const WATCH: CommandPage = {
    url: 'https://www.youtube.com/watch?v=abc',
    title: 'Highs and Lows - YouTube',
    refs: [{ ref: 4, kind: 'button', label: 'Play (k)', href: null, inputType: null }],
  }
  const HOP: HopContext = { hop: 1, visited: [WATCH.url], actions: ['click "Play (k)" (nothing changed)'], links: [] }
  const APPLIANCE_VERBS = ['play', 'play_next', 'queue', 'skip', 'previous', 'show']
  const PAGE_SONG: CommandPage = { ...WATCH, media: { title: 'Highs and Lows', paused: false, currentTime: 3, duration: 100, loop: false, muted: false } }

  it("with a song queued, the command, hop and partial asks offer the six beside the browser's ref-less verbs, each described, and no paragraph of their own", () => {
    const appliance = { queued: true }
    for (const questions of [commandQuestions('next song', WATCH, undefined, { appliance }), hopQuestions('next song', WATCH, HOP, { appliance }), partialQuestions('next song', WATCH, { appliance })]) {
      const labels = Object.keys(questions.action.options)
      expect(labels).toEqual(['click-4', 'menu-4', 'navigate', 'search', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload', 'press', 'read', 'clear', 'stop', 'none', ...APPLIANCE_VERBS])
      for (const verb of APPLIANCE_VERBS) expect(questions.action.options[verb]).toMatch(/^music: /)
      expect(questions.action.instructions).not.toMatch(/music/)
    }
    expect(commandQuestions('click play', WATCH, undefined, { appliance }).action.options['play']).toMatch(/never the page's play button/)
  })

  it("offers each by ability: the Queue's walk only while the Queue holds a song, never over a page's own video with nothing queued; show while any song is on; none with no Player (AC4)", () => {
    const labels = (page: CommandPage, queued: boolean) => Object.keys(commandQuestions('next song', page, undefined, { appliance: { queued } }).action.options).filter((label) => APPLIANCE_VERBS.includes(label))
    expect(labels(PAGE_SONG, false)).toEqual(['play', 'play_next', 'queue', 'show'])
    expect(labels(WATCH, false)).toEqual(['play', 'play_next', 'queue'])
    expect(labels(WATCH, true)).toEqual(APPLIANCE_VERBS)
    expect(Object.keys(commandQuestions('next song', PAGE_SONG).action.options)).toHaveLength(14)
  })

  it("an Appliance Verb reading is the `play` Command the grammar's exact line makes", () => {
    const read = (verb: string, text: string) => readCommandAnswers({ action: choice(verb), slot: choice('none') }, text, WATCH)
    expect(read('skip', 'next song')).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } })
    expect(read('previous', 'the song before')).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'previous' } })
    expect(read('show', 'show me the video')).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'show' } })
  })

  it("no label loops, pauses or sets the volume but a media ref's op: the retired Capabilities read as no Command", () => {
    for (const label of RETIRED_LABELS) expect(readCommandAnswers({ action: choice(label), slot: choice('none') }, 'loop the song', WATCH).verb).toBe('none')
  })

  it("`play`, `play_next` and `queue` search for the Slot's words, now, next or last", () => {
    const read = (verb: string, text: string, slot: string) => readCommandAnswers({ action: choice(verb), slot: choice(slot) }, text, WATCH)
    expect(read('play', 'play highs and lows pomme by kanye west', 's1-7')).toEqual({ verb: 'play', target: null, slot: 'highs and lows pomme by kanye west', music: { kind: 'search', place: 'now' } })
    expect(read('play_next', 'play bohemian rhapsody next', 's1-2')).toMatchObject({ slot: 'bohemian rhapsody', music: { kind: 'search', place: 'front' } })
    expect(read('queue', 'add bohemian rhapsody to the queue', 's1-2')).toMatchObject({ slot: 'bohemian rhapsody', music: { kind: 'search', place: 'end' } })
  })

  it('an Appliance Verb at a later hop is the same Command', () => {
    expect(readCommandAnswers({ action: choice('skip'), slot: choice('none'), outcome: choice('not_yet') }, 'next one', WATCH, HOP)).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } })
  })

  describe('a song to play reads `where` as a search does (AGENTS.md, "Jev decides; code shapes the ask")', () => {
    const SPOTIFY: CommandPage = {
      url: 'https://open.spotify.com/',
      title: 'Spotify - Web Player',
      refs: [
        { ref: 1, kind: 'input', label: 'What do you want to play?', href: null, inputType: 'text' },
        { ref: 2, kind: 'link', label: 'Liked Songs', href: 'https://open.spotify.com/collection/tracks', inputType: null },
      ],
    }
    const TEXT = 'play discover weekly'
    const read = (where: string, page: CommandPage, action = 'play', hop?: HopContext) => readCommandAnswers(where === '' ? { action: choice(action), slot: choice('s1-2'), ...(hop === undefined ? {} : { outcome: choice('not_yet') }) } : { action: choice(action), slot: choice('s1-2'), where: choice(where), ...(hop === undefined ? {} : { outcome: choice('not_yet') }) }, TEXT, page, hop)
    const PLAYED: Command = { verb: 'play', target: null, slot: 'discover weekly', music: { kind: 'search', place: 'now' } }

    it('asks `where` beside the Player\'s lines on a site, as on any site', () => {
      expect(Object.keys(commandQuestions(TEXT, SPOTIFY, undefined, { appliance: { queued: false } }))).toEqual(['action', 'slot', 'extent', 'where'])
    })

    it('words Jev reads as pointing on the site open are looked for on that site: a Site Scope, the Slot kept as the words', () => {
      expect(read('site', SPOTIFY)).toEqual({ verb: 'search', target: null, slot: 'discover weekly', site: 'open.spotify.com' })
    })

    it('words pointing at this page, or elsewhere, keep the Player\'s search: the page\'s own control already outranks the line when the words name it', () => {
      expect(read('page', SPOTIFY)).toEqual(PLAYED)
      expect(read('web', SPOTIFY)).toEqual(PLAYED)
      expect(read('', SPOTIFY)).toEqual(PLAYED)
    })

    it('on the Media Engine a `where` of site is the Player\'s own search, never a site-scoped web search', () => {
      expect(read('site', WATCH)).toEqual(PLAYED)
      expect(read('site', { ...WATCH, url: 'https://music.youtube.com/' })).toEqual(PLAYED)
    })

    it('at a later hop, on a site the Task has not searched, the site is searched once (#341); on one it has, the Player searches', () => {
      const hop: HopContext = { hop: 1, visited: ['https://duckduckgo.com/?q=spotify', SPOTIFY.url], actions: ['open "Spotify"'], links: [] }
      expect(read('site', SPOTIFY, 'play', hop)).toEqual({ verb: 'search', target: null, slot: 'discover weekly', site: 'open.spotify.com' })
      expect(read('site', SPOTIFY, 'play', { ...hop, searched: ['open.spotify.com'] })).toEqual(PLAYED)
    })

    it('the Queue\'s own places are the Player\'s alone, whatever `where` says', () => {
      expect(read('site', SPOTIFY, 'play_next')).toMatchObject({ verb: 'play', music: { kind: 'search', place: 'front' } })
      expect(read('site', SPOTIFY, 'queue')).toMatchObject({ verb: 'play', music: { kind: 'search', place: 'end' } })
    })
  })
})

describe('the action card (#370, ADR 0076 amendment): Jev reads a Command as one whole action', () => {
  const LANDING: CommandPage = {
    url: 'https://duckduckgo.com/?q=electron',
    title: 'electron at DuckDuckGo',
    refs: [
      { ref: 1, kind: 'input', label: 'Search', href: null, inputType: 'text' },
      { ref: 2, kind: 'link', label: 'Electron', href: 'https://www.electronjs.org/', inputType: null },
    ],
  }
  const hopOn = (links: HopContext['links']): HopContext => ({ hop: 1, visited: [], actions: ['search "electron" (opened duckduckgo.com/?q=electron)'], links })

  it('offers none, a click per offered ref with its ref line, a type per text field, a menu per ref, the ref-less verbs and the Appliance Verbs — never done, nor a bare click, type or menu', () => {
    const questions = commandQuestions('search for cats', PAGE, undefined, { appliance: { queued: false } })
    const card = questions.action
    expect(card.options['click-1']).toBe('click [1] link "Home" https://example.com/')
    expect(card.options['click-2']).toBe('click [2] button "Sign in"')
    expect(card.options['type-3']).toBe('type the words into [3] input[search] "Search"')
    expect(card.options['type-2']).toBeUndefined()
    expect(card.options['menu-2']).toBe('right-click [2] to open its menu')
    for (const label of ['none', 'navigate', 'search', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload', 'press', 'read', 'clear', 'stop', 'play', 'queue']) expect(card.options).toHaveProperty(label)
    for (const label of ['done', 'click', 'type', 'menu']) expect(card.options).not.toHaveProperty(label)
    expect(questions).not.toHaveProperty('verb')
    expect(questions).not.toHaveProperty('target')
  })

  it('offers an open per result link at a later hop, as the link is shown', () => {
    const card = hopQuestions('open electron', LANDING, hopOn([{ label: 'Electron docs', href: 'https://www.electronjs.org/docs' }])).action
    expect(card.options['open-1']).toBe('open result link "Electron docs" https://www.electronjs.org/docs')
  })

  it('holds at most 255 options on a page with 200 refs: clicks, then fields, then links, then menus while room remains', () => {
    const refs: CommandRef[] = Array.from({ length: 200 }, (_, n) => ({ ref: n + 1, kind: n % 10 === 0 ? 'input' : 'button', label: `Ref ${n + 1}`, href: null, inputType: n % 10 === 0 ? 'text' : null }))
    const labels = Object.keys(commandQuestions('do it', { ...PAGE, refs }, undefined, { appliance: { queued: true } }).action.options)
    expect(labels.length).toBeLessThanOrEqual(255)
    expect(labels.filter((label) => label.startsWith('click-'))).toHaveLength(200)
    expect(labels.filter((label) => label.startsWith('type-'))).toHaveLength(20)
    expect(labels.filter((label) => label.startsWith('menu-')).length).toBeGreaterThan(0)
    expect(labels).toEqual(expect.arrayContaining(['none', 'search', 'skip']))
  })

  it('reads click-N as a click, type-N as typing the Slot, menu-N as a menu, open-N as a navigate to the link', () => {
    expect(readCommandAnswers({ action: choice('click-2'), slot: choice('none') }, 'sign in', PAGE)).toEqual({ verb: 'click', target: 2, slot: null })
    expect(readCommandAnswers({ action: choice('type-3'), slot: choice('s2-2') }, 'type in cats', PAGE)).toEqual({ verb: 'type', target: 3, slot: 'cats' })
    expect(readCommandAnswers({ action: choice('menu-2'), slot: choice('none') }, 'more on sign in', PAGE)).toEqual({ verb: 'menu', target: 2, slot: null })
    const hop = hopOn([{ label: 'Electron docs', href: 'https://www.electronjs.org/docs' }])
    expect(readCommandAnswers({ action: choice('open-1'), slot: choice('none'), outcome: choice('not_yet') }, 'open electron', LANDING, hop)).toEqual({ verb: 'navigate', target: null, slot: 'https://www.electronjs.org/docs' })
  })

  it('types the words after the verb when the Slot names none', () => {
    expect(readCommandAnswers({ action: choice('type-3'), slot: choice('none') }, 'type hello world', PAGE)).toEqual({ verb: 'type', target: 3, slot: 'hello world' })
  })

  it('reads a ref-less verb as itself with its Slot, an Appliance Verb as its play Command, none as no Command', () => {
    expect(readCommandAnswers({ action: choice('scroll_down'), slot: choice('none') }, 'scroll down', PAGE)).toEqual({ verb: 'scroll_down', target: null, slot: null })
    expect(readCommandAnswers({ action: choice('skip'), slot: choice('none') }, 'skip it', PAGE)).toEqual({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } })
    expect(readCommandAnswers({ action: choice('none'), slot: choice('none') }, 'hmm', PAGE).verb).toBe('none')
  })

  it('reads a label naming a ref the hop does not offer as no Command — nor a type on a ref that is no text field, nor done', () => {
    expect(readCommandAnswers({ action: choice('click-9'), slot: choice('none') }, 'click it', PAGE).verb).toBe('none')
    expect(readCommandAnswers({ action: choice('type-2'), slot: choice('none') }, 'type it', PAGE).verb).toBe('none')
    expect(readCommandAnswers({ action: choice('open-4'), slot: choice('none'), outcome: choice('not_yet') }, 'open it', LANDING, hopOn([])).verb).toBe('none')
    expect(readCommandAnswers({ action: choice('done'), slot: choice('none') }, 'done', PAGE).verb).toBe('none')
    // A click the hop set aside is not offered: it is no Command.
    const aside: HopContext = { ...hopOn([]), setAside: [setAsideOf({ verb: 'click', target: 2, slot: null }, PAGE)!] }
    expect(readCommandAnswers({ action: choice('click-2'), slot: choice('none'), outcome: choice('not_yet') }, 'sign in', PAGE, aside).verb).toBe('none')
  })

  it("names the runner-up of the opener's own kind: the next click after a click, the next right-click after a menu, never the fired ref", () => {
    const action: DecisionChoiceAnswer = { type: 'choice', choice: 'click-1', confidence: 0.5, probabilities: { 'click-1': 0.5, 'menu-3': 0.25, 'click-2': 0.15, 'menu-1': 0.06, none: 0.04 } }
    expect(runnerUpOf(action, PAGE, 1, [])).toEqual(refIdentityOf(PAGE.refs[1]!, PAGE))
    expect(runnerUpOf(action, PAGE, 1, [], 'menu')).toEqual(refIdentityOf(PAGE.refs[2]!, PAGE))
    expect(runnerUpOf(action, PAGE, 3, [], 'menu')).toEqual(refIdentityOf(PAGE.refs[0]!, PAGE))
    expect(runnerUpOf(action, PAGE, 3, [setAsideOf({ verb: 'menu', target: 1, slot: null }, PAGE)!], 'menu')).toBeNull()
    // A click set aside on ref 1 does not keep its right-click from being the runner-up.
    expect(runnerUpOf(action, PAGE, 3, [setAsideOf({ verb: 'click', target: 1, slot: null }, PAGE)!], 'menu')).toEqual(refIdentityOf(PAGE.refs[0]!, PAGE))
  })
})

describe('a set-aside, keyed by its card label (#373, ADR 0080)', () => {
  const hopOn = (links: HopContext['links']): HopContext => ({ hop: 1, visited: [], actions: ['click "0:16 / 1:51" ("0:16 / 1:51" now reads "-1:35 / 1:51")'], links })
  const MEDIA_PAGE: CommandPage = { ...PAGE, refs: [...PAGE.refs, { ref: 4, kind: 'button', label: '0:16 / 1:51', href: null, inputType: null }] }
  const asideOf = (command: Command): HopContext => ({ ...hopOn([]), setAside: [setAsideOf(command, MEDIA_PAGE)!] })
  const card = (hop: HopContext) => Object.keys(hopQuestions('skip ahead', MEDIA_PAGE, hop, { appliance: { queued: true } }).action.options)

  it('names a ref action by its act, label and address; a ref-less verb or an Appliance Verb by its name; nothing for a ref the page lacks', () => {
    expect(setAsideOf({ verb: 'click', target: 4, slot: null }, MEDIA_PAGE)).toEqual({ act: 'click', label: '0:16 / 1:51', address: 'https://example.com' })
    expect(setAsideOf({ verb: 'type', target: 3, slot: 'cats' }, MEDIA_PAGE)).toEqual({ act: 'type', label: 'Search', address: 'https://example.com' })
    expect(setAsideOf({ verb: 'scroll_down', target: null, slot: null }, MEDIA_PAGE)).toEqual({ verb: 'scroll_down' })
    expect(setAsideOf({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } }, MEDIA_PAGE)).toEqual({ verb: 'skip' })
    expect(setAsideOf({ verb: 'play', target: null, slot: 'x', music: { kind: 'search', place: 'front' } }, MEDIA_PAGE)).toEqual({ verb: 'play_next' })
    // The grammar's exact `loop` is no card label: nothing to set aside.
    expect(setAsideOf({ verb: 'play', target: null, slot: null, music: { kind: 'loop', on: true } }, MEDIA_PAGE)).toBeNull()
    expect(setAsideOf({ verb: 'click', target: 9, slot: null }, MEDIA_PAGE)).toBeNull()
    // An open-N fires as a navigate: the address it opened is a visited one, and the navigate verb stays on the card.
    expect(setAsideOf({ verb: 'navigate', target: null, slot: 'https://example.com/docs' }, MEDIA_PAGE)).toBeNull()
  })

  it('leaves a set-aside ref action off the next card, and only that action: the ref keeps its other actions and its line', () => {
    const hop = asideOf({ verb: 'click', target: 4, slot: null })
    expect(card(hop)).not.toContain('click-4')
    expect(card(hop)).toContain('menu-4')
    expect(commandState('skip ahead', MEDIA_PAGE, hop)).toContain('[4] button "0:16 / 1:51"')
  })

  it('leaves a set-aside ref-less verb and a set-aside Appliance Verb off the next card', () => {
    expect(card(asideOf({ verb: 'scroll_down', target: null, slot: null }))).not.toContain('scroll_down')
    expect(card(asideOf({ verb: 'scroll_down', target: null, slot: null }))).toContain('scroll_up')
    expect(card(asideOf({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } }))).not.toContain('skip')
    expect(card(asideOf({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } }))).toContain('previous')
  })

  it('reads a top choice the Task set aside as the most probable label still offered, at the runner-up floor or over; none under it', () => {
    const hop = asideOf({ verb: 'click', target: 4, slot: null })
    const answers = (probabilities: Record<string, number>) => ({ action: { type: 'choice' as const, choice: 'click-4', confidence: 0.8, probabilities }, slot: choice('none'), outcome: choice('not_yet') })
    expect(readCommandAnswers(answers({ 'click-4': 0.8, 'menu-4': 0.12, scroll_down: 0.06, none: 0.02 }), 'skip ahead', MEDIA_PAGE, hop)).toEqual({ verb: 'menu', target: 4, slot: null })
    expect(readCommandAnswers(answers({ 'click-4': 0.96, 'click-2': 0.03, none: 0.01 }), 'skip ahead', MEDIA_PAGE, hop).verb).toBe('none')
    const skipAside = asideOf({ verb: 'play', target: null, slot: null, music: { kind: 'skip' } })
    expect(readCommandAnswers({ ...answers({ skip: 0.7, scroll_down: 0.3 }), action: { type: 'choice', choice: 'skip', confidence: 0.7, probabilities: { skip: 0.7, scroll_down: 0.3 } } }, 'skip it', MEDIA_PAGE, skipAside).verb).toBe('scroll_down')
  })

  it('asks the Verdict only at a later hop, beside the card', () => {
    expect(commandQuestions('enable captions', PAGE)).not.toHaveProperty('outcome')
    expect(hopQuestions('enable captions', PAGE, hopOn([]))).toHaveProperty('outcome')
  })

  it('asks the progress Noul (#373) beside the Verdict at a later hop, never at hop 0, and reads its probability', () => {
    expect(commandQuestions('skip ahead', PAGE)).not.toHaveProperty('progress')
    expect(hopQuestions('skip ahead', PAGE, hopOn([])).progress).toMatchObject({ type: 'noul', instructions: expect.stringContaining('closer to what the user') })
    expect(readProgress({ action: choice('none'), slot: choice('none'), outcome: choice('not_yet'), progress: { type: 'noul', noul: 0.18 } })).toBe(0.18)
    expect(readProgress({ action: choice('none'), slot: choice('none'), outcome: choice('not_yet') })).toBeNull()
    expect(readProgress({ action: choice('none'), slot: choice('none') })).toBeNull()
  })
})

describe('Text Further Down (#393, ADR 0086): the blocks below the view are targets, each with a Show Op, never page content', () => {
  const DOCS: CommandPage = {
    ...PAGE,
    url: 'https://docs.python.org/3/library/json.html',
    viewportText: ['json — JSON encoder and decoder'],
    textBelow: [
      { text: 'Basic Usage', frame: null, node: 4 },
      { text: 'Sign in', frame: null, node: 5 },
      { text: 'json — JSON encoder and decoder', frame: null, node: 6 },
      { text: `Pretty printing: >>> print(json.dumps({'4': 5, '6': 7}, sort_keys=True, indent=4)) ${'x'.repeat(60)}`, frame: 'docs-frame', node: 7 },
      { text: 'News', frame: null, node: 8 },
    ],
  }
  const HOP: HopContext = { hop: 1, visited: [DOCS.url], actions: ['scroll down a screen (the address did not change)'], links: [{ label: 'News', href: 'https://docs.python.org/news' }] }
  const pretty = DOCS.textBelow![3]!
  const options = (page: CommandPage, hop?: HopContext) => commandQuestions('show me how to pretty print', page, hop).action.options
  const shows = (offered: Readonly<Record<string, unknown>>) => Object.keys(offered).filter((label) => label.startsWith('show-'))
  const button = (_: unknown, index: number): CommandRef => ({ ref: index + 1, kind: 'button', label: `B${index}`, href: null, inputType: null })

  it('offers a show-N per block left after the labels and text already on the card, just before the page scroll, saying the first 80 characters', () => {
    const offered = options(DOCS, HOP)
    const labels = Object.keys(offered)
    expect(shows(offered)).toEqual(['show-1', 'show-2'])
    expect(labels.indexOf('show-2') + 1).toBe(labels.indexOf('scroll_up'))
    expect(offered['show-1']).toBe('scroll until [text-1] "Basic Usage" is in view')
    expect(offered['show-2']).toBe(`scroll until [text-2] ${JSON.stringify(pretty.text.slice(0, 80))} is in view`)
  })

  it('says beside the Show Ops that a question a block further down answers takes its show (#405); a card with none, and the Where Ask, say nothing of it', () => {
    const says = /When the words ask something a block of text further down answers, choose the show of that block\.$/
    expect(commandQuestions('how do i install it', DOCS).action.instructions).toMatch(says)
    expect(commandQuestions('how do i install it', PAGE).action.instructions).not.toMatch(/further down/)
    expect(whereQuestions('how do i install it', DOCS).action.instructions).not.toMatch(/further down/)
  })

  it("says on the page scroll, beside the Show Ops, that it is for when no block further down holds the words' ask (#405); a card with none keeps the bare scroll", () => {
    expect(commandQuestions('how do i install it', DOCS).action.options.scroll_down).toBe('scroll the page down a screen, when no block further down holds what the words ask for')
    expect(whereQuestions('how do i install it', DOCS).action.options.scroll_down).toBe('scroll the page down a screen, when no block further down holds what the words ask for')
    expect(commandQuestions('how do i install it', PAGE).action.options.scroll_down).toBe('scroll the page down')
  })

  it('ends the state with the entries the card offers a Show Op for, each whole, after everything else', () => {
    const questions = hopQuestions('show me how to pretty print', DOCS, HOP)
    expect(commandState('show me how to pretty print', DOCS, HOP, undefined, undefined, questions).split('\n').slice(-3)).toEqual([
      'Text further down the page, not on screen yet (number, text):',
      '[text-1] "Basic Usage"',
      `[text-2] ${JSON.stringify(pretty.text)}`,
    ])
  })

  it('puts no entry on the state without the card it is asked beside, and none for a page with nothing below', () => {
    expect(commandState('show me how to pretty print', DOCS)).not.toContain('Text further down')
    const bare = { ...DOCS, textBelow: [] }
    expect(commandState('x', bare, undefined, undefined, undefined, commandQuestions('x', bare))).not.toContain('Text further down')
  })

  it('stops the entries at 6000 characters of the lines they make', () => {
    const page = { ...DOCS, textBelow: Array.from({ length: 30 }, (_, index) => ({ text: `${index}`.padEnd(300, 'w'), frame: null, node: index })) }
    // `[text-N] "…"` is 312 characters for N under 10 and 313 past it: nineteen lines come to 5938, a twentieth to 6251.
    expect(shows(options(page))).toHaveLength(19)
  })

  it('takes only the room the Choice has left under its 255 options: the refs win', () => {
    // 120 buttons' clicks and right-clicks and the 12 ref-less options leave 3 of the 4 blocks room.
    const roomy = options({ ...DOCS, refs: Array.from({ length: 120 }, button) })
    expect(Object.keys(roomy)).toHaveLength(255)
    expect(shows(roomy)).toEqual(['show-1', 'show-2', 'show-3'])
    const full = { ...DOCS, refs: Array.from({ length: 130 }, button) }
    expect(shows(options(full))).toEqual([])
    expect(commandState('x', full, undefined, undefined, undefined, commandQuestions('x', full))).not.toContain('Text further down')
  })

  it('reads a show-N as a scroll down that brings that block into view, and names it so in "Done so far"', () => {
    const answers = { action: choice('show-2'), slot: choice('none'), extent: choice('screen'), outcome: choice('not_yet') }
    const command = readCommandAnswers(answers, 'show me how to pretty print', DOCS, HOP)
    expect(command).toEqual({ verb: 'scroll_down', target: null, slot: null, show: pretty })
    expect(doneAction(command, DOCS)).toBe(`scroll until ${JSON.stringify(pretty.text.slice(0, 80))} is in view`)
    expect(readCommandAnswers({ ...answers, action: choice('show-9') }, 'x', DOCS, HOP).verb).toBe('none')
  })

  it('sets a Show Op aside by its block, never as the page scroll: the next card keeps the scroll and the other blocks, numbered as before', () => {
    const shown = readCommandAnswers({ action: choice('show-1'), slot: choice('none'), extent: choice('screen') }, 'x', DOCS, HOP)
    const aside = setAsideOf(shown, DOCS)
    expect(aside).toEqual({ show: 'Basic Usage', address: 'https://docs.python.org/3/library/json.html' })
    const hop = { ...HOP, setAside: [aside!] }
    const questions = hopQuestions('show me how to pretty print', DOCS, hop)
    expect(Object.keys(questions.action.options)).toEqual(expect.arrayContaining(['show-2', 'scroll_down']))
    expect(Object.keys(questions.action.options)).not.toContain('show-1')
    expect(commandState('x', DOCS, hop, undefined, undefined, questions).split('\n').slice(-2)).toEqual(['Text further down the page, not on screen yet (number, text):', `[text-2] ${JSON.stringify(pretty.text)}`])
    // Set aside on the very call that answered it (#373): the next most probable label still offered.
    const reread = readCommandAnswers({ action: { type: 'choice', choice: 'show-1', confidence: 0.7, probabilities: { 'show-1': 0.7, 'show-2': 0.2 } }, slot: choice('none'), extent: choice('screen') }, 'x', DOCS, hop)
    expect(reread.show).toEqual(pretty)
  })
})

describe('the Hearing on the card (#396, ADR 0077 as amended)', () => {
  const heard = [{ heard: 'NKBH D', candidate: 'MKBHD', from: 'page' as const }]

  it('says after the transcript which words sound like a name, and where the name came from', () => {
    const state = commandState('Search NKBH D', PAGE, undefined, undefined, undefined, undefined, heard)
    expect(state.split('\n').slice(0, 2)).toEqual(['The user spoke to a web browser: "Search NKBH D"', 'Heard by ear, so a word may be misheard: "NKBH D" sounds like "MKBHD", a name on this page'])
    const learned = commandState('play canywast', PAGE, undefined, undefined, undefined, undefined, [{ heard: 'canywast', candidate: 'kanye west', from: 'learned' }])
    expect(learned.split('\n')[1]).toBe('Heard by ear, so a word may be misheard: "canywast" sounds like "kanye west", a name the user taught the app')
  })

  it('says nothing when nothing was heard as a name: a typed line, or one that sounds like none', () => {
    expect(commandState('Search NKBH D', PAGE).split('\n')[1]).toBe('Page: https://example.com/ — "Example"')
    expect(commandState('Search NKBH D', PAGE, undefined, undefined, undefined, undefined, []).split('\n')[1]).toBe('Page: https://example.com/ — "Example"')
  })

  it('marks the Slot span that was heard as a name, leaving every other span as spoken', () => {
    const { slot } = commandQuestions('Search NKBH D', PAGE, undefined, { heard })
    expect(slot.options['s1-2']).toBe('NKBH D (sounds like "MKBHD")')
    expect(slot.options['s0-2']).toBe('Search NKBH D')
    expect(slot.options['s1-1']).toBe('NKBH')
    expect(commandQuestions('Search NKBH D', PAGE).slot.options['s1-2']).toBe('NKBH D')
  })

  it('rides the Where Ask, the Mark Ask, a hop and a partial', () => {
    const hop: HopContext = { hop: 1, visited: [], actions: [], links: [], setAside: [], searched: [], terms: [] }
    expect(whereQuestions('Search NKBH D', PAGE, { heard }).slot.options['s1-2']).toBe('NKBH D (sounds like "MKBHD")')
    expect(hopQuestions('Search NKBH D', PAGE, hop, { heard }).slot.options['s1-2']).toBe('NKBH D (sounds like "MKBHD")')
    expect(partialQuestions('Search NKBH D', PAGE, { heard }).slot.options['s1-2']).toBe('NKBH D (sounds like "MKBHD")')
  })
})

describe('a search box (#398): its kind on its line, and searching it one op on the card, beside type', () => {
  const SEARCH_PAGE: CommandPage = {
    url: 'https://www.youtube.com/watch?v=abc',
    title: 'A video - YouTube',
    refs: [
      { ref: 1, kind: 'link', label: 'Home', href: 'https://www.youtube.com/', inputType: null },
      { ref: 4, kind: 'input', label: 'Search', href: null, inputType: 'text', searchBox: { holds: 'lines tactic' } },
      { ref: 5, kind: 'input', label: 'Comment', href: null, inputType: 'text' },
      { ref: 6, kind: 'button', label: 'Search', href: null, inputType: null, submitsSearch: true },
    ],
  }

  it('shows a search box as a searchbox holding its words, and the submit of its form as button[submit]', () => {
    expect(commandState('search MKBHD', SEARCH_PAGE).split('\n').filter((line) => line.startsWith('['))).toEqual([
      '[1] link "Home" https://www.youtube.com/',
      '[4] searchbox "Search" holds "lines tactic"',
      '[5] input[text] "Comment"',
      '[6] button[submit] "Search"',
    ])
    const empty: CommandPage = { ...SEARCH_PAGE, refs: [{ ref: 4, kind: 'input', label: 'Search', href: null, inputType: 'search', searchBox: { holds: '' } }] }
    expect(commandState('search MKBHD', empty).split('\n').at(-1)).toBe('[4] searchbox "Search"')
  })

  it("says what a search box holds once, in place of the tree's value state", () => {
    const focused: CommandPage = { ...SEARCH_PAGE, refs: [{ ref: 4, kind: 'input', label: 'Search', href: null, inputType: 'text', states: ['value="NKBHD"', 'focused=true', 'expanded=true'], searchBox: { holds: 'NKBHD' } }] }
    expect(commandState('search MKBHD', focused).split('\n').at(-1)).toBe('[4] searchbox "Search" holds "NKBHD" focused=true expanded=true')
  })

  it('offers search-N on every search box beside its type-N, and on no other field', () => {
    const { options } = commandQuestions('search MKBHD', SEARCH_PAGE).action
    expect(options['search-4']).toBe('search for the words with [4] searchbox "Search" holds "lines tactic": its words replaced, then submitted')
    expect(options['type-4']).toBe('type the words into [4] searchbox "Search" holds "lines tactic"')
    expect(options['type-5']).toBeDefined()
    expect(options).not.toHaveProperty('search-5')
    expect(options).not.toHaveProperty('search-6')
    // The web search stays as it is beside it (Jev chooses).
    expect(options).toHaveProperty('search')
  })

  it('reads search-N as the Slot typed into the box and submitted, and refuses it on a field that is no search box', () => {
    expect(readCommandAnswers({ action: choice('search-4'), slot: choice('s1-1') }, 'search MKBHD', SEARCH_PAGE)).toEqual({ verb: 'type', target: 4, slot: 'MKBHD', submit: true })
    expect(readCommandAnswers({ action: choice('search-5'), slot: choice('s1-1') }, 'search MKBHD', SEARCH_PAGE).verb).toBe('none')
  })

  it('names the search in the Feed and in "Done so far", and sets it aside apart from the type on the same box', () => {
    const command: Command = { verb: 'type', target: 4, slot: 'MKBHD', submit: true }
    expect(doneAction(command, SEARCH_PAGE)).toBe('search for "MKBHD" with "Search"')
    const hop: HopContext = { hop: 1, visited: [], actions: [], links: [], setAside: [setAsideOf(command, SEARCH_PAGE)!] }
    const options = hopQuestions('search MKBHD', SEARCH_PAGE, hop).action.options
    expect(options).not.toHaveProperty('search-4')
    expect(options).toHaveProperty('type-4')
  })

  it('keeps every Search Op on a full card, whose clicks fill the room before its fields do', () => {
    const buttons: CommandRef[] = Array.from({ length: 260 }, (_, n) => ({ ref: n + 2, kind: 'button', label: `Ref ${n + 2}`, href: null, inputType: null }))
    const full: CommandPage = { ...SEARCH_PAGE, refs: [{ ref: 1, kind: 'input', label: 'Search', href: null, inputType: 'search', searchBox: { holds: '' } }, ...buttons] }
    const labels = Object.keys(commandQuestions('search MKBHD', full).action.options)
    expect(labels.length).toBeLessThanOrEqual(255)
    expect(labels).toContain('search-1')
  })
})

describe('a question is searched as asked (#400): the Slot keeps it, and a hop never searches the same words again', () => {
  const TEXT = "What's the weather like in London?"
  const LANDING: CommandPage = {
    url: 'https://duckduckgo.com/?q=What%27s+the+weather+like+in+London%3F',
    title: "What's the weather like in London? at DuckDuckGo",
    refs: [
      { ref: 2, kind: 'input', label: 'Search privately', href: null, inputType: 'search', searchBox: { holds: "What's the weather like in London?" } },
      { ref: 3, kind: 'link', label: 'London - BBC Weather', href: 'https://www.bbc.com/weather/2643743', inputType: null },
    ],
  }
  const hop: HopContext = { hop: 1, visited: [], actions: [], links: [], setAside: [], searched: [], terms: [TEXT] }
  const action = (probabilities: Record<string, number>, top: string): DecisionChoiceAnswer => ({ type: 'choice', choice: top, confidence: probabilities[top] ?? 0, probabilities })

  it('tells the Slot that a line with no command word carries itself', () => {
    expect(commandQuestions(TEXT, LANDING).slot.instructions).toContain('A line with no command word, such as a question, carries itself: its search terms are the line as asked.')
  })

  it("reads a Search Op for words the Task already searched as a later hop's search: the most probable result, never the same search", () => {
    const answers = { action: action({ 'search-2': 0.6, 'click-3': 0.3 }, 'search-2'), slot: choice('s0-5') }
    expect(readCommandAnswers(answers, TEXT, LANDING, hop)).toEqual({ verb: 'click', target: 3, slot: null })
    // The same words in another case and without the punctuation are the same search.
    expect(readCommandAnswers(answers, TEXT, LANDING, { ...hop, terms: ['whats the weather like in london'] })).toEqual({ verb: 'click', target: 3, slot: null })
    // With nothing else offered any probability, the hop has no next step.
    expect(readCommandAnswers({ action: action({ 'search-2': 1 }, 'search-2'), slot: choice('s0-5') }, TEXT, LANDING, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('has no next step off a search landing when the words were already searched', () => {
    const page: CommandPage = { ...LANDING, url: 'https://www.bbc.com/weather/2643743', title: 'London - BBC Weather' }
    expect(readCommandAnswers({ action: action({ 'search-2': 0.6, 'click-3': 0.3 }, 'search-2'), slot: choice('s0-5') }, TEXT, page, hop)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('keeps a Search Op for other words, and any Search Op at hop 0', () => {
    const answers = { action: action({ 'search-2': 0.6, 'click-3': 0.3 }, 'search-2'), slot: choice('s5-5') }
    expect(readCommandAnswers(answers, TEXT, LANDING, hop)).toEqual({ verb: 'type', target: 2, slot: 'London', submit: true })
    expect(readCommandAnswers({ ...answers, slot: choice('s0-5') }, TEXT, LANDING)).toEqual({ verb: 'type', target: 2, slot: "What's the weather like in London", submit: true })
  })
})
