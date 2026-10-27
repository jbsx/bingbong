import { describe, expect, it } from 'vitest'
import type { DecisionQuestions } from '../ports/decisionModel'
import { applianceAskOf, companionCase, companionExpectations, isHopZeroCommandAsk } from './applianceCompanion'
import type { JevCase } from './jevCase'

const choice = (instructions: string, options: Record<string, string>) => ({ type: 'choice' as const, instructions, options })

const STATE = [
  'The user spoke to a web browser: "lower the volume"',
  'Heard by ear, so a word may be misheard: "volum" sounds like "volume", a command the app answers to',
  'Page: https://www.youtube.com/watch?v=abc — "Tum Se - YouTube"',
  'Refs (number, kind, label, address, states):',
  '[3] link "Home" https://www.youtube.com/',
  '[7] media "Tum Se" playing 1:33/2:44 volume 70% loop on',
  '[9] media "Promo" paused 0:00/0:30 volume 100% loop off',
].join('\n')

const QUESTIONS: DecisionQuestions = {
  action: choice("Which one action does the browser take for the user's words?", {
    'click-3': 'click [3] link "Home"',
    'pause-7': 'pause [7] "Tum Se"',
    'volume-7': 'change the volume of [7] "Tum Se"',
    'forward-7': 'go forward in [7]',
    'play-9': 'play [9] "Promo"',
    back: 'go back to the previous page',
    play: 'music: find a song or video by the words and play it now',
    say_time: 'appliance: say the time — 12:34',
    show_idle: 'app: show the Idle Screen',
    none: 'not a command for this page',
  }),
  slot: choice('Which words', { none: 'none', 's0-0': 'lower' }),
  extent: choice('How far', { screen: 'a screen' }),
  amount: choice('How far', { 'down-step': 'down a step' }),
}

describe('the Appliance companion of a recorded page-card ask (#485)', () => {
  it('builds the Appliance Card from the recorded state: the started media, the appliance\'s own lines, no page ref', () => {
    const made = applianceAskOf({ state: STATE, questions: QUESTIONS })!
    expect(made.state).toContain('Playing: "Tum Se" playing 1:33/2:44 volume 70% loop on')
    expect(made.state).toContain('"volum" sounds like "volume"')
    const labels = Object.keys((made.questions.action as { options: Record<string, string> }).options)
    expect(labels).toEqual(expect.arrayContaining(['media-pause', 'media-volume', 'media-forward', 'play', 'say_time', 'show_idle', 'page', 'none']))
    expect(labels.some((label) => /-\d+$/.test(label))).toBe(false)
    expect(labels).not.toContain('back')
  })

  it('adds the update beside the settings line wherever the page card carried the app (#422), and none where it did not', () => {
    const withApp: DecisionQuestions = { ...QUESTIONS, action: choice('Which', { ...(QUESTIONS.action as { options: Record<string, string> }).options, settings: 'app setting: change one' }) }
    const labels = Object.keys((applianceAskOf({ state: STATE, questions: withApp })!.questions.action as { options: Record<string, string> }).options)
    expect(labels.indexOf('app_update')).toBe(labels.indexOf('settings') + 1)
    expect(Object.keys((applianceAskOf({ state: STATE, questions: QUESTIONS })!.questions.action as { options: Record<string, string> }).options)).not.toContain('app_update')
    expect(companionExpectations([{ question: 'action', label: 'app_update' }], withApp)).toEqual([{ question: 'action', label: 'app_update' }])
  })

  it('leaves a never-started element on the page: a paused promo at 0:00 is no media', () => {
    const promoOnly = STATE.replace('[7] media "Tum Se" playing 1:33/2:44 volume 70% loop on\n', '')
    expect(applianceAskOf({ state: promoOnly, questions: QUESTIONS })!.state).toContain('Playing: nothing')
  })

  it('has none for a later hop or a settings ask', () => {
    expect(isHopZeroCommandAsk({ state: `${STATE}\nThis is step 2 of the task. Done so far: x`, questions: QUESTIONS })).toBe(false)
    expect(isHopZeroCommandAsk({ state: STATE, questions: { ...QUESTIONS, progress: { type: 'noul', instructions: '' } } as unknown as DecisionQuestions })).toBe(false)
  })

  it('maps the expectations: the appliance\'s op as itself, a page action to page or none, the Amount kept beside a media op', () => {
    const questions = applianceAskOf({ state: STATE, questions: QUESTIONS })!.questions
    expect(companionExpectations([{ question: 'action', label: 'volume-7' }, { question: 'amount', label: 'down-step' }], questions)).toEqual([{ question: 'action', label: 'media-volume' }, { question: 'amount', label: 'down-step' }])
    expect(companionExpectations([{ question: 'action', label: 'click-3' }, { question: 'amount', label: 'down-step' }], questions)).toEqual([{ question: 'action', label: 'page|none' }])
    expect(companionExpectations([{ question: 'action', not: 'say_weather' }], questions)).toEqual([{ question: 'action', not: 'say_weather' }])
    expect(companionExpectations([{ question: 'action', not: 'click-3' }], questions)).toEqual([{ question: 'action', label: 'page|none' }])
  })

  it('writes a companion case naming its source', () => {
    const source: JevCase = { turnId: 't1', transcript: 'lower the volume', expect: [{ question: 'action', label: 'volume-7' }], ask: { state: STATE, questions: QUESTIONS } }
    const made = companionCase('t1', source)!
    expect(made.note).toContain('t1')
    expect(made.expect).toEqual([{ question: 'action', label: 'media-volume' }])
    expect(companionCase('t1-appliance', source)).toBeNull()
  })
})
