import { describe, expect, it } from 'vitest'
import { firstJsonObject, plannerMessages, readPlannerAnswer } from './plannerAsk'

describe('firstJsonObject (#465): the answer is the first JSON object in the reply', () => {
  it.each([
    ['{"next":"done","sentence":"Done."}', { next: 'done', sentence: 'Done.' }],
    ['Sure.\n```json\n{"next":"ask","question":"Which one?"}\n```', { next: 'ask', question: 'Which one?' }],
    ['{"a":"a } in a string","b":{"c":[1,2]}} and {"later":1}', { a: 'a } in a string', b: { c: [1, 2] } }],
    ['{"escaped":"a \\" quote {"}', { escaped: 'a " quote {' }],
    ['{ not json } then {"ok":true}', { ok: true }],
  ])('reads %j', (content, expected) => {
    expect(firstJsonObject(content)).toEqual(expected)
  })

  it.each(['no object here', '', '[1,2]', '{"open": "never closed"'])('finds none in %j', (content) => {
    expect(firstJsonObject(content)).toBeNull()
  })
})

describe('readPlannerAnswer (#465): exactly one of act, done or ask, or why not', () => {
  it.each([
    [{ next: 'act', action: { kind: 'click', ref: 12 }, class: 'stays', why: 'the comment box' }, { next: 'act', action: { kind: 'click', ref: 12 }, class: 'stays', why: 'the comment box' }],
    [{ next: 'act', action: { kind: 'type', ref: 4, text: 'this is great' }, class: 'leaves', why: '' }, { next: 'act', action: { kind: 'type', ref: 4, text: 'this is great' }, class: 'leaves', why: '' }],
    [{ next: 'act', action: { kind: 'scroll', direction: 'down' }, class: 'stays' }, { next: 'act', action: { kind: 'scroll', direction: 'down' }, class: 'stays', why: '' }],
    [{ next: 'act', action: { kind: 'scroll', direction: 'up', ref: 3 }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'scroll', direction: 'up', ref: 3 }, class: 'stays', why: 'w' }],
    [{ next: 'act', action: { kind: 'press', key: 'Enter' }, class: 'leaves', why: 'w' }, { next: 'act', action: { kind: 'press', key: 'Enter' }, class: 'leaves', why: 'w' }],
    [{ next: 'act', action: { kind: 'navigate', url: 'https://en.wikipedia.org' }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'navigate', url: 'https://en.wikipedia.org' }, class: 'stays', why: 'w' }],
    [{ next: 'act', action: { kind: 'back' }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'back' }, class: 'stays', why: 'w' }],
    [{ next: 'act', action: { kind: 'read', part: 'p3' }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'read', part: 'p3' }, class: 'stays', why: 'w' }],
    [{ next: 'act', action: { kind: 'media', ref: 2, op: 'forward', amount: '30s' }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'media', ref: 2, op: 'forward', amount: '30s' }, class: 'stays', why: 'w' }],
    [{ next: 'act', action: { kind: 'capture', ref: 9 }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'capture', ref: 9 }, class: 'stays', why: 'w' }],
    [{ next: 'act', action: { kind: 'verb', verb: 'play', words: 'lofi' }, class: 'stays', why: 'w' }, { next: 'act', action: { kind: 'verb', verb: 'play', words: 'lofi' }, class: 'stays', why: 'w' }],
    [{ next: 'done', sentence: 'The comment is posted.' }, { next: 'done', sentence: 'The comment is posted.' }],
    [{ next: 'ask', question: 'Which playlist?' }, { next: 'ask', question: 'Which playlist?' }],
  ])('reads %j', (raw, expected) => {
    expect(readPlannerAnswer(raw)).toEqual(expected)
  })

  it.each([
    [null, 'not an object'],
    [{ next: 'wander' }, 'next is not act, done or ask'],
    [{ next: 'done' }, 'done carries no sentence'],
    [{ next: 'ask', question: '  ' }, 'ask carries no question'],
    [{ next: 'act', action: { kind: 'click', ref: 1 } }, 'class is not stays or leaves'],
    [{ next: 'act', action: { kind: 'evaluate', script: 'x' }, class: 'stays' }, 'action kind "evaluate" is not one of click, type, scroll, press, navigate, back, read, media, capture, verb'],
    [{ next: 'act', action: { kind: 'click', ref: 'twelve' }, class: 'stays' }, 'click needs a ref number'],
    [{ next: 'act', action: { kind: 'click', ref: 0 }, class: 'stays' }, 'click needs a ref number'],
    [{ next: 'act', action: { kind: 'type', ref: 3 }, class: 'stays' }, 'type needs a ref number and its text'],
    [{ next: 'act', action: { kind: 'scroll', direction: 'sideways' }, class: 'stays' }, 'scroll needs up or down'],
    [{ next: 'act', action: { kind: 'navigate' }, class: 'stays' }, 'navigate needs a url'],
    [{ next: 'act', action: 'click 12', class: 'stays' }, 'no action'],
  ])('refuses %j: %s', (raw, problem) => {
    expect(readPlannerAnswer(raw)).toBe(problem)
  })
})

describe('plannerMessages (#465): the ask put to the Planner', () => {
  it('puts the Goal Line on its own labelled line, then the page, the verbs, the steps done, the captures and the card', () => {
    const { system, user } = plannerMessages({
      goalLine: 'Comment "this is great" on this video.',
      page: { url: 'https://www.youtube.com/watch?v=x', title: 'A video' },
      verbs: { play: 'search YouTube and play the first result', skip: null },
      memory: {
        steps: [{ action: 'click 12 (Add a comment)', outcome: 'the comment box opened' }],
        captures: [{ what: 'text of ref 4', text: 'npm init playwright@latest' }, { what: 'image of ref 7', file: 'thumb.jpg' }],
        card: 'Refs:\n[12] textbox "Add a comment"',
      },
    })
    expect(system).toMatch(/exactly one JSON object/)
    expect(system).toMatch(/"leaves"/)
    expect(user.split('\n')).toEqual([
      'Goal Line: Comment "this is great" on this video.',
      'Page: https://www.youtube.com/watch?v=x — "A video"',
      '',
      'Appliance Verbs:',
      '- play: search YouTube and play the first result',
      '- skip',
      '',
      'Steps done:',
      '1. click 12 (Add a comment) → the comment box opened',
      '',
      'Captured:',
      '- text of ref 4: "npm init playwright@latest"',
      '- image of ref 7: on the Shelf as thumb.jpg',
      '',
      'The card:',
      'Refs:',
      '[12] textbox "Add a comment"',
    ])
  })

  it('says so when nothing is done, captured or carded yet', () => {
    const { user } = plannerMessages({ goalLine: 'Find me a cheaper one of these.', page: { url: 'about:blank', title: '' }, verbs: {}, memory: { steps: [], captures: [], card: null } })
    expect(user).toBe(['Goal Line: Find me a cheaper one of these.', 'Page: about:blank — ""', '', 'Appliance Verbs: none', '', 'Steps done: none yet', '', 'Captured: nothing', '', 'The card: none yet'].join('\n'))
  })
})
