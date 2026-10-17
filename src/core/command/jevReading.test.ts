import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { CommandPage } from './command'
import { commandQuestions, commandState, readCommandAnswers, slotSpans } from './jevReading'

// One Jev call per Command the Local Match cannot settle (#324, ADR
// 0076): the state is the transcript, the page's address and title and
// its numbered refs — no page text; three Choices are asked in parallel —
// the verb, the target among the refs plus `none`, the Slot among the
// transcript's contiguous word spans. The top Choice is acted on at any
// confidence; only `none` as the verb drops the Utterance.

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
  it('carries the transcript, the page and the numbered refs with label, kind and href — no page text', () => {
    const state = commandState('click the first video', PAGE)
    expect(state).toBe(
      [
        'The user spoke to a web browser: "click the first video"',
        'Page: https://example.com/ — "Example"',
        'Refs (number, kind, label, address):',
        '[1] link "Home" https://example.com/',
        '[2] button "Sign in"',
        '[3] input[search] "Search"',
      ].join('\n'),
    )
  })
})

describe('the three questions', () => {
  it('asks the verb among the spoken vocabulary, the target among the refs plus none, the Slot among the word spans', () => {
    const questions = commandQuestions('type hello in search', PAGE)
    expect(Object.keys(questions)).toEqual(['verb', 'target', 'slot'])
    expect(questions.verb.type).toBe('choice')
    expect(Object.keys(questions.verb.options)).toEqual(['open', 'click', 'type', 'scroll_up', 'scroll_down', 'back', 'forward', 'press', 'read', 'clear', 'stop', 'none'])
    expect(Object.keys(questions.target.options)).toEqual(['none', 'ref-1', 'ref-2', 'ref-3'])
    expect(questions.target.options['ref-2']).toBe('button "Sign in"')
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

describe('reading the answers', () => {
  it('acts on the top choices: the verb, the ref, the span', () => {
    expect(
      readCommandAnswers({ verb: choice('type', 0.4), target: choice('ref-3', 0.3), slot: choice('s1-1', 0.5) }, 'type hello in search', PAGE),
    ).toEqual({ verb: 'type', target: 3, slot: 'hello' })
  })

  it('drops the Utterance only on a none verb', () => {
    expect(readCommandAnswers({ verb: choice('none', 0.2), target: choice('ref-2'), slot: choice('s0-0') }, 'what time is it', PAGE)).toEqual({ verb: 'none', target: null, slot: null })
  })

  it('ignores the answers a verb does not need', () => {
    expect(readCommandAnswers({ verb: choice('scroll_down'), target: choice('ref-2'), slot: choice('s0-1') }, 'scroll down please', PAGE)).toEqual({ verb: 'scroll_down', target: null, slot: null })
    expect(readCommandAnswers({ verb: choice('back'), target: choice('none'), slot: choice('none') }, 'go back', PAGE)).toEqual({ verb: 'back', target: null, slot: null })
  })

  it('reads press through the Slot, Enter when the Slot names no key', () => {
    expect(readCommandAnswers({ verb: choice('press'), target: choice('none'), slot: choice('s1-1') }, 'press escape', PAGE)).toMatchObject({ verb: 'press', slot: 'escape', key: { key: 'Escape' }, times: 1 })
    expect(readCommandAnswers({ verb: choice('press'), target: choice('none'), slot: choice('none') }, 'submit it', PAGE)).toMatchObject({ verb: 'press', key: { key: 'Enter' } })
  })

  it('takes the most probable ref when the target answers none for a verb that needs one', () => {
    const target: DecisionChoiceAnswer = { type: 'choice', choice: 'none', confidence: 0.5, probabilities: { none: 0.5, 'ref-1': 0.1, 'ref-2': 0.35, 'ref-3': 0.05 } }
    expect(readCommandAnswers({ verb: choice('click'), target, slot: choice('none') }, 'click sign', PAGE)).toEqual({ verb: 'click', target: 2, slot: null })
  })

  it('falls back to the words after the verb when the Slot answers none for a verb that needs one', () => {
    expect(readCommandAnswers({ verb: choice('open'), target: choice('none'), slot: choice('none') }, 'please open youtube', PAGE)).toEqual({ verb: 'open', target: null, slot: 'please open youtube' })
    expect(readCommandAnswers({ verb: choice('type'), target: choice('ref-3'), slot: choice('none') }, 'type hello', PAGE)).toEqual({ verb: 'type', target: 3, slot: 'hello' })
  })

  it('opens an element on the page by clicking it when open\'s target names a ref and the words are not an address', () => {
    expect(readCommandAnswers({ verb: choice('open'), target: choice('ref-1', 0.64), slot: choice('none') }, "open elon musk's profile", PAGE)).toEqual({ verb: 'click', target: 1, slot: null })
    // An address is navigated whatever the target says; a target of none leaves the words to openAddress.
    expect(readCommandAnswers({ verb: choice('open'), target: choice('ref-1'), slot: choice('none') }, 'open youtube', PAGE)).toEqual({ verb: 'open', target: null, slot: 'youtube' })
    expect(readCommandAnswers({ verb: choice('open'), target: choice('none'), slot: choice('none') }, "open elon musk's profile", PAGE)).toEqual({ verb: 'open', target: null, slot: "elon musk's profile" })
  })

  it('drops a click on a page with no refs', () => {
    expect(readCommandAnswers({ verb: choice('click'), target: choice('none'), slot: choice('none') }, 'click it', { ...PAGE, refs: [] })).toEqual({ verb: 'none', target: null, slot: null })
  })
})
