import { describe, expect, it } from 'vitest'
import type { MemoryEntryId } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import type { AskedItemStanding } from '../agent/askedItems'
import { deriveAnswerSources, removeIdentities, repairAskedItems, repairCard, repairSpokenRendering, USER_OBSERVATION_PHRASE } from './answerEvidence'
import eurostar from './fixtures/identity-slip-eurostar.json'
import voyager from './fixtures/identity-slip-voyager-asked-items.json'

const entryId = (id: string): MemoryEntryId => id as MemoryEntryId

const observation = (id: MemoryEntryId, urls: string[], title?: string): SessionObservation => ({
  id,
  sessionId: 'session-1' as never,
  sourceKind: 'web',
  text: 'text',
  observedAt: 0,
  references: urls.map((url) => ({ url, ...(title ? { title } : {}) })),
  provenance: [{ runId: 'run-1' as never }],
})

const resolverOf = (observations: readonly SessionObservation[]) => {
  const byId = new Map(observations.map((entry) => [entry.id, entry]))
  return (id: MemoryEntryId): SessionObservation | null => byId.get(id) ?? null
}

const nothing = (): SessionObservation | null => null

describe('deriveAnswerSources', () => {
  it('derives source links from cited evidence, in citation order, deduplicated by URL', () => {
    const byId = new Map([
      [entryId('memory-2'), observation(entryId('memory-2'), ['https://shop.example/a', 'https://shop.example/b'], 'Shop')],
      [entryId('memory-1'), observation(entryId('memory-1'), ['https://shop.example/a'])],
      [entryId('memory-3'), observation(entryId('memory-3'), ['https://reviews.example/x'])],
    ])
    expect(deriveAnswerSources([entryId('memory-2'), entryId('memory-1'), entryId('memory-3')], (id) => byId.get(id) ?? null)).toEqual([
      { url: 'https://shop.example/a', title: 'Shop' },
      { url: 'https://shop.example/b', title: 'Shop' },
      { url: 'https://reviews.example/x' },
    ])
  })

  it('skips unknown identities silently — unresolved citations contribute nothing', () => {
    expect(deriveAnswerSources([entryId('memory-9')], () => null)).toEqual([])
    expect(deriveAnswerSources(undefined, () => null)).toEqual([])
    // User Observations carry no web references: no links derived.
    const userWords = { ...observation(entryId('memory-4'), []), sourceKind: 'user' as const }
    expect(deriveAnswerSources([entryId('memory-4')], (id) => (id === entryId('memory-4') ? userWords : null))).toEqual([])
  })
})

describe('repairCard', () => {
  // The captured Card (#246): fix-240-1's Eurostar initial. The model wrote
  // `memory-1/memory-2`, `memory-3/memory-4` and `memory-5` into its prose;
  // the old boundary deleted three and let the two behind a slash through.
  const resolve = resolverOf(
    eurostar.observations.map((entry) => observation(entryId(entry.id), [entry.url], entry.title ?? undefined)),
  )
  const [luggage, instruments] = [eurostar.observations[0]!, eurostar.observations[2]!]
  const link = (entry: { url: string; title: string | null }): string => `[${entry.title}](${entry.url})`
  const firstParagraph = (text: string): string => text.split('\n\n')[0]!

  it('substitutes every resolved id in the captured Eurostar Card with its source link, so every sentence reads whole', () => {
    expect(eurostar.publishedDisplay).toContain(': /memory-2 give')
    const repaired = repairCard(eurostar.rawDisplay, resolve)
    expect(firstParagraph(repaired.text)).toBe(
      "All the rules I need are now verified on Eurostar's own pages. The numbers recorded are complementary, not conflicting: " +
        `${link(luggage)}/${link(luggage)} give the Standard allowance and size limit, ` +
        `${link(instruments)}/${link(instruments)} are the two different instrument rules (guitars vs cellos), ` +
        `and ${link(instruments)} is a separate special-luggage provision — reconciled in the answer below.`,
    )
    // Everything after the slipped paragraph is the Card the user was shown.
    expect(repaired.text.slice(firstParagraph(repaired.text).length)).toBe(
      eurostar.publishedDisplay.slice(firstParagraph(eurostar.publishedDisplay).length),
    )
    expect(repaired.slips).toEqual(
      ['memory-1', 'memory-2', 'memory-3', 'memory-4', 'memory-5'].map((id) => ({ surface: 'display', id, repair: 'substituted' })),
    )
  })

  it('links by host when the reference has no title, and names a User Observation with a fixed phrase', () => {
    const userWords = { ...observation(entryId('memory-4'), []), sourceKind: 'user' as const }
    const repaired = repairCard(
      'Per memory-2, and as memory-4 says.',
      resolverOf([observation(entryId('memory-2'), ['https://www.shop.example/a?b=1', 'https://other.example/']), userWords]),
    )
    expect(repaired.text).toBe(`Per [www.shop.example](https://www.shop.example/a?b=1), and as ${USER_OBSERVATION_PHRASE} says.`)
    expect(USER_OBSERVATION_PHRASE).toBe('what you told me')
  })

  it('renders a duplicated id as the same link twice, punctuation as written', () => {
    const repaired = repairCard('Both (memory-2, memory-2).', resolverOf([observation(entryId('memory-2'), ['https://a.example/x'], 'A')]))
    expect(repaired.text).toBe('Both ([A](https://a.example/x), [A](https://a.example/x)).')
    expect(repaired.slips).toHaveLength(2)
  })

  it('deletes what cannot resolve — a Run Observation id, or a Memory Entry id the store does not hold — with the tidy', () => {
    expect(repairCard('Cheapest (memory-1, obs-2).', nothing)).toEqual({
      // The brackets a removal leaves empty go with it (#300).
      text: 'Cheapest.',
      slips: [
        { surface: 'display', id: 'memory-1', repair: 'deleted' },
        { surface: 'display', id: 'obs-2', repair: 'deleted' },
      ],
    })
    expect(repairCard('Between memory-1, memory-2, and memory-3 it wins.', nothing).text).toBe('Between, and it wins.')
    expect(repairCard('Ranking [memory-3].', nothing).text).toBe('Ranking.')
    expect(repairCard('Double  spaces  after memory-7 drops.', nothing).text).not.toMatch(/ {2}/)
    // A deletion beside a substitution leaves no comma against the paren.
    const shop = resolverOf([observation(entryId('memory-1'), ['https://shop.example/a'])])
    expect(repairCard('Cheapest (memory-1, obs-2).', shop).text).toBe('Cheapest ([shop.example](https://shop.example/a)).')
    expect(repairCard('Cheapest [obs-2, memory-1].', shop).text).toBe('Cheapest [[shop.example](https://shop.example/a)].')
    // An obs-N is deleted even when a Memory Entry shares its number.
    const resolve = resolverOf([observation(entryId('memory-2'), ['https://a.example/x'], 'A')])
    expect(repairCard('See obs-2.', resolve).text).toBe('See .')
  })

  it('removes a range of ids whole, and records it once as written (#300)', () => {
    expect(repairCard('All hold (memory-1..6).', nothing)).toEqual({
      text: 'All hold.',
      slips: [{ surface: 'display', id: 'memory-1..6', repair: 'deleted' }],
    })
    expect(repairCard('Per memory-1–6 it holds.', nothing).text).toBe('Per it holds.')
    expect(repairCard('Per obs-2..obs-4 it holds.', nothing).text).toBe('Per it holds.')
    // A range is never substituted, even where its first id resolves.
    const resolve = resolverOf([observation(entryId('memory-1'), ['https://a.example/x'], 'A')])
    expect(repairCard('Per memory-1..6.', resolve).slips).toEqual([{ surface: 'display', id: 'memory-1..6', repair: 'deleted' }])
  })

  it('takes out only the brackets a removal emptied (#300)', () => {
    expect(repairCard('Holds (memory-3, memory-2) and (memory-1 and obs-4); call render() or pick [] as written.', nothing).text).toBe(
      'Holds and; call render() or pick [] as written.',
    )
    // Brackets that hold more than the id stay, with no space left against the closer.
    expect(repairCard('Kept (see memory-3) here.', nothing).text).toBe('Kept (see) here.')
    // A markdown link's label is no citation: the link keeps its shape.
    expect(repairSpokenRendering('See [memory-1](https://a.example/x) now.').text).toBe('See [](https://a.example/x) now.')
  })

  it('keeps the slash between slash-joined ids only between what remains', () => {
    const resolve = resolverOf([observation(entryId('memory-1'), ['https://a.example/x'], 'A')])
    expect(repairCard('Per memory-1/obs-2/memory-9 it holds.', resolve).text).toBe('Per [A](https://a.example/x) it holds.')
    expect(repairCard('Per obs-1/obs-2 it holds.', resolve).text).toBe('Per it holds.')
  })

  it('reads the id without regard to case, and records it as written', () => {
    const repaired = repairCard('Per Memory-2.', resolverOf([observation(entryId('memory-2'), ['https://a.example/x'], 'A')]))
    expect(repaired).toEqual({ text: 'Per [A](https://a.example/x).', slips: [{ surface: 'display', id: 'Memory-2', repair: 'substituted' }] })
  })

  it('leaves id-shaped segments inside URLs untouched, and records no slip for them', () => {
    const text = 'See https://shop.example/memory-2/specs and https://x.example/a?ref=obs-4 or shop.example/memory-3/obs-5.'
    expect(repairCard(text, nothing)).toEqual({ text, slips: [] })
  })

  it('keeps a substituted link well-formed when the title or URL carries markdown punctuation', () => {
    const repaired = repairCard(
      'Per memory-2.',
      resolverOf([observation(entryId('memory-2'), ['https://wiki.example/Foo_(bar)'], 'Foo [bar] \\ baz')]),
    )
    expect(repaired.text).toBe('Per [Foo \\[bar\\] \\\\ baz](https://wiki.example/Foo_%28bar%29).')
  })

  it('returns a Card with no slip exactly as written: no Sources block, no tidy (#141)', () => {
    expect(repairCard('Plain answer.', nothing)).toEqual({ text: 'Plain answer.', slips: [] })
    expect(repairCard('Line one  \nline two.', nothing).text).toBe('Line one  \nline two.')
    expect(repairCard('Found it.', nothing).text).not.toContain('Sources:')
  })
})

describe('repairSpokenRendering', () => {
  it('only ever deletes: the captured Eurostar spoken line loses its five ids and keeps no stray slash', () => {
    const repaired = repairSpokenRendering(eurostar.rawSpeak)
    expect(repaired.text).toBe(
      "All the rules I need are now verified on Eurostar's own pages. The numbers recorded are complementary, not conflicting: " +
        'give the Standard allowance and size limit, are the two different instrument rules (guitars vs cellos), ' +
        'and is a separate special-luggage provision — reconciled in the answer below.',
    )
    expect(repaired.slips).toEqual(
      ['memory-1', 'memory-2', 'memory-3', 'memory-4', 'memory-5'].map((id) => ({ surface: 'speak', id, repair: 'deleted' })),
    )
  })

  it('returns a line with no slip exactly as spoken', () => {
    expect(repairSpokenRendering('The cheapest is the Acme router.')).toEqual({ text: 'The cheapest is the Acme router.', slips: [] })
  })
})

describe('repairAskedItems (#300)', () => {
  const stated = (item: string, statement: string): AskedItemStanding => ({ item, standing: 'stated', statement })

  it("repairs the captured Voyager Card's statements: no id, no empty brackets, no stray comma", () => {
    const repaired = repairAskedItems(voyager.rawAskedItems as AskedItemStanding[])
    expect(repaired.items).toEqual(voyager.repairedAskedItems)
    expect(repaired.slips).toEqual(voyager.ids.map((id) => ({ surface: 'asked_item', id, repair: 'deleted' })))
    for (const entry of repaired.items) {
      expect(`${entry.item} ${entry.statement}`).not.toMatch(/(?:memory|obs)-\d|\(\s*\)|,\s*[,).]/)
    }
  })

  it('removes every form seen in the captures, a range whole', () => {
    const repaired = repairAskedItems([
      stated('Prior requirements', 'All prior findings still hold per official docs (memory-1..6): Module 3 autofocus.'),
      stated('Candidate', 'Candidate memory-5 rejected.'),
      stated('Cable', 'Standard-Mini 22-pin cable (memory-4), rpicam-only software (memory-2), and autofocus (memory-5).'),
    ])
    expect(repaired.items.map((entry) => entry.statement)).toEqual([
      'All prior findings still hold per official docs: Module 3 autofocus.',
      'Candidate rejected.',
      'Standard-Mini 22-pin cable, rpicam-only software, and autofocus.',
    ])
    expect(repaired.slips.map((slip) => slip.id)).toEqual(['memory-1..6', 'memory-5', 'memory-4', 'memory-2', 'memory-5'])
  })

  it('never substitutes, repairs the name too, and records the name before the statement', () => {
    const repaired = repairAskedItems([stated('The fare (memory-2)', 'Per memory-1 it is $39.')])
    expect(repaired).toEqual({
      items: [stated('The fare', 'Per it is $39.')],
      slips: [
        { surface: 'asked_item', id: 'memory-2', repair: 'deleted' },
        { surface: 'asked_item', id: 'memory-1', repair: 'deleted' },
      ],
    })
  })

  it('leaves an id inside a URL in a statement, and an item with no slip exactly as written', () => {
    const items = [
      stated('The source', 'See https://shop.example/memory-2/specs  and https://x.example/a?ref=obs-4 .'),
      { item: 'The fare', standing: 'unverified' as const, statement: 'not stated in the Answer' },
    ]
    const repaired = repairAskedItems(items)
    expect(repaired).toEqual({ items, slips: [] })
    expect(repaired.items[0]).toBe(items[0])
  })

  it('leaves a statement that was nothing but ids empty', () => {
    expect(repairAskedItems([stated('The fare', '(memory-1, memory-2)')]).items).toEqual([stated('The fare', '')])
  })
})

describe('removeIdentities (#300)', () => {
  it('removes every id and tidies, and returns a text with none exactly as written', () => {
    expect(removeIdentities('Found the fare (memory-3). Per memory-1..6 it holds.')).toBe('Found the fare. Per it holds.')
    expect(removeIdentities('Plain  text, as written ().')).toBe('Plain  text, as written ().')
  })
})
