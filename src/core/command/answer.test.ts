import { describe, expect, it } from 'vitest'
import { emptyPageReadLine, pageReadPartLine, pageReadText } from '../browser/pageText'
import { commandAnswer, noResponseAnswer, pageReadCard } from './answer'
import type { Command } from './command'

describe('commandAnswer (#333)', () => {
  const command = (verb: Command['verb'], more: Partial<Command> = {}): Command => ({ verb, target: null, slot: null, ...more })
  const lighthouse = { url: 'http://127.0.0.1:4100/interactive', title: 'Lighthouse page' }
  const answer = (of: Command, facts: Partial<Parameters<typeof commandAnswer>[1]> = {}): string | null =>
    commandAnswer(of, { page: lighthouse, ...facts })

  it('names the page a navigate opened, by its title or else its site', () => {
    expect(answer(command('navigate', { slot: 'http://127.0.0.1:4100/interactive' }))).toBe('Opened Lighthouse page.')
    expect(answer(command('navigate', { slot: 'example.com' }), { page: { url: 'https://www.example.com/', title: '' } })).toBe('Opened example.com.')
  })

  it('says what a search searched for', () => {
    expect(answer(command('search', { slot: 'lovely weather' }))).toBe('Searched the web for “lovely weather”.')
  })

  it('says which site a scoped search searched (#340)', () => {
    expect(answer(command('search', { slot: 'donald trumps profile', site: 'x.com' }))).toBe('Searched x.com for “donald trumps profile”.')
  })

  it('scrolls, clicks and types in plain words, naming the ref by its label', () => {
    expect(answer(command('scroll_down'))).toBe('Scrolled down.')
    expect(answer(command('scroll_up'))).toBe('Scrolled up.')
    expect(answer(command('click', { target: 3 }), { label: 'Say hello' })).toBe('Clicked “Say hello”.')
    expect(answer(command('click', { target: 3 }))).toBe('Clicked item 3.')
    expect(answer(command('type', { target: 2, slot: 'lisbon' }), { label: 'Search' })).toBe('Typed into “Search”.')
  })

  it('steps through history by the page it came to', () => {
    expect(answer(command('back'))).toBe('Went back to Lighthouse page.')
    expect(answer(command('forward'))).toBe('Went forward to Lighthouse page.')
    expect(answer(command('reload'))).toBe('Reloaded.')
  })

  it('names the key pressed, with its modifier and count', () => {
    expect(answer(command('press', { key: { key: 'Enter' } }))).toBe('Pressed Enter.')
    expect(answer(command('press', { key: { key: 'Tab', shift: true }, times: 3 }))).toBe('Pressed Shift+Tab 3 times.')
  })

  it('says how long a Timer was set for, and that it is off', () => {
    expect(answer(command('timer', { durationMs: 90 * 60_000 }))).toBe('Timer set for 1 hour 30 minutes.')
    expect(answer(command('timer'))).toBe('Timer off.')
  })

  it('answers a Stop, a clear and a resume', () => {
    expect(answer(command('stop'))).toBe('Stopped.')
    expect(answer(command('clear'))).toBe('Cleared the field.')
    expect(answer(command('resume'))).toBe('Back on Lighthouse page.')
    expect(answer(command('resume'), { page: { url: 'about:blank', title: '' } })).toBe('There is no page to resume yet.')
  })

  it('leaves the verbs whose Answer is a Card, and the ones that fire nothing, to themselves', () => {
    for (const verb of ['read', 'screenshot', 'help', 'none', 'done'] as const) expect(answer(command(verb))).toBeNull()
  })
})

describe('pageReadCard (#333)', () => {
  const cardText = (result: string): string => pageReadCard(result).text
  const read = (head: string[], text: string[], part = pageReadPartLine(1, 1)): string => [...head, '[1] link "Home"', 'page text:', ...text, part].join('\n')

  it("heads the Card with the page title and shows only the page's words: no viewport, scroll, signature or part line", () => {
    const card = cardText(read(['# Lighthouse — http://127.0.0.1:4100/interactive', 'viewport 978x571 scroll 0/572', 'signature 6dddda4d'], ['Keepers of the light.', 'Say hello below.']))
    expect(card).toBe('## Lighthouse\n\nKeepers of the light.\n\nSay hello below.')
  })

  it('carries the same words the Page Read speaks', () => {
    const result = read(['# Lighthouse — https://example.com/', 'signature 1a2b'], ['One.', 'Two.'])
    expect(cardText(result).replace(/^## .*\n\n/, '').split('\n\n')).toEqual(pageReadText(result).split('\n'))
  })

  it("keeps a table's rows together, so it still renders as a table", () => {
    expect(cardText(read(['# Fares — https://example.com/'], ['Prices:', '| Zone | Fare |', '| --- | --- |', '| 1 | £2 |']))).toBe(
      '## Fares\n\nPrices:\n\n| Zone | Fare |\n| --- | --- |\n| 1 | £2 |',
    )
  })

  it('names the site when the page has no title, and reads past a consent dismissal above the head', () => {
    expect(cardText(read(['dismissed a consent wall: [4] button "Accept"', '#  — https://www.example.com/a/b'], ['Hi.']))).toBe('## example.com\n\nHi.')
  })

  it('says the page goes on when more parts follow, as the spoken read does', () => {
    expect(cardText(read(['# Long — https://example.com/'], ['One.'], pageReadPartLine(1, 3)))).toBe('## Long\n\nOne.\n\n…')
  })

  it('has no heading when the read names no page', () => {
    expect(cardText(['page text:', 'Hi.', pageReadPartLine(1, 1)].join('\n'))).toBe('Hi.')
  })

  it('says the page shows no text when it has none, as the spoken line does', () => {
    expect(pageReadCard(['# Blank — https://example.com/', 'signature 0000', emptyPageReadLine()].join('\n'))).toEqual({ text: '## Blank\n\nThis page shows no text.', failure: true })
    expect(pageReadCard(read(['# Lighthouse — https://example.com/'], ['Hi.'])).failure).toBe(false)
  })
})

describe('noResponseAnswer', () => {
  const jev = (verb: Record<string, number>) => ({ model: 'jev', latencyMs: 1, confidence: { verb: 0.9, target: 0.9, slot: 0.9 }, probabilities: { verb, target: {}, slot: {} } })

  it('says what Jev read when nothing on the page fits it, and that it read nothing otherwise', () => {
    expect(noResponseAnswer({ verb: 'none', grammarError: null, jevAsked: true, jev: jev({ click: 0.8, none: 0.2 }) })).toBe('No response.\n\nJev read “click”, but nothing on this page fits it.')
    expect(noResponseAnswer({ verb: 'none', grammarError: null, jevAsked: true, jev: jev({ none: 0.9 }) })).toBe('No response.\n\nJev read no command in the words.')
  })

  it("puts the grammar's error first, and says when the page already is what was asked", () => {
    expect(noResponseAnswer({ verb: 'none', grammarError: "scroll: expected 'scroll up' or 'scroll down'", jevAsked: false })).toBe("No response.\n\n`scroll: expected 'scroll up' or 'scroll down'`")
    expect(noResponseAnswer({ verb: 'done', grammarError: null, jevAsked: true, jev: jev({ done: 1 }) })).toBe('No response.\n\nThe page already shows what was asked.')
  })
})
