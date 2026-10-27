import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { MediaFacts } from '../browser/snapshot'
import { defaultSettings } from '../settings/settings'
import type { AppState } from './appOp'
import { PAGE_LABEL, applianceQuestions, applianceState, readApplianceAnswers, type ApplianceView } from './applianceCard'
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
