import { describe, expect, it } from 'vitest'
import { askedStep, capLine, confirmStep, doneSoFar, errandMemory, plannerMemoryOf, unansweredLine, unavailableLine, withCapture, withCard, withStep } from './errandMemory'

const clicked = { why: 'open the comment box', action: 'click [12] input "Add a comment…"', class: 'stays' as const, outcome: 'clicked [12] → the box is focused', said: 'Clicked “Add a comment…”.', seconds: 4.2 }
const typed = { why: 'write the comment', action: 'type into [12]: "this is great"', class: 'stays' as const, outcome: 'typed', said: 'Typed into “Add a comment…”.', seconds: 3 }

describe('errandMemory (#467): what an Errand carries from step to step', () => {
  it('starts from the Goal Line alone', () => {
    expect(errandMemory('Comment "this is great" on this video.')).toEqual({ goalLine: 'Comment "this is great" on this video.', steps: [], captures: [], card: null })
  })

  it('grows a step, a capture and the card, the memory before left as it was', () => {
    const start = errandMemory('g')
    const next = withCard(withCapture(withStep(start, clicked), { what: 'the text "npm init playwright@latest"', file: 'capture-1.txt', text: 'npm init playwright@latest' }), 'Refs: …')
    expect(start.steps).toEqual([])
    expect(next.steps).toEqual([clicked])
    expect(next.captures).toEqual([{ what: 'the text "npm init playwright@latest"', file: 'capture-1.txt', text: 'npm init playwright@latest' }])
    expect(next.card).toBe('Refs: …')
  })

  it('takes a Task that ended not done as its first steps (the hand-off)', () => {
    const memory = errandMemory('Order the same shoes as last time.', { actions: ['searched the web for "same shoes" → it opened duckduckgo.com'], ended: 'cap' })
    expect(memory.steps).toEqual([{ why: 'the Task before this Errand', action: 'searched the web for "same shoes" → it opened duckduckgo.com', class: 'stays', outcome: 'done', seconds: 0 }, { why: 'the Task before this Errand', action: 'the Task stopped', class: 'stays', outcome: 'it ran out of actions, and handed the line to you', seconds: 0 }])
  })

  it('is the port\'s memory for the Planner: each step its action, why, class, seconds and outcome', () => {
    const memory = withCard(withStep(errandMemory('g'), clicked), 'the card')
    expect(plannerMemoryOf(memory)).toEqual({
      steps: [{ action: 'click [12] input "Add a comment…" — open the comment box', outcome: 'clicked [12] → the box is focused', class: 'stays', seconds: 4.2 }],
      captures: [],
      card: 'the card',
    })
  })
})

describe('the question back and the confirm in the memory (#467): the person\'s answer is a step', () => {
  it('an answered question', () => {
    expect(askedStep('Which shoes?', 'the white ones', 6)).toEqual({ why: 'a question back', action: 'asked: "Which shoes?"', class: 'stays', outcome: 'the person answered: "the white ones"', seconds: 6 })
  })

  it('a confirm said yes to fires; said no to, or let go, does not, and the Planner carries on from it', () => {
    const confirm = { verb: 'comment', what: 'this is great' }
    expect(confirmStep(confirm, 'yes', true, 2)).toMatchObject({ action: 'said back: "This will comment: this is great. Yes or no?"', outcome: 'the person said yes: it was done', class: 'leaves' })
    expect(confirmStep(confirm, 'no', false, 2)).toMatchObject({ outcome: 'the person said no ("no"): it was not done' })
    expect(confirmStep(confirm, null, false, 8)).toMatchObject({ outcome: 'no answer: it was not done' })
  })
})

describe('what an Errand says when it ends otherwise than done (#467)', () => {
  it('says what was done so far, by the Answers of its steps', () => {
    const memory = withStep(withStep(errandMemory('g'), clicked), typed)
    expect(doneSoFar(memory)).toBe('Done so far: clicked “Add a comment…”; typed into “Add a comment…”.')
    expect(doneSoFar(errandMemory('g'))).toBe('Nothing done yet.')
  })

  it('at the cap: done so far, then that it ran out of time', () => {
    expect(capLine(withStep(errandMemory('g'), clicked))).toBe('Done so far: clicked “Add a comment…”. Ran out of time.')
    expect(capLine(errandMemory('g'))).toBe('Nothing done yet. Ran out of time.')
  })

  it('with the Planner gone: that it did not answer, then done so far', () => {
    expect(unavailableLine(withStep(errandMemory('g'), clicked))).toBe('The planner did not answer. Done so far: clicked “Add a comment…”.')
  })

  it('with its question unanswered: the question, then that it ends there', () => {
    expect(unansweredLine('Which shoes?')).toBe('Which shoes? Ending there.')
    expect(unansweredLine('Which shoes')).toBe('Which shoes? Ending there.')
  })
})
