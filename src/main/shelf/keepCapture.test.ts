import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureKeeper, type CaptureClipboard } from './keepCapture'

describe('createCaptureKeeper (#466)', () => {
  let dir: string
  let clipboard: { text: string[]; images: Uint8Array[] } & CaptureClipboard

  beforeEach(async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'bingbong-capture-')), 'bingbong_downloads')
    const text: string[] = []
    const images: Uint8Array[] = []
    clipboard = { text, images, writeText: (words) => text.push(words), writeImage: (bytes) => bytes[0] === 0x89 && images.push(bytes) > 0 }
  })
  afterEach(async () => {
    await rm(join(dir, '..'), { recursive: true, force: true })
  })

  it('puts a text capture on the Shelf as a file, and its text on the clipboard', async () => {
    const keep = createCaptureKeeper(() => dir, clipboard)
    const path = await keep({ name: 'capture-20261026-090507-npm.txt', text: 'npm init playwright@latest' })
    expect(path).toBe(join(dir, 'capture-20261026-090507-npm.txt'))
    expect(await readFile(path, 'utf8')).toBe('npm init playwright@latest\n')
    expect(clipboard.text).toEqual(['npm init playwright@latest'])
    expect(clipboard.images).toEqual([])
  })

  it('puts an image capture on the Shelf as its bytes, and the image on the clipboard', async () => {
    const keep = createCaptureKeeper(() => dir, clipboard)
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const path = await keep({ name: 'capture-20261026-090507-pasta.png', bytes })
    expect(new Uint8Array(await readFile(path))).toEqual(bytes)
    expect(clipboard.images).toEqual([bytes])
    expect(clipboard.text).toEqual([])
  })

  it('puts the file\'s path on the clipboard for an image it cannot decode', async () => {
    const keep = createCaptureKeeper(() => dir, clipboard)
    const path = await keep({ name: 'capture-20261026-090507-pasta.webp', bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]) })
    expect(clipboard.images).toEqual([])
    expect(clipboard.text).toEqual([path])
  })

  it('never writes over a file already on the Shelf', async () => {
    const keep = createCaptureKeeper(() => dir, clipboard)
    await keep({ name: 'capture-20261026-090507.txt', text: 'one' })
    const second = await keep({ name: 'capture-20261026-090507.txt', text: 'two' })
    expect(second).toBe(join(dir, 'capture-20261026-090507-2.txt'))
    expect(await readFile(join(dir, 'capture-20261026-090507.txt'), 'utf8')).toBe('one\n')
  })
})
