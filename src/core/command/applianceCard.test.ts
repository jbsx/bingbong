import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { MediaFacts } from '../browser/snapshot'
import { defaultSettings } from '../settings/settings'
import type { AppState } from './appOp'
import { PAGE_LABEL, applianceQuestions, applianceState, fateOfAnswers, readApplianceAnswers, type ApplianceView } from './applianceCard'
import { PEEK_CARD_LINGER_MS } from '../panel/peekCardState'
import { ENDED_WINDOW_MS, doingAnswer, endedWithin, stoppedLine, type EndedCommand, type RunningCommand } from './runningCommand'
import type { CommandAnswers } from './jevReading'

const choice = (label: string, confidence = 0.9): DecisionChoiceAnswer => ({ type: 'choice', choice: label, confidence, probabilities: { [label]: confidence } })

const FACTS: MediaFacts = { paused: false, ended: false, currentTime: 16.2, duration: 111, volume: 0.5, muted: false, loop: false, rate: 1, seekable: { start: 0, end: 111 }, tracks: 0, captions: null, hiddenTrack: false, buffering: false, failed: false }

const APP: AppState = { panel: { mode: 'overlay', open: false, width: 536 }, view: 'dashboard', idle: false, settings: defaultSettings(), voices: ['en_GB-alba-medium'], version: '0.1.1' }

const WATCH: ApplianceView = {
  url: 'https://www.youtube.com/watch?v=abc',
  title: 'Tum Se - YouTube',
  media: { title: 'Tum Se', facts: FACTS },
  appliance: { queued: true, app: APP, facts: { now: 0, timeZone: 'UTC', weather: null } },
  flaggable: true,
  timer: true,
}

const answers = (action: string, rest: Partial<Record<'slot' | 'amount' | 'where', string>> = {}): CommandAnswers =>
  ({ action: choice(action), slot: choice(rest.slot ?? 'none'), ...(rest.amount !== undefined ? { amount: choice(rest.amount) } : {}), ...(rest.where !== undefined ? { where: choice(rest.where) } : {}) }) as CommandAnswers

describe('the Appliance Card (#485): built from what the appliance holds, no page ref on it', () => {
  it('offers the playing element\'s every Media Op by kind, the Player, the facts, the app, the Flag, Help, the Timer, stop, page and none', () => {
    const labels = Object.keys(applianceQuestions('lower the volume', WATCH).action.options)
    for (const label of ['media-pause', 'media-volume', 'media-forward', 'play', 'skip', 'show', 'say_time', 'show_idle', 'show_dashboard', 'settings', 'app_update', 'flag', 'help', 'timer', 'timer_off', 'stop', PAGE_LABEL, 'none']) expect(labels).toContain(label)
    expect(labels.some((label) => /^(click|type|menu|open)-\d+$/.test(label))).toBe(false)
    expect(labels).not.toContain('back')
  })

  it('carries the Amount beside a media op, and where beside play on a site', () => {
    const questions = applianceQuestions('lower the volume', { ...WATCH, url: 'https://en.wikipedia.org/wiki/Song', title: 'Song' })
    expect(questions.amount).toBeDefined()
    expect(questions.where).toBeDefined()
  })

  it('offers no media op, no flag and no timer when the appliance holds none of them', () => {
    const labels = Object.keys(applianceQuestions('hello', { url: 'about:blank', title: '' }).action.options)
    expect(labels).toEqual(['help', 'stop', PAGE_LABEL, 'none'])
    expect(applianceQuestions('hello', { url: 'about:blank', title: '' }).amount).toBeUndefined()
  })

  it('names the page open and what plays in its state, and nothing of the page\'s refs', () => {
    const state = applianceState('pause', WATCH)
    expect(state).toContain('Page open: https://www.youtube.com/watch?v=abc — "Tum Se - YouTube"')
    expect(state).toContain('Playing: "Tum Se" playing 0:16/1:51 volume 50% loop off')
    expect(state).not.toContain('Refs')
  })

  it('offers no web verb: an open or a web search goes on to the page card (T2, measured)', () => {
    expect(Object.keys(applianceQuestions('open bbc', WATCH).action.options)).not.toContain('navigate')
    expect(Object.keys(applianceQuestions('open bbc', WATCH).action.options)).not.toContain('search')
  })

  it("names the browser view the app's own home screen, a recorded page-card line too, so a site's home stays the page's", () => {
    const recorded = { lines: { show_dashboard: 'app: show the browser, leaving Settings or the Weight page — now showing the browser' }, amount: false }
    for (const view of [WATCH, { ...WATCH, appliance: undefined, recorded }]) {
      expect(applianceQuestions('go to the home page', view).action.options.show_dashboard).toMatch(/^app: show the app's own home screen, the browser, .* not a website's home page — now showing the browser$/)
    }
  })

  it('asks steps only on a whole line with a conjunction', () => {
    expect(applianceQuestions('pause and show the idle screen', WATCH, { steps: true }).steps).toBeDefined()
    expect(applianceQuestions('pause and show the idle screen', WATCH).steps).toBeUndefined()
  })
})

describe('reading the Appliance Card', () => {
  it('fires a Media Op on the element by kind, with no ref number', () => {
    expect(readApplianceAnswers(answers('media-volume', { amount: 'down-step' }), 'lower the volume', WATCH)).toEqual({ kind: 'command', command: { verb: 'media', target: null, slot: null, mediaOp: { op: 'volume', to: 40 } } })
    expect(readApplianceAnswers(answers('media-pause'), 'pause', WATCH)).toEqual({ kind: 'command', command: { verb: 'media', target: null, slot: null, mediaOp: { op: 'pause' } } })
  })

  it('sends page and none on to the page card', () => {
    expect(readApplianceAnswers(answers(PAGE_LABEL), 'click the second video', WATCH)).toEqual({ kind: 'page', chose: 'page' })
    expect(readApplianceAnswers(answers('none'), 'hello', WATCH)).toEqual({ kind: 'page', chose: 'none' })
  })

  it('reads the Player\'s play with its words, and a play pointing at this page goes on to the page card', () => {
    expect(readApplianceAnswers(answers('play', { slot: 's1-2' }), 'play feeling good', WATCH)).toEqual({ kind: 'command', command: { verb: 'play', target: null, slot: 'feeling good', music: { kind: 'search', place: 'now' } } })
    const wiki = { ...WATCH, url: 'https://en.wikipedia.org/wiki/Song', title: 'Song' }
    expect(readApplianceAnswers(answers('play', { slot: 's1-2', where: 'page' }), 'play the clip', wiki)).toEqual({ kind: 'page', chose: 'page' })
    expect(readApplianceAnswers(answers('play', { slot: 's1-2', where: 'site' }), 'play the clip', wiki)).toMatchObject({ kind: 'command', command: { verb: 'search', site: 'en.wikipedia.org' } })
  })

  it('reads the Flag with its hint, Help, the Timer, a fact and an app op', () => {
    expect(readApplianceAnswers(answers('flag'), 'flag it as failure', WATCH)).toEqual({ kind: 'flag' })
    expect(readApplianceAnswers(answers('flag', { slot: 's3-5' }), 'mark as failure it played the wrong song', WATCH)).toEqual({ kind: 'flag', hint: 'it played the' })
    expect(readApplianceAnswers(answers('help'), 'help', WATCH)).toMatchObject({ command: { verb: 'help' } })
    expect(readApplianceAnswers(answers('timer'), 'set a timer for five minutes', WATCH)).toMatchObject({ command: { verb: 'timer', durationMs: 300_000 } })
    expect(readApplianceAnswers(answers('timer'), 'set a timer', WATCH)).toEqual({ kind: 'page', chose: 'page' })
    expect(readApplianceAnswers(answers('say_time'), 'what time is it', WATCH)).toMatchObject({ command: { verb: 'say', fact: 'time' } })
    expect(readApplianceAnswers(answers('show_idle'), 'go back to home page', WATCH)).toMatchObject({ command: { verb: 'app', app: { kind: 'view', view: 'idle' } } })
  })

  it('carries the update beside the settings line, with the version running, and fires it (#422)', () => {
    const options = applianceQuestions('check for updates', WATCH).action.options
    const labels = Object.keys(options)
    expect(labels.indexOf('app_update')).toBe(labels.indexOf('settings') + 1)
    expect(options.app_update).toBe('app: update — now version 0.1.1')
    expect(readApplianceAnswers(answers('app_update'), 'check for updates', WATCH)).toMatchObject({ command: { verb: 'app', app: { kind: 'update' } } })
  })

  it('goes on to the page card for an option the card cannot fire', () => {
    expect(readApplianceAnswers(answers('media-volume', { amount: 'to' }), 'volume', WATCH)).toEqual({ kind: 'page', chose: 'page' })
    expect(readApplianceAnswers(answers('media-pause'), 'pause', { ...WATCH, media: undefined })).toEqual({ kind: 'page', chose: 'page' })
    expect(readApplianceAnswers(answers('click-3'), 'click', WATCH)).toEqual({ kind: 'page', chose: 'page' })
  })
})

describe('the running Command on the Appliance Card (#489)', () => {
  const RUNNING: RunningCommand = { words: 'play let down by radiohead', stage: 'Loading', detail: 'youtube.com', done: [], opening: 'let down by radiohead' }

  it('leaves an idle line\'s card byte for byte as it was: no running lines, no doing fact, no Fate', () => {
    expect(applianceState('pause', { ...WATCH, running: undefined })).toBe(
      'The user spoke to the appliance, a voice-driven web browser: "pause"\nPage open: https://www.youtube.com/watch?v=abc — "Tum Se - YouTube"\nPlaying: "Tum Se" playing 0:16/1:51 volume 50% loop off',
    )
    const questions = applianceQuestions('pause', WATCH)
    expect(Object.keys(questions)).not.toContain('fate')
    expect(Object.keys(questions.action.options)).not.toContain('say_doing')
  })

  it('carries its words on a labelled line, its stage, and the media it is opening; asks its Fate after the action; offers the doing fact before page', () => {
    const view = { ...WATCH, running: RUNNING }
    const state = applianceState('on loop', view)
    expect(state).toContain('Still running, from the user\'s line before this one: "play let down by radiohead"')
    expect(state).toContain('Its stage: Loading youtube.com')
    expect(state).toContain('It is opening: "let down by radiohead", not playing yet')
    const questions = applianceQuestions('on loop', view)
    expect(Object.keys(questions).slice(0, 3)).toEqual(['action', 'fate', 'slot'])
    expect(Object.keys(questions.fate!.options)).toEqual(['ends', 'joins', 'waits', 'goes_on'])
    const labels = Object.keys(questions.action.options)
    expect(labels.indexOf('say_doing')).toBe(labels.indexOf(PAGE_LABEL) - 1)
    expect(questions.action.options.say_doing).toContain("Still opening “let down by radiohead”: loading youtube.com.")
  })

  it('says how long before the line being read the running one was given, when the runner knows (T1)', () => {
    const state = applianceState('Page.', { ...WATCH, running: { words: 'Back to-', stage: 'Thinking', done: [], sinceMs: 1039 } })
    expect(state).toContain('Still running, from the user\'s line before this one, given 1.0 s before it: "Back to-"')
  })

  it('reads the Fate, unsure or missing as goes on; and the doing fact only while a line runs', () => {
    const view = { ...WATCH, running: RUNNING }
    expect(fateOfAnswers({ ...answers('media-loop'), fate: choice('waits') } as unknown as CommandAnswers, view)).toBe('waits')
    expect(fateOfAnswers({ ...answers('media-loop'), fate: choice('ends', 0.4) } as unknown as CommandAnswers, view)).toBe('goes_on')
    expect(fateOfAnswers(answers('media-loop'), view)).toBe('goes_on')
    expect(fateOfAnswers(answers('media-loop'), WATCH)).toBeUndefined()
    expect(readApplianceAnswers(answers('say_doing'), 'what are you doing', view)).toMatchObject({ command: { verb: 'say', fact: 'doing' } })
    expect(readApplianceAnswers(answers('say_doing'), 'what are you doing', WATCH)).toEqual({ kind: 'page', chose: 'page' })
  })

  it('says an ended line in one sentence, naming what it was doing', () => {
    expect(stoppedLine('Playing let down by radiohead')).toBe('Stopped playing let down by radiohead.')
    expect(stoppedLine(undefined)).toBe('Stopped.')
    // An Errand's object is its line's words; an object's own end stop is never doubled (ui.md 10).
    expect(stoppedLine('“play let down”')).toBe('Stopped “play let down”.')
    expect(stoppedLine('Searching for tour dates.')).toBe('Stopped searching for tour dates.')
    expect(doingAnswer(null)).toBe('Nothing is running.')
  })
})

describe('the line just ended on the Appliance Card (#499)', () => {
  const ENDED: EndedCommand = { words: 'play let down by radiohead', outcome: 'done', answer: 'Playing “Let Down (Remastered)”.', agoMs: 3225 }

  it('offers the doing fact for it before page, naming how it ended and how long ago, kept to a question; the state as it was; no Fate', () => {
    const view = { ...WATCH, ended: ENDED }
    // Measured: the ended line's lines on the state lured the next line's own action (arm J, runningCommand.ts).
    expect(applianceState('is it working', view)).toBe(applianceState('is it working', WATCH))
    const questions = applianceQuestions('is it working', view)
    expect(Object.keys(questions)).not.toContain('fate')
    const labels = Object.keys(questions.action.options)
    expect(labels.indexOf('say_doing')).toBe(labels.indexOf(PAGE_LABEL) - 1)
    expect(questions.action.options.say_doing).toBe(
      "appliance: answer a question about the user's line just before this one, whether it worked and how it ended — never a new request — Done, 3 seconds ago: Playing “Let Down (Remastered)”.",
    )
    expect(readApplianceAnswers(answers('say_doing'), 'is it working', view)).toMatchObject({ command: { verb: 'say', fact: 'doing' } })
    expect(fateOfAnswers(answers('say_doing'), view)).toBeUndefined()
  })

  it('says its end in one sentence: done with its sentence, failed, or stopped', () => {
    expect(doingAnswer(null, ENDED)).toBe('Done, 3 seconds ago: Playing “Let Down (Remastered)”.')
    expect(doingAnswer(null, { ...ENDED, agoMs: 900 })).toBe('Done, 1 second ago: Playing “Let Down (Remastered)”.')
    expect(doingAnswer(null, { words: 'open bbc.com', outcome: 'failed', answer: "Couldn't open bbc.com.\n\nTry “search bbc”.", agoMs: 5000 })).toBe("Didn't work, 5 seconds ago: Couldn't open bbc.com.")
    expect(doingAnswer(null, { words: 'play hurt', outcome: 'cancelled', agoMs: 2000 })).toBe('Stopped, 2 seconds ago: “play hurt”.')
    expect(doingAnswer(null, { words: 'Play the song from the beginning.', outcome: 'done', agoMs: 2000 })).toBe('Done, 2 seconds ago: “Play the song from the beginning”.')
    // A line running is what the doing fact says, whatever ended before it.
    expect(doingAnswer({ words: 'open bbc.com', stage: 'Loading', detail: 'bbc.com', done: [] }, ENDED)).toBe('Still on “open bbc.com”: loading bbc.com.')
  })

  it('leaves a card with a line running as it was, whatever ended before it', () => {
    const running: RunningCommand = { words: 'play let down by radiohead', stage: 'Loading', detail: 'youtube.com', done: [], opening: 'let down by radiohead' }
    expect(applianceState('on loop', { ...WATCH, running, ended: ENDED })).toBe(applianceState('on loop', { ...WATCH, running }))
    expect(applianceQuestions('on loop', { ...WATCH, running, ended: ENDED })).toEqual(applianceQuestions('on loop', { ...WATCH, running }))
  })

  it('leaves the card byte for byte as before with no line ended in the window', () => {
    expect(applianceState('is it working', { ...WATCH, ended: undefined })).toBe(applianceState('is it working', WATCH))
    expect(applianceQuestions('is it working', { ...WATCH, ended: undefined })).toEqual(applianceQuestions('is it working', WATCH))
    expect(readApplianceAnswers(answers('say_doing'), 'is it working', WATCH)).toEqual({ kind: 'page', chose: 'page' })
  })

  it('keeps an ended line for 15 s from its end, the Peek Card and Turn Card linger', () => {
    expect(ENDED_WINDOW_MS).toBe(PEEK_CARD_LINGER_MS)
    expect(endedWithin({ words: 'w', outcome: 'done', at: 1_000 }, 16_000)).toEqual({ words: 'w', outcome: 'done', agoMs: 15_000 })
    expect(endedWithin({ words: 'w', outcome: 'done', at: 1_000 }, 16_001)).toBeUndefined()
    expect(endedWithin(null, 2_000)).toBeUndefined()
  })
})
