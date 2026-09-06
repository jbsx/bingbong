import { describe, expect, it } from 'vitest'
import type { CollectedElement, CollectedPage } from './snapshot'
import { buildPageSnapshot } from './snapshot'
import { SCROLL_END_OF_PAGE, formatNewInView } from './scrollDelta'

/** An element the collector reports as new to this collect (ADR 0033): no
 * position in the collect before it. */
function element(overrides: Partial<CollectedElement> = {}): CollectedElement {
  return {
    tag: 'button',
    role: null,
    inputType: null,
    label: 'A button',
    rect: { x: 10, y: 10, width: 50, height: 30 },
    previousIndex: -1,
    ...overrides,
  }
}

/** The same element, still in view, at the position it held before. */
function retained(previousIndex: number, overrides: Partial<CollectedElement> = {}): CollectedElement {
  return element({ ...overrides, previousIndex })
}

function snapshot(overrides: Partial<CollectedPage> = {}) {
  return buildPageSnapshot({
    url: 'https://example.com/',
    title: 'Example',
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, scrollHeight: 4000 },
    dialogOpen: false,
    textDigest: '',
    viewportText: [],
    elements: [],
    ...overrides,
  })
}

describe('formatNewInView', () => {
  it('lists only the refs that were not in the viewport before, numbered as they now are', () => {
    const before = snapshot({ elements: [element({ label: 'Home' })] })
    const after = snapshot({
      elements: [
        retained(0, { label: 'Home' }),
        element({ tag: 'a', label: 'Next page', href: 'https://example.com/2' }),
      ],
    })

    expect(formatNewInView(before, after)?.block).toBe(
      'new in view:\n[2] link "Next page" href="https://example.com/2"',
    )
  })

  it('reports the numbers it printed, so only those become shown refs', () => {
    const before = snapshot({ elements: [element({ label: 'Home' })] })
    const after = snapshot({
      elements: [retained(0, { label: 'Home' }), element({ label: 'Next' }), element({ label: 'Last' })],
    })

    expect(formatNewInView(before, after)?.shownRefs).toEqual([2, 3])
  })

  it('lists the text blocks that entered the viewport under the page text heading', () => {
    const before = snapshot({ viewportText: ['The opening paragraph.'] })
    const after = snapshot({ viewportText: ['The opening paragraph.', 'The second paragraph.'] })

    expect(formatNewInView(before, after)?.block).toBe('new in view:\npage text:\nThe second paragraph.')
  })

  it('returns null when nothing entered the viewport', () => {
    const before = snapshot({ elements: [element({ label: 'Home' })], viewportText: ['Only paragraph.'] })
    const after = snapshot({ elements: [retained(0, { label: 'Home' })], viewportText: ['Only paragraph.'] })

    expect(formatNewInView(before, after)).toBeNull()
  })

  it('reads identity by node, so a fresh copy of a repeated label is new', () => {
    const before = snapshot({ elements: [element({ label: 'Subscribe' }), element({ label: 'Subscribe' })] })
    const after = snapshot({
      elements: [retained(0, { label: 'Subscribe' }), retained(1, { label: 'Subscribe' }), element({ label: 'Subscribe' })],
    })

    expect(formatNewInView(before, after)?.block).toBe('new in view:\n[3] button "Subscribe"')
  })

  it('lists an unlabeled element that entered even when an identical-looking one left', () => {
    // Two unlabeled buttons; the scroll drops the first and brings a third
    // in. A kind/label/href tuple reads all three as the same ref and
    // reports nothing new — the node's previous position does not.
    const before = snapshot({ elements: [element({ label: '' }), element({ label: '' })] })
    const after = snapshot({ elements: [retained(1, { label: '' }), element({ label: '' })] })

    expect(formatNewInView(before, after)?.block).toBe('new in view:\n[2] button')
  })

  it('caps the refs it lists at the read_page ref cap and says how many it withheld', () => {
    const many = Array.from({ length: 90 }, (_, index) => element({ label: `Item ${index}` }))
    const delta = formatNewInView(snapshot(), snapshot({ elements: many }))

    expect(delta?.block.split('\n').filter((line) => line.startsWith('[')).length).toBe(75)
    expect(delta?.shownRefs).toHaveLength(75)
    expect(delta?.block).toContain('(+15 more not listed)')
  })

  it('caps the text it lists at the read_page digest cap', () => {
    const after = snapshot({ viewportText: ['word '.repeat(500)] })
    const delta = formatNewInView(snapshot(), after)

    expect(delta?.block.length).toBeLessThanOrEqual('new in view:\npage text:\n'.length + 1800)
    expect(delta?.block.endsWith('…')).toBe(true)
  })

  it('names the end of the page with the note the repeat guard reads', () => {
    expect(SCROLL_END_OF_PAGE).toBe('end of page')
  })
})
