import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { RegionFacts } from '../browser/snapshot'
import { describeCommand, type Command, type CommandPage, type CommandRef } from './command'
import { commandQuestions, commandState, doneFacts, doneLine, hopQuestions, partialQuestions, readCommandAnswers, refIdentityOf, setAsideOf, type HopContext } from './jevReading'

// Scroll Regions (#383, ADR 0085): an element the page scrolls on its own
// is a ref of its own kind, with no click, carrying two Scroll Ops; how far
// one goes is the Extent, a Choice of its own, which the page's own scroll
// reads too.

const FACTS: RegionFacts = { top: 0, height: 4800, view: 400 }
const CHAT: CommandRef = { ref: 12, kind: 'region', label: 'Live chat', href: null, inputType: null, region: FACTS }
const PAGE: CommandPage = {
  url: 'https://example.com/stream',
  title: 'Stream',
  refs: [{ ref: 1, kind: 'button', label: 'Send', href: null, inputType: null }, CHAT],
}
const withFacts = (facts: Partial<RegionFacts>): CommandPage => ({ ...PAGE, refs: PAGE.refs.map((ref) => (ref.ref === 12 ? { ...ref, region: { ...FACTS, ...facts } } : ref)) })

export function choice(label: string, confidence = 0.9): DecisionChoiceAnswer {
  return { type: 'choice', choice: label, confidence, probabilities: { [label]: confidence } }
}

describe("a Scroll Region's line: its label, its position and its length in screens", () => {
  const line = (facts: Partial<RegionFacts>): string => commandState('scroll the chat', withFacts(facts)).split('\n').find((l) => l.startsWith('[12] '))!

  it('reads at top, at end, or how far scrolled, and how many screens long', () => {
    expect(line({})).toBe('[12] region "Live chat" at top 12 screens')
    expect(line({ top: 4400 })).toBe('[12] region "Live chat" at end 12 screens')
    expect(line({ top: 1760 })).toBe('[12] region "Live chat" scrolled 40% 12 screens')
    expect(line({ height: 600 })).toBe('[12] region "Live chat" at top 2 screens')
    expect(line({ height: 400 })).toBe('[12] region "Live chat" at top 1 screen')
  })
})

describe('Scroll Ops on the action card: down-N and up-N, whatever the position, and no click', () => {
  it('offers both ops on every region, each a whole line naming the ref, at the top and at the end alike', () => {
    for (const facts of [{}, { top: 4400 }, { top: 1760 }]) {
      const card = commandQuestions('scroll the chat down', withFacts(facts)).action.options
      expect(card['down-12']).toBe('scroll [12] "Live chat" down, the extent Choice saying how far')
      expect(card['up-12']).toBe('scroll [12] "Live chat" up, the extent Choice saying how far')
    }
  })

  it('offers a region no click, no type and no right-click', () => {
    const card = commandQuestions('scroll the chat down', PAGE).action.options
    for (const act of ['click', 'type', 'menu']) expect(card).not.toHaveProperty(`${act}-12`)
    expect(card).toHaveProperty('click-1')
  })
})

describe('the Extent (ADR 0085): a Choice of its own on every ask, read only for a Scroll Op or the page scroll', () => {
  const read = (label: string, text: string, extent?: string, extra: Record<string, DecisionChoiceAnswer> = {}) =>
    readCommandAnswers({ action: choice(label), slot: choice('none'), ...(extent !== undefined ? { extent: choice(extent) } : {}), ...extra }, text, PAGE)

  it('is asked on every ask, a region on the card or not, with its five rungs', () => {
    for (const questions of [commandQuestions('scroll down', PAGE), commandQuestions('scroll down', { ...PAGE, refs: PAGE.refs.slice(0, 1) }), hopQuestions('scroll down', PAGE, { hop: 1, visited: [], actions: [], links: [] }), partialQuestions('scroll', PAGE)]) {
      expect(Object.keys((questions as { extent: { options: Record<string, string> } }).extent.options)).toEqual(['words', 'little', 'screen', 'lot', 'end'])
    }
  })

  it('reads a Scroll Op as a scroll of that region, its Extent in screens', () => {
    expect(read('down-12', 'scroll the chat down', 'screen')).toEqual({ verb: 'scroll_down', target: 12, slot: null, extent: { rung: 'screen', screens: 1 } })
    expect(read('up-12', 'scroll the chat up a bit', 'little')).toEqual({ verb: 'scroll_up', target: 12, slot: null, extent: { rung: 'little', screens: 1 / 3 } })
    expect(read('down-12', 'scroll the chat down a lot', 'lot')).toMatchObject({ extent: { rung: 'lot', screens: 3 } })
    expect(read('down-12', 'scroll the chat down 2 pages', 'words')).toMatchObject({ extent: { rung: 'words', screens: 2 } })
    expect(read('down-12', 'scroll the chat to the bottom', 'end')).toMatchObject({ extent: { rung: 'end' } })
    // A `words` rung with no number in the words is the screen it falls back to; no Extent answered reads as a screen too.
    expect(read('down-12', 'scroll the chat down', 'words')).toMatchObject({ extent: { rung: 'screen', screens: 1 } })
    expect(read('down-12', 'scroll the chat down')).toMatchObject({ extent: { rung: 'screen', screens: 1 } })
  })

  it('reads an op on no region, or a region not on the page, as no Command', () => {
    expect(read('down-1', 'scroll down', 'screen').verb).toBe('none')
    expect(read('down-9', 'scroll down', 'screen').verb).toBe('none')
  })

  it("four combinations: a Scroll Op and the page's scroll take the Extent; a seek takes the Amount and a click neither", () => {
    expect(read('down-12', 'scroll the chat to the bottom', 'end')).toMatchObject({ verb: 'scroll_down', target: 12, extent: { rung: 'end' } })
    expect(read('scroll_down', 'scroll to the bottom of the page', 'end')).toEqual({ verb: 'scroll_down', target: null, slot: null, extent: { rung: 'end' } })
    expect(read('scroll_up', 'scroll up a bit', 'little')).toEqual({ verb: 'scroll_up', target: null, slot: null, extent: { rung: 'little', screens: 1 / 3 } })
    expect(read('click-1', 'send it', 'end')).toEqual({ verb: 'click', target: 1, slot: null })
    // A page scroll read with no Extent asked fires as it always did: the grammar's distance.
    expect(read('scroll_down', 'scroll down')).toEqual({ verb: 'scroll_down', target: null, slot: null })
  })
})

describe('a Scroll Op in "Done so far", the Feed and the set-asides', () => {
  const DOWN: Command = { verb: 'scroll_down', target: 12, slot: null, extent: { rung: 'screen', screens: 1 } }

  it('tells the position change off the region\'s own facts, never a state flip', () => {
    const facts = doneFacts(PAGE, withFacts({ top: 1540 }), { changed: true }, 12)
    expect(facts).toEqual({ changed: true, region: 'at top → scrolled 35%' })
    expect(doneLine(DOWN, PAGE, facts)).toBe('scroll down a screen "Live chat" (at top → scrolled 35%)')
    expect(doneFacts(withFacts({ top: 1540 }), withFacts({ top: 4400 }), { changed: true }, 12)).toMatchObject({ region: 'scrolled 35% → at end' })
    // A region that did not move, read unchanged, is nothing changed.
    expect(doneFacts(PAGE, PAGE, { changed: false }, 12)).toEqual({ changed: false })
    expect(doneLine({ ...DOWN, verb: 'scroll_up', extent: { rung: 'end' } }, PAGE, { changed: false })).toBe('scroll up to the top "Live chat" (nothing changed)')
  })

  it('names a region scroll in the Feed by its ref, its direction and its Extent; the page scroll by its Extent when it has one', () => {
    expect(describeCommand(DOWN, PAGE)).toBe('scroll [12] "Live chat" down a screen')
    expect(describeCommand({ ...DOWN, verb: 'scroll_up', extent: { rung: 'little', screens: 1 / 3 } }, PAGE)).toBe('scroll [12] "Live chat" up a third of a screen')
    expect(describeCommand({ verb: 'scroll_down', target: null, slot: null, extent: { rung: 'end' } })).toBe('scroll down to the end')
    expect(describeCommand({ verb: 'scroll_down', target: null, slot: null })).toBe('scroll down')
  })

  it('sets a Scroll Op aside by its card label: down-12 goes, up-12 and the page scroll stay, and its reading is no Command', () => {
    const aside = setAsideOf(DOWN, PAGE)
    expect(aside).toEqual({ act: 'down', ...refIdentityOf(CHAT, PAGE) })
    const hop: HopContext = { hop: 1, visited: [PAGE.url], actions: ['scroll down a screen "Live chat" (nothing changed)'], links: [], setAside: [aside!] }
    const card = Object.keys(hopQuestions('scroll the chat down', PAGE, hop).action.options)
    expect(card).not.toContain('down-12')
    expect(card).toEqual(expect.arrayContaining(['up-12', 'scroll_down', 'scroll_up']))
    expect(readCommandAnswers({ action: choice('down-12'), slot: choice('none'), extent: choice('screen'), outcome: choice('not_yet') }, 'scroll the chat down', PAGE, hop).verb).toBe('none')
    expect(setAsideOf({ verb: 'scroll_down', target: null, slot: null, extent: { rung: 'screen', screens: 1 } }, PAGE)).toEqual({ verb: 'scroll_down' })
  })
})
