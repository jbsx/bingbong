import { describe, expect, it } from 'vitest'
import type { CollectedElement, CollectedPage } from './snapshot'
import { buildPageSnapshot } from './snapshot'
import { SCROLL_END_OF_PAGE, formatNewInView } from './scrollDelta'

function element(overrides: Partial<CollectedElement> = {}): CollectedElement {
  return {
    tag: 'button',
    role: null,
    inputType: null,
    label: 'A button',
    rect: { x: 10, y: 10, width: 50, height: 30 },
    ...overrides,
  }
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
        element({ label: 'Home' }),
        element({ tag: 'a', label: 'Next page', href: 'https://example.com/2' }),
      ],
    })

    expect(formatNewInView(before, after)).toBe('new in view:\n[2] link "Next page" href="https://example.com/2"')
  })

  it('lists the text blocks that entered the viewport under the page text heading', () => {
    const before = snapshot({ viewportText: ['The opening paragraph.'] })
    const after = snapshot({ viewportText: ['The opening paragraph.', 'The second paragraph.'] })

    expect(formatNewInView(before, after)).toBe('new in view:\npage text:\nThe second paragraph.')
  })

  it('returns null when nothing entered the viewport', () => {
    const before = snapshot({ elements: [element({ label: 'Home' })], viewportText: ['Only paragraph.'] })
    const after = snapshot({ elements: [element({ label: 'Home' })], viewportText: ['Only paragraph.'] })

    expect(formatNewInView(before, after)).toBeNull()
  })

  it('counts a repeated label once per occurrence, so a third copy still reads as new', () => {
    const twice = [element({ label: 'Subscribe' }), element({ label: 'Subscribe' })]
    const before = snapshot({ elements: twice })
    const after = snapshot({ elements: [...twice, element({ label: 'Subscribe' })] })

    expect(formatNewInView(before, after)).toBe('new in view:\n[3] button "Subscribe"')
  })

  it('caps the refs it lists at the read_page ref cap', () => {
    const many = Array.from({ length: 90 }, (_, index) => element({ label: `Item ${index}` }))
    const block = formatNewInView(snapshot(), snapshot({ elements: many }))

    expect(block?.split('\n').filter((line) => line.startsWith('[')).length).toBe(75)
  })

  it('caps the text it lists at the read_page digest cap', () => {
    const after = snapshot({ viewportText: ['word '.repeat(500)] })
    const block = formatNewInView(snapshot(), after)

    expect(block?.length).toBeLessThanOrEqual('new in view:\npage text:\n'.length + 1800)
    expect(block?.endsWith('…')).toBe(true)
  })

  it('names the end of the page with the note the repeat guard reads', () => {
    expect(SCROLL_END_OF_PAGE).toBe('end of page')
  })
})
