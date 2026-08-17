import { describe, expect, it } from 'vitest'
import youtubeHome from './fixtures/youtube-home.json'
import type { CollectedElement, CollectedPage } from './snapshot'
import { buildPageSnapshot, clickPoint, formatPageSnapshot, parseCollectedPage } from './snapshot'

const youtubeFixture = youtubeHome as unknown as CollectedPage

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

function page(overrides: Partial<CollectedPage> = {}): CollectedPage {
  return {
    url: 'https://example.com/',
    title: 'Example',
    viewport: { width: 1280, height: 800, scrollY: 0, scrollHeight: 1000 },
    elements: [],
    ...overrides,
  }
}

describe('parseCollectedPage', () => {
  it('accepts the youtube fixture payload', () => {
    expect(() => parseCollectedPage(youtubeFixture)).not.toThrow()
  })

  it('rejects payloads that are not objects', () => {
    expect(() => parseCollectedPage('nope')).toThrow(/collected page payload malformed/)
    expect(() => parseCollectedPage(null)).toThrow(/collected page payload malformed/)
  })

  it('rejects elements with missing or non-numeric rects', () => {
    const bad = page({ elements: [{ ...element(), rect: { x: 1, y: 2 } as unknown as CollectedElement['rect'] }] })
    expect(() => parseCollectedPage(bad)).toThrow(/collected page payload malformed/)
    const missing = page({ elements: [{ ...element(), rect: undefined as unknown as CollectedElement['rect'] }] })
    expect(() => parseCollectedPage(missing)).toThrow(/collected page payload malformed/)
  })

  it('defaults risk facts to safe values when the payload omits them', () => {
    const parsed = parseCollectedPage(page({ elements: [element()] }))

    expect(parsed.elements[0]).toMatchObject({
      href: null,
      downloadsFile: false,
      submitsForm: false,
      credentialField: false,
      paymentField: false,
      inForm: false,
      formHasCredential: false,
      formHasPayment: false,
    })
  })

  it('keeps risk facts supplied by the collector', () => {
    const parsed = parseCollectedPage(
      page({
        elements: [
          element({
            tag: 'input',
            inputType: 'password',
            credentialField: true,
            inForm: true,
            formHasCredential: true,
          }),
        ],
      }),
    )

    expect(parsed.elements[0]).toMatchObject({ credentialField: true, inForm: true, formHasCredential: true })
  })

  it('keeps the dialog layer marker and drops unknown layer values', () => {
    const parsed = parseCollectedPage(
      page({
        elements: [element({ layer: 'dialog' }), element({ layer: 'bogus' as unknown as 'dialog' })],
      }),
    )

    expect(parsed.elements[0]?.layer).toBe('dialog')
    expect(parsed.elements[1]?.layer).toBeUndefined()
  })
})

describe('buildPageSnapshot', () => {
  it('numbers visible interactive elements 1..N in DOM order', () => {    const snapshot = buildPageSnapshot(youtubeFixture)

    expect(snapshot.refs.map((r) => r.ref)).toEqual([...Array(20).keys()].map((n) => n + 1))
    expect(snapshot.totalVisible).toBe(20)
    expect(snapshot.truncated).toBe(false)
  })

  it('drops elements that are zero-sized or entirely outside the viewport', () => {
    const snapshot = buildPageSnapshot(youtubeFixture)
    const labels = snapshot.refs.map((r) => r.label)

    expect(labels).not.toContain('Footer link')
    expect(labels).not.toContain('Invisible menu')
  })

  it('resolves kinds: tags a→link, video→media, button/div[role=button]→button, inputs→input', () => {
    const snapshot = buildPageSnapshot(youtubeFixture)
    const kindOf = (label: string) => snapshot.refs.find((r) => r.label === label)?.kind

    expect(kindOf('YouTube Home')).toBe('link')
    expect(kindOf('Sign in')).toBe('link')
    expect(kindOf('Featured preview player')).toBe('media')
    expect(kindOf('Guide')).toBe('button')
    expect(kindOf('Show all')).toBe('button')
    expect(kindOf('Search')).toContain('input')
  })

  it('marks input elements with their input type', () => {
    const snapshot = buildPageSnapshot(youtubeFixture)
    const searchBox = snapshot.refs.find((r) => r.label === 'Search' && r.kind === 'input')

    expect(searchBox?.inputType).toBe('search')
  })

  it('treats submit/reset/image/button inputs as buttons', () => {
    const snapshot = buildPageSnapshot(
      page({
        elements: [
          element({ tag: 'input', inputType: 'submit', label: 'Submit form' }),
          element({ tag: 'input', inputType: 'image', label: 'Go' }),
          element({ tag: 'input', inputType: 'email', label: 'Email' }),
        ],
      }),
    )

    expect(snapshot.refs.map((r) => r.kind)).toEqual(['button', 'button', 'input'])
  })

  it('caps the ref list and reports how many were dropped', () => {
    const many = page({
      elements: Array.from({ length: 21 }, (_, i) => element({ label: `Link ${i}` })),
    })

    const snapshot = buildPageSnapshot(many, { maxRefs: 5 })

    expect(snapshot.refs).toHaveLength(5)
    expect(snapshot.totalVisible).toBe(21)
    expect(snapshot.truncated).toBe(true)
  })

  it('carries risk facts from the element onto its ref, defaulting when absent', () => {
    const snapshot = buildPageSnapshot(
      page({
        elements: [
          element({
            tag: 'a',
            label: 'Download probe',
            href: 'http://x.test/dl',
            downloadsFile: true,
          }),
          element({ label: 'Plain button' }),
        ],
      }),
    )

    expect(snapshot.refs[0]).toMatchObject({ href: 'http://x.test/dl', downloadsFile: true })
    expect(snapshot.refs[1]).toMatchObject({ href: null, downloadsFile: false, submitsForm: false, credentialField: false })
  })

  it('keeps dialog-layer elements even when they sit below the fold', () => {
    const snapshot = buildPageSnapshot(
      page({
        elements: [
          // Consent-wall buttons inside the dialog's own scroller, far past
          // the 800px viewport.
          element({ label: 'Accept all', rect: { x: 500, y: 2100, width: 120, height: 40 }, layer: 'dialog' }),
          element({ label: 'Page button' }),
          element({ label: 'Off-screen page button', rect: { x: 10, y: 900, width: 50, height: 30 } }),
        ],
      }),
    )

    expect(snapshot.refs.map((r) => r.label)).toEqual(['Accept all', 'Page button'])
  })

  it('counts dialog-layer elements as listed, not truncated away', () => {
    const snapshot = buildPageSnapshot(
      page({
        elements: [element({ label: 'Dialog control', rect: { x: 10, y: 5000, width: 50, height: 30 }, layer: 'dialog' })],
      }),
    )

    expect(snapshot.totalVisible).toBe(1)
    expect(snapshot.truncated).toBe(false)
  })
})

describe('formatPageSnapshot', () => {
  it('renders the youtube fixture as a numbered-ref listing', () => {
    const text = formatPageSnapshot(buildPageSnapshot(youtubeFixture))

    expect(text).toBe(`# YouTube — https://www.youtube.com/
viewport 1280x800 scroll 0/4521
[1] button "Guide"
[2] link "YouTube Home"
[3] input[search] "Search"
[4] button "Search"
[5] button "Search with your voice"
[6] button "Create"
[7] link "Sign in"
[8] link "Home"
[9] link "Trending"
[10] link "Music"
[11] link "Gaming"
[12] link "News"
[13] button "Show all"
[14] media "Featured preview player"
[15] link "Why I switched to Linux in 2026"
[16] link "MKBHD"
[17] button "Save to Watch later"
[18] link "The best mechanical keyboards of 2026"
[19] link "Linus Tech Tips"
[20] link "This keyboard should not exist"`)
  })

  it('omits the quoted label when there is none', () => {
    const text = formatPageSnapshot(buildPageSnapshot(page({ elements: [element({ label: '' })] })))

    expect(text).toContain('[1] button')
  })

  it('truncates labels longer than 80 characters', () => {
    const longLabel = 'x'.repeat(150)
    const text = formatPageSnapshot(buildPageSnapshot(page({ elements: [element({ label: longLabel })] })))

    expect(text).toContain(`[1] button "${'x'.repeat(79)}…`)
    expect(text).not.toContain('x'.repeat(80))
  })

  it('appends a dropped-count line when the snapshot was truncated', () => {
    const many = page({ elements: Array.from({ length: 21 }, (_, i) => element({ label: `Link ${i}` })) })
    const text = formatPageSnapshot(buildPageSnapshot(many, { maxRefs: 5 }))

    expect(text.endsWith('(+16 more not listed)')).toBe(true)
  })
})

describe('clickPoint', () => {
  it('returns the element center when it is fully inside the viewport', () => {
    const snapshot = buildPageSnapshot(
      page({ elements: [element({ rect: { x: 200, y: 380, width: 360, height: 202 } })] }),
    )

    expect(clickPoint(snapshot.refs[0], snapshot.viewport)).toEqual({ x: 380, y: 481 })
  })

  it('clamps into the visible part of elements crossing the viewport edge', () => {
    const snapshot = buildPageSnapshot(
      page({ elements: [element({ rect: { x: 10, y: 780, width: 100, height: 100 } })] }),
    )

    expect(clickPoint(snapshot.refs[0], snapshot.viewport)).toEqual({ x: 60, y: 799 })
  })
})
