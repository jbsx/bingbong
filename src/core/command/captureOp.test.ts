import { describe, expect, it } from 'vitest'
import type { CommandRef } from './command'
import { captureAnswer, captureFileName, captureImage, captureKindOf, captureLabelOf } from './captureOp'

const ref = (kind: CommandRef['kind'], href: string | null = null, inputType: string | null = null): CommandRef => ({ ref: 4, kind, label: 'Some label', href, inputType })

describe('captureKindOf', () => {
  it('captures a link by its address and an image by its bytes', () => {
    expect(captureKindOf(ref('link', 'https://example.com/a'))).toBe('link')
    expect(captureKindOf(ref('image'))).toBe('image')
  })

  it.each([
    ['a button', ref('button')],
    ['a text field', ref('input', null, 'text')],
    ['a media element', ref('media')],
    ['a scroll region', ref('region')],
    ['an iframe', ref('iframe')],
    ['a link that goes nowhere', ref('link', null)],
  ])('offers no capture on %s: a control is no capturing kind', (_name, control) => {
    expect(captureKindOf(control)).toBeNull()
  })
})

describe('captureFileName', () => {
  const at = new Date(2026, 9, 26, 9, 5, 7)

  it('names the file by the local time and a slug of what was captured', () => {
    expect(captureFileName(at, 'iPhone Duo Review: First Generation Fun! - YouTube', 'txt')).toBe('capture-20261026-090507-iphone-duo-review-first-generation-fun.txt')
  })

  it('keeps an image its own extension', () => {
    expect(captureFileName(at, 'A plate of pasta', 'webp')).toBe('capture-20261026-090507-a-plate-of-pasta.webp')
  })

  it('holds the slug to a few words, cut at a word', () => {
    expect(captureFileName(at, 'one two three four five six seven eight nine ten eleven twelve', 'txt')).toBe('capture-20261026-090507-one-two-three-four-five-six-seven-eight.txt')
  })

  it('names a capture of no words by the time alone', () => {
    expect(captureFileName(at, '  !!  ', 'png')).toBe('capture-20261026-090507.png')
  })
})

describe('captureLabelOf', () => {
  it.each([
    ['capture-12', { of: 'ref', n: 12 }],
    ['capture-text-3', { of: 'text', n: 3 }],
    ['capture-view-2', { of: 'view', n: 2 }],
    ['capture-page', { of: 'page' }],
  ])('reads %s', (label, read) => {
    expect(captureLabelOf(label)).toEqual(read)
  })

  it.each(['click-12', 'capture', 'capture-text', 'show-3'])('reads no capture in %s', (label) => {
    expect(captureLabelOf(label)).toBeNull()
  })
})

describe('captureImage', () => {
  const shot = new Uint8Array([0xff, 0xd8, 0xff])
  const clip = async (): Promise<Uint8Array> => shot
  const base64 = (text: string): string => Buffer.from(text).toString('base64')

  it('keeps the bytes the page fetched, with the extension its type names', async () => {
    const image = await captureImage({ data: base64('webp bytes'), type: 'image/webp', src: 'https://cdn.example/a.jpg?w=200' }, clip)
    expect(image).toEqual({ bytes: new Uint8Array(Buffer.from('webp bytes')), ext: 'webp', via: 'fetch' })
  })

  it('reads the extension off the address when the type names none', async () => {
    const image = await captureImage({ data: base64('x'), type: '', src: 'https://cdn.example/photo.PNG?w=200' }, clip)
    expect(image.ext).toBe('png')
  })

  it('falls back to a clipped screenshot of the image when the fetch failed', async () => {
    expect(await captureImage({ src: 'https://cdn.example/a.jpg' }, clip)).toEqual({ bytes: shot, ext: 'jpg', via: 'screenshot' })
  })

  it('falls back when the fetch brought back no image', async () => {
    expect((await captureImage({ data: base64('<html>'), type: 'text/html', src: 'https://cdn.example/a' }, clip)).via).toBe('screenshot')
  })
})

describe('captureAnswer', () => {
  it.each([
    ['link', 'Copied the link to the Shelf.'],
    ['text', 'Copied the text to the Shelf.'],
    ['image', 'Copied the image to the Shelf.'],
    ['page', 'Copied the page to the Shelf.'],
  ] as const)('says a %s capture in one sentence', (kind, said) => {
    expect(captureAnswer(kind)).toBe(said)
  })
})
