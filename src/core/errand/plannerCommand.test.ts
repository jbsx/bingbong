import { describe, expect, it } from 'vitest'
import type { CommandPage } from '../command/command'
import type { PlannerAction } from '../ports/plannerModel'
import { errandCard, errandVerbs, resolveAction } from './plannerCommand'

const GOAL = 'Copy the Playwright install command to the clipboard.'
const page: CommandPage = {
  url: 'https://playwright.dev/docs/intro',
  title: 'Installation | Playwright',
  refs: [
    { ref: 1, kind: 'input', label: 'Search docs', href: null, inputType: 'search', searchBox: { holds: '' } },
    { ref: 2, kind: 'button', label: 'Comment', href: null, inputType: null },
    { ref: 3, kind: 'link', label: 'How to install Playwright', href: 'https://playwright.dev/docs/intro#installing-playwright', inputType: null },
  ],
  viewportText: ['Installation'],
  textBelow: [{ text: 'npm init playwright@latest', kind: 'code', frame: null, node: 7 }],
}
const card = errandCard(GOAL, page, { hop: 1, visited: [page.url], actions: [], links: [] }, { appliance: { queued: false } })
const resolve = (action: PlannerAction) => resolveAction(action, card)

describe('errandCard (#467): the card the Planner sees is the one Jev would, with its offers', () => {
  it('is the state Jev reads, with each line it offers by id', () => {
    const lines = card.text.split('\n')
    expect(lines[0]).toBe(`The user spoke to a web browser: ${JSON.stringify(GOAL)}`)
    expect(lines).toContainEqual(expect.stringMatching(/^\[1\] searchbox "Search docs"$/))
    expect(lines).toContain('The card offers (id: what it does):')
    expect(lines).toContainEqual(expect.stringMatching(/^capture-text-1: copy the text \[text-1\] code "npm init playwright@latest"/))
    expect(lines).toContainEqual(expect.stringMatching(/^show-1: scroll until \[text-1\]/))
    expect(lines).toContainEqual(expect.stringMatching(/^click-2: click \[2\] button "Comment"/))
    // The ref-less browser verbs are the Planner's own kinds: only the web's search is offered, by its words.
    expect(lines).not.toContainEqual(expect.stringMatching(/^(navigate|back|read|none|stop): /))
    expect(lines.at(-1)).toBe('search: search the web for the words given as the option\'s "text"')
  })

  it('names the Appliance Verbs apart, with the Timer the grammar sets', () => {
    const verbs = errandVerbs(card)
    expect(Object.keys(verbs)).toEqual(expect.arrayContaining(['play', 'timer']))
    expect(verbs.timer).toMatch(/length/)
    expect(Object.keys(verbs)).not.toContain('navigate')
    expect(Object.keys(verbs)).not.toContain('click-2')
    expect(card.text.split('\n')).not.toContainEqual(expect.stringMatching(/^play: /))
  })
})

describe('resolveAction (#467): a Planner action becomes the Command the card makes of its line', () => {
  it('a click on an offered ref', () => {
    expect(resolve({ kind: 'click', ref: 2 })).toEqual({ kind: 'command', command: { verb: 'click', target: 2, slot: null } })
  })

  it('a ref the card does not offer is refused, never guessed', () => {
    expect(resolve({ kind: 'click', ref: 9 })).toEqual({ kind: 'refused', reason: 'click-9 is not on the card' })
  })

  it('a type carries the Planner\'s own words', () => {
    expect(resolve({ kind: 'type', ref: 1, text: 'install' })).toEqual({ kind: 'command', command: { verb: 'type', target: 1, slot: 'install' } })
  })

  it('a card line by its id: a block\'s capture, a Show Op, a Search Op with its words', () => {
    expect(resolve({ kind: 'option', option: 'capture-text-1' })).toMatchObject({ kind: 'command', command: { verb: 'capture', capture: { kind: 'text', block: { text: 'npm init playwright@latest' } } } })
    expect(resolve({ kind: 'option', option: 'show-1' })).toMatchObject({ kind: 'command', command: { verb: 'scroll_down', show: { text: 'npm init playwright@latest' } } })
    expect(resolve({ kind: 'option', option: 'search-1', text: 'install' })).toEqual({ kind: 'command', command: { verb: 'type', target: 1, slot: 'install', submit: true } })
  })

  it('the link\'s capture by its ref', () => {
    expect(resolve({ kind: 'capture', ref: 3 })).toMatchObject({ kind: 'command', command: { verb: 'capture', target: 3 } })
  })

  it('the browser verbs that need no card line', () => {
    expect(resolve({ kind: 'navigate', url: 'https://en.wikipedia.org' })).toEqual({ kind: 'command', command: { verb: 'navigate', target: null, slot: 'https://en.wikipedia.org' } })
    expect(resolve({ kind: 'back' })).toEqual({ kind: 'command', command: { verb: 'back', target: null, slot: null } })
    expect(resolve({ kind: 'press', key: 'Enter' })).toEqual({ kind: 'command', command: { verb: 'press', target: null, slot: 'Enter', key: { key: 'Enter' }, times: 1 } })
    expect(resolve({ kind: 'scroll', direction: 'down' })).toEqual({ kind: 'command', command: { verb: 'scroll_down', target: null, slot: null } })
    expect(resolve({ kind: 'press', key: 'F5' })).toEqual({ kind: 'refused', reason: 'press takes enter, escape, tab, space or an arrow, not "F5"' })
  })

  it('a web search by its words', () => {
    expect(resolve({ kind: 'option', option: 'search', text: 'next formula 1 race' })).toEqual({ kind: 'command', command: { verb: 'search', target: null, slot: 'next formula 1 race' } })
    expect(resolve({ kind: 'option', option: 'search' })).toEqual({ kind: 'refused', reason: 'search needs its words' })
  })

  it('reading the page is a part of its text, never read aloud', () => {
    expect(resolve({ kind: 'read', part: '2' })).toEqual({ kind: 'read', part: 2 })
    expect(resolve({ kind: 'read', part: 'part 3' })).toEqual({ kind: 'read', part: 3 })
    expect(resolve({ kind: 'read', part: 'the rest' })).toEqual({ kind: 'read', part: 1 })
    expect(resolve({ kind: 'option', option: 'read' })).toEqual({ kind: 'read', part: 1 })
  })

  it('an Appliance Verb: the Player\'s search by its words, the Timer by its length', () => {
    expect(resolve({ kind: 'verb', verb: 'play', words: 'lofi beats' })).toMatchObject({ kind: 'command', command: { verb: 'play', slot: 'lofi beats', music: { kind: 'search' } } })
    expect(resolve({ kind: 'verb', verb: 'timer', words: '55 minutes' })).toEqual({ kind: 'command', command: { verb: 'timer', target: null, slot: null, durationMs: 55 * 60_000 } })
    expect(resolve({ kind: 'verb', verb: 'timer', words: 'until the race' })).toEqual({ kind: 'refused', reason: 'timer needs a length (55 minutes, 1h30m), not "until the race"' })
  })

  it('stop and none are no step', () => {
    expect(resolve({ kind: 'option', option: 'none' })).toEqual({ kind: 'refused', reason: 'none is no step: say done or ask instead' })
    expect(resolve({ kind: 'option', option: 'stop' })).toEqual({ kind: 'refused', reason: 'stop is no step: say done or ask instead' })
  })
})
