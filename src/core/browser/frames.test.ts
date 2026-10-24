import { describe, expect, it } from 'vitest'
import { mergeFrames, type CollectedFrame } from './frames'
import type { CollectedTextBlock } from './pageText'
import { buildPageSnapshot, type CollectedElement, type CollectedPage } from './snapshot'

const VIEWPORT = { width: 1000, height: 600, scrollX: 0, scrollY: 0, scrollHeight: 600 }

function element(tag: string, label: string, rect: { x: number; y: number; width?: number; height?: number }, extra: Partial<CollectedElement> = {}): CollectedElement {
  return { tag, role: null, inputType: null, label, rect: { width: 40, height: 20, ...rect }, layer: 'page', previousIndex: -1, ...extra }
}

/** An iframe at (x, y), its content box `border` px further in, holding window.frames[slot]. */
function iframe(slot: number, rect: { x: number; y: number; width?: number; height?: number }, extra: Partial<CollectedElement> = {}): CollectedElement {
  return element('iframe', '', { width: 400, height: 300, ...rect }, { frameIndex: slot, frameBox: { x: rect.x + 2, y: rect.y + 2 }, src: null, ...extra })
}

function page(url: string, elements: CollectedElement[], extra: Partial<CollectedPage> = {}): CollectedPage {
  return { url, title: url, viewport: VIEWPORT, elements, ...extra }
}

function frame(key: string, parentKey: string | null, slot: number, url: string, elements: CollectedElement[]): CollectedFrame {
  return { key, parentKey, page: page(url, elements, { frameIndex: slot, viewport: { ...VIEWPORT, width: 396, height: 296 } }) }
}

describe('mergeFrames (#377, ADR 0081)', () => {
  it("puts a frame's refs at its iframe's place, at the page's coordinates, its host named", () => {
    const top = page('https://news.example/a', [element('a', 'Home', { x: 0, y: 0 }), iframe(0, { x: 100, y: 200 }), element('button', 'Share', { x: 0, y: 550 })])
    const embed = frame('f1', null, 0, 'https://www.youtube.com/embed/x', [element('video', '', { x: 0, y: 0, width: 396, height: 296 }), element('button', 'Play', { x: 10, y: 250 })])

    const { page: merged, addresses } = mergeFrames(top, [embed])

    expect(merged.elements.map((el) => el.label)).toEqual(['Home', '', 'Play', 'Share'])
    expect(merged.elements[2]).toMatchObject({ rect: { x: 112, y: 452 }, frameHost: 'youtube.com' })
    expect(merged.elements[0].frameHost).toBeUndefined()
    expect(addresses).toEqual([
      { frame: null, index: 0 },
      { frame: 'f1', index: 0 },
      { frame: 'f1', index: 1 },
      { frame: null, index: 2 },
    ])
  })

  it("points a frame's Player Switches at their places in the whole page, and drops one its frame left out (#389)", () => {
    const top = page('https://news.example/a', [element('a', 'Home', { x: 0, y: 0 }), iframe(0, { x: 100, y: 200 })])
    const embed = frame('f1', null, 0, 'https://www.youtube.com/embed/x', [
      element('button', 'Off the page', { x: 10, y: 5000 }),
      element('video', '', { x: 0, y: 0, width: 396, height: 296 }, { switches: [{ index: 2, on: true }, { index: 0, on: false }] }),
      element('button', 'Subtitles/closed captions', { x: 10, y: 250 }),
    ])

    const { page: merged } = mergeFrames(top, [embed])

    expect(merged.elements.map((el) => el.label)).toEqual(['Home', '', 'Subtitles/closed captions'])
    expect(merged.elements[1]?.switches).toEqual([{ index: 2, on: true }])
    // Its switch is the whole page's third element: the ref it becomes.
    expect(buildPageSnapshot(merged).refs[1]?.switches).toEqual([{ ref: 3, label: 'Subtitles/closed captions', on: true }])
  })

  it("names a script-written frame by the origin it inherited, never by about:blank", () => {
    const top = page('https://www.w3schools.com/tryit', [iframe(0, { x: 0, y: 0 }, { layer: 'dialog' })])
    const wall = { ...frame('cmp', null, 0, 'about:blank', [element('button', 'Decline', { x: 0, y: 0 })]), page: { ...page('about:blank', [element('button', 'Decline', { x: 0, y: 0 })]), frameIndex: 0, origin: 'https://www.w3schools.com' } }
    const sandboxed = { ...frame('ad', null, 0, 'about:srcdoc', []), page: { ...page('about:srcdoc', [element('a', 'Ad', { x: 0, y: 0 })]), frameIndex: 0, origin: 'null' } }

    expect(mergeFrames(top, [wall]).page.elements[0]?.frameHost).toBe('w3schools.com')
    expect(mergeFrames(top, [sandboxed]).page.elements[0]?.frameHost).toBe('about:srcdoc')
  })

  it('sums every ancestor iframe’s content-box origin for a frame at any depth, each frame paired by its own slot', () => {
    // The page's second iframe was created first: frames[0] is the one later in the DOM.
    const top = page('https://course.example/', [iframe(1, { x: 0, y: 0, width: 50, height: 50 }), iframe(0, { x: 100, y: 100 })])
    const player = frame('outer', null, 0, 'https://player.example/', [iframe(0, { x: 10, y: 20 })])
    const nested = frame('inner', 'outer', 0, 'https://cdn.video.example/v', [element('button', 'Pause', { x: 5, y: 5 })])
    const small = frame('side', null, 1, 'https://side.example/', [element('a', 'Side', { x: 1, y: 1 })])

    const { page: merged, addresses } = mergeFrames(top, [nested, player, small])

    expect(merged.elements.map((el) => [el.label, el.rect.x, el.rect.y, el.frameHost])).toEqual([
      ['Side', 3, 3, 'side.example'],
      ['Pause', 119, 129, 'cdn.video.example'],
    ])
    expect(addresses).toEqual([
      { frame: 'side', index: 0 },
      { frame: 'inner', index: 0 },
    ])
  })

  it('keeps a frame that was not read, of any origin, as its opaque iframe ref', () => {
    const challenge = iframe(0, { x: 0, y: 0 }, { src: 'https://challenges.cloudflare.com/turnstile' })
    const sameOrigin = iframe(1, { x: 0, y: 300 })
    const { page: merged, addresses } = mergeFrames(page('https://shop.example/', [challenge, sameOrigin]), [])

    expect(merged.elements).toEqual([challenge, sameOrigin])
    expect(addresses).toEqual([{ frame: null, index: 0 }, { frame: null, index: 1 }])
  })

  it('takes nothing from a frame whose iframe is 2×2 CSS px or smaller, read or not', () => {
    const pixel = iframe(0, { x: 0, y: 0, width: 2, height: 2 }, { src: 'https://tracker.example/p' })
    const tracker = frame('t', null, 0, 'https://tracker.example/p', [element('a', 'Opt out', { x: 0, y: 0, width: 1, height: 1 })])

    expect(mergeFrames(page('https://news.example/', [pixel]), [tracker]).page.elements).toEqual([])
  })

  it("leaves out a frame's element that falls outside the top viewport, unless it is a control of the top's open dialog", () => {
    const low = iframe(0, { x: 0, y: 500 })
    const embed = frame('f', null, 0, 'https://embed.example/', [element('button', 'Seen', { x: 0, y: 10 }), element('button', 'Below the fold', { x: 0, y: 200 })])
    expect(mergeFrames(page('https://a.example/', [low]), [embed]).page.elements.map((el) => el.label)).toEqual(['Seen'])

    const walled = iframe(0, { x: 0, y: 500 }, { layer: 'dialog' })
    const wall = frame('w', null, 0, 'https://consent.example/', [element('button', 'Reject all', { x: 0, y: 200 })])
    expect(mergeFrames(page('https://a.example/', [walled], { dialogOpen: true }), [wall]).page.elements).toMatchObject([{ label: 'Reject all', layer: 'dialog' }])
  })

  it("keeps a frame's element taken for the dialog layer alone — below its own frame's fold, or by a dialog-only cue — only when its iframe sits in the top's open dialog (#414)", () => {
    const controls = [element('div', 'Accept all & continue', { x: 0, y: 20 }), element('button', 'Reject & pay', { x: 0, y: 306 }, { dialogOnly: true }), element('span', '×', { x: 380, y: 0 }, { dialogOnly: true })]
    const walled = iframe(0, { x: 0, y: 0 }, { layer: 'dialog' })
    expect(mergeFrames(page('https://a.example/', [walled], { dialogOpen: true }), [frame('w', null, 0, 'https://consent.example/', controls)]).page.elements.map((el) => [el.label, el.layer])).toEqual([
      ['Accept all & continue', 'dialog'],
      ['Reject & pay', 'dialog'],
      ['×', 'dialog'],
    ])
    expect(mergeFrames(page('https://a.example/', [iframe(0, { x: 0, y: 0 })]), [frame('p', null, 0, 'https://embed.example/', controls)]).page.elements.map((el) => el.label)).toEqual(['Accept all & continue'])
  })

  it('reads an element as already there by its own frame’s previous collect, at its previous place in the whole page', () => {
    const top = page('https://a.example/', [element('a', 'Home', { x: 0, y: 0 }, { previousIndex: 0 }), iframe(1, { x: 0, y: 100 })])
    const embed = frame('f', null, 1, 'https://embed.example/', [element('button', 'Old', { x: 0, y: 0 }, { previousIndex: 3 }), element('button', 'New', { x: 0, y: 30 }, { previousIndex: -1 })])
    const previous = [{ frame: null, index: 0 }, { frame: 'f', index: 3 }]

    expect(mergeFrames(top, [embed], previous).page.elements.map((el) => el.previousIndex)).toEqual([0, 1, -1])
  })
})

describe("mergeFrames: a frame's text (#378, ADR 0081)", () => {
  const text = (value: string): CollectedTextBlock => ({ kind: 'text', text: value })
  const at = (slot: number): CollectedTextBlock => ({ kind: 'frame', slot })
  const textsOf = (merged: CollectedPage): string[] => (merged.textBlocks ?? []).map((block) => (block.kind === 'text' ? block.text : `<${block.kind}>`))
  const withText = (read: CollectedFrame, blocks: CollectedTextBlock[]): CollectedFrame => ({ ...read, page: { ...read.page, textBlocks: blocks } })

  it("puts each read frame's text at its iframe's place, a nested frame's inside its parent's", () => {
    const top = page('https://news.example/a', [iframe(0, { x: 0, y: 0 })], { textBlocks: [text('Intro'), at(0), text('Outro')] })
    const outer = withText(frame('outer', null, 0, 'https://comments.example/', [iframe(0, { x: 10, y: 10, width: 100, height: 100 })]), [text('First comment'), at(0), text('Last comment')])
    const inner = withText(frame('inner', 'outer', 0, 'https://quote.example/', []), [text('Quoted tweet')])

    expect(textsOf(mergeFrames(top, [inner, outer]).page)).toEqual(['Intro', 'First comment', 'Quoted tweet', 'Last comment', 'Outro'])
  })

  it("names the frame each of a frame's blocks was read in, so a Show Op finds its node there; the top's own name none (#393)", () => {
    const top = page('https://news.example/a', [iframe(0, { x: 0, y: 0 })], { textBlocks: [{ kind: 'text', text: 'Intro', below: true, node: 0 }, at(0)] })
    const outer = withText(frame('outer', null, 0, 'https://comments.example/', []), [{ kind: 'text', text: 'A comment', below: true, node: 0 }])

    expect(mergeFrames(top, [outer]).page.textBlocks).toEqual([
      { kind: 'text', text: 'Intro', below: true, node: 0 },
      { kind: 'text', text: 'A comment', below: true, node: 0, frame: 'outer' },
    ])
  })

  it('takes no text from a frame not read, a frame 2×2 px or smaller, or a nested frame outside the top viewport', () => {
    const top = page('https://a.example/', [iframe(0, { x: 0, y: 0 }), iframe(1, { x: 0, y: 400, width: 2, height: 2 })], { textBlocks: [at(0), at(1), at(2), text('Body')] })
    const outer = withText(frame('outer', null, 0, 'https://o.example/', [iframe(0, { x: 0, y: 2000 })]), [text('Outer'), at(0)])
    const low = withText(frame('low', 'outer', 0, 'https://low.example/', []), [text('Below the fold')])
    const pixel = withText(frame('pixel', null, 1, 'https://tracker.example/', []), [text('Tracker')])

    expect(textsOf(mergeFrames(top, [outer, low, pixel]).page)).toEqual(['Outer', 'Body'])
  })

  it("adds a frame in the top's open dialog to the dialog's text, wherever its iframe sits; a page frame outside the text has no place", () => {
    // Neither iframe has a place in the page text: both sit outside the main landmark.
    const top = page('https://news.example/', [iframe(0, { x: 0, y: 0 }, { layer: 'dialog' }), iframe(1, { x: 500, y: 0 })], {
      dialogOpen: true,
      dialogText: 'Your privacy',
      textBlocks: [text('Headline')],
    })
    const wall = withText(frame('cmp', null, 0, 'https://cdn.privacy-mgmt.com/', [element('button', 'Yes, I’m happy', { x: 0, y: 0 })]), [text('We use cookies.'), text('Reject all and subscribe for £5 a month.')])
    const ad = withText(frame('ad', null, 1, 'https://ads.example/', []), [text('Buy now')])

    const merged = mergeFrames(top, [wall, ad]).page

    expect(merged.dialogText).toBe('Your privacy We use cookies. Reject all and subscribe for £5 a month.')
    expect(textsOf(merged)).toEqual(['Headline'])
  })
})
