import { describe, expect, it } from 'vitest'
import { emptyPageReadLine, pageReadPartLine, pageReadText } from '../browser/pageText'
import { commandAnswer, controlsOnlyLine, noResponseAnswer, pageReadCard } from './answer'
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
    expect(answer(command('scroll_down'), { scrollEnded: true })).toBe('Already at the bottom.')
    expect(answer(command('scroll_up'), { scrollEnded: true })).toBe('Already at the top.')
    expect(answer(command('click', { target: 3 }), { label: 'Say hello' })).toBe('Clicked “Say hello”.')
    expect(answer(command('click', { target: 3 }))).toBe('Clicked item 3.')
    expect(answer(command('type', { target: 2, slot: 'lisbon' }), { label: 'Search' })).toBe('Typed into “Search”.')
  })

  it('answers a Media Op (#372) with what it did, a seek with where it came to, and says when it changed nothing', () => {
    expect(answer(command('media', { target: 7, mediaOp: { op: 'forward', rung: 'words', seconds: 10 } }), { mediaChanges: '0:16 → 0:26' })).toBe('Skipped forward 10 s, to 0:26.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'back', rung: 'end', seconds: 16.2 } }), { mediaChanges: '0:16 → 0:00' })).toBe('Skipped back 16 s, to 0:00.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'pause' } }), { mediaChanges: 'paused' })).toBe('Paused.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'play' } }), { mediaChanges: 'playing' })).toBe('Playing.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'mute' } }), { mediaChanges: 'no observable change' })).toBe('Muted. Nothing changed: it was already.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'volume', to: 30 } }), { mediaChanges: 'volume 100% → 30%' })).toBe('Volume 30.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'rate', to: 1.5 } }), { mediaChanges: 'speed 1× → 1.5×' })).toBe('Speed 1.5×.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'unloop' } }), { mediaChanges: 'loop off' })).toBe('Loop off.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'captions' } }), { mediaChanges: 'captions en' })).toBe('Captions on.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'restart' } }), { mediaChanges: '0:16 → 0:00' })).toBe('Restarted.')
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
    for (const verb of ['read', 'screenshot', 'help', 'none'] as const) expect(answer(command(verb))).toBeNull()
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

  it('names what a page of controls alone holds, by kind, and is no failure (2026-10-21 audit)', () => {
    const controls = (...refs: string[]): string => ['# context menu fixture — http://127.0.0.1:4100/context-menu', 'signature 0000', ...refs, emptyPageReadLine()].join('\n')
    expect(pageReadCard(controls('[1] button "Fixture video player"', '[2] button "Loop"', '[3] link "Plain link"'))).toEqual({
      text: '## context menu fixture\n\nThis page has no text, only 2 buttons and a link.',
      failure: false,
    })
    expect(controlsOnlyLine(controls('[1] media "Song"', '[2] button "Play"'))).toBe('This page has no text, only a media player and a button.')
    expect(controlsOnlyLine(controls('[1] media "One"', '[2] media "Two"', '[3] button "Play"', '[4] link "Home"', '[5] link "About"'))).toBe('This page has no text, only 2 media players, a button and 2 links.')
    // An input alone is no content of that kind; a page with words is read as words.
    expect(controlsOnlyLine(controls('[1] input[search] "Search"'))).toBeNull()
    expect(controlsOnlyLine(read(['# Lighthouse — https://example.com/'], ['Hi.']))).toBeNull()
  })
})

describe('noResponseAnswer', () => {
  const jev = (action: Record<string, number>) => ({ model: 'jev', latencyMs: 1, confidence: { action: 0.9, slot: 0.9 }, probabilities: { action, slot: {} } })

  it('says what Jev read off its action card when nothing on the page fits it, and that it read nothing otherwise (#370)', () => {
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ 'click-9': 0.8, none: 0.2 }) })).toBe('No response.\n\nJev read “click [9]”, but nothing on this page fits it.')
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ volume: 0.7, none: 0.3 }) })).toBe('No response.\n\nJev read “volume”, but nothing on this page fits it.')
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ none: 0.9 }) })).toBe('No response.\n\nJev read no command in the words.')
  })

  it("puts the grammar's error first", () => {
    expect(noResponseAnswer({ grammarError: 'I can scroll up or down.', jevAsked: false })).toBe('No response.\n\nI can scroll up or down.')
  })
})
