import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DAY_MS } from './score'
import {
  emptyStoryImages,
  gatherStoryImages,
  imageInfo,
  playOnce,
  previewImages,
  pruneStoryImages,
  sourceTile,
  type StoryImagePorts,
  type StoryImages,
} from './storyImage'

// Images made for these tests (fixtures/images): a 640×360 JPEG, a 120×120
// PNG, a 600×338 WebP, two-frame looping GIF, WebP and APNG at 400×225, and an SVG.
const image = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url)))
const PHOTO = image('photo.jpg')
const SMALL = image('small.png')
const STILL_WEBP = image('still.webp')
const GIF = image('anim.gif')
const WEBP = image('anim.webp')
const APNG = image('anim.png')
const SVG = image('logo.svg')

const AT = new Date(2026, 9, 19, 12).getTime()
const HOUR = 60 * 60 * 1000

const ascii = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')

/** A page's head naming its preview images. */
function page(...metas: [string, string][]): string {
  return `<!doctype html><html><head><title>A story</title>${metas.map(([property, content]) => `<meta property="${property}" content="${content}">`).join('')}</head><body>…</body></html>`
}

/** The network as a map of addresses, and a cache in memory; every request and save recorded. */
function ports(pages: Record<string, string>, images: Record<string, Uint8Array>): StoryImagePorts & { asked: string[]; files: Map<string, Uint8Array> } {
  let saved = 0
  const fake = {
    asked: [] as string[],
    files: new Map<string, Uint8Array>(),
    async fetchPage(url: string) {
      fake.asked.push(url)
      if (!(url in pages)) throw new Error(`404 ${url}`)
      return pages[url]
    },
    async fetchImage(url: string) {
      fake.asked.push(url)
      if (!(url in images)) throw new Error(`404 ${url}`)
      return images[url]
    },
    save(bytes: Uint8Array, format: string) {
      const file = `${(saved += 1)}.${format}`
      fake.files.set(file, bytes)
      return file
    },
    remove(file: string) {
      fake.files.delete(file)
    },
  }
  return fake
}

const story = (key: string, link: string, image: string | null = null) => ({ key, cluster: key, link, image })

const fileOf = (images: StoryImages, key: string): string | null | undefined => images.stories[key]?.file

describe('imageInfo', () => {
  it('reads a raster image’s format, size and whether it moves', () => {
    expect(imageInfo(PHOTO)).toEqual({ format: 'jpg', width: 640, height: 360, animated: false })
    expect(imageInfo(SMALL)).toEqual({ format: 'png', width: 120, height: 120, animated: false })
    expect(imageInfo(STILL_WEBP)).toEqual({ format: 'webp', width: 600, height: 338, animated: false })
    expect(imageInfo(GIF)).toEqual({ format: 'gif', width: 400, height: 225, animated: true })
    expect(imageInfo(WEBP)).toEqual({ format: 'webp', width: 400, height: 225, animated: true })
    expect(imageInfo(APNG)).toEqual({ format: 'png', width: 400, height: 225, animated: true })
  })

  it('reads an SVG, or anything not a raster image, as none', () => {
    expect(imageInfo(SVG)).toBeNull()
    expect(imageInfo(new TextEncoder().encode('<html>Not found</html>'))).toBeNull()
  })
})

describe('playOnce', () => {
  it('makes a looping GIF play through once: its loop extension gone, its frames kept', () => {
    expect(ascii(GIF)).toContain('NETSCAPE2.0')
    const once = playOnce(GIF)
    expect(ascii(once)).not.toContain('NETSCAPE2.0')
    expect(imageInfo(once)).toEqual(imageInfo(GIF))
    expect(once.length).toBe(GIF.length - 19)
  })

  it('makes a looping WebP and APNG play once: their loop count one', () => {
    const webp = playOnce(WEBP)
    const anim = ascii(webp).indexOf('ANIM')
    expect(webp[anim + 12] | (webp[anim + 13] << 8)).toBe(1)
    const png = playOnce(APNG)
    const actl = ascii(png).indexOf('acTL')
    expect(new DataView(png.buffer, png.byteOffset).getUint32(actl + 8)).toBe(1)
    expect(imageInfo(png)).toEqual(imageInfo(APNG))
  })

  it('leaves a still image as it is', () => {
    expect(playOnce(PHOTO)).toBe(PHOTO)
  })
})

describe('previewImages', () => {
  it('reads the page’s og:image then its twitter:image, resolved against the page', () => {
    const head = `<head><meta name="twitter:image" content="https://cdn.example.com/t.jpg"><meta content="/og.jpg?w=1200&amp;h=630" property="og:image"></head>`
    expect(previewImages(head, 'https://example.com/story/1')).toEqual(['https://example.com/og.jpg?w=1200&h=630', 'https://cdn.example.com/t.jpg'])
  })

  it('reads a page with no preview image as none', () => {
    expect(previewImages(page(['og:title', 'A story']), 'https://example.com/1')).toEqual([])
  })
})

describe('gatherStoryImages', () => {
  it('takes the story’s own image first, without reading its page', async () => {
    const net = ports({}, { 'https://cdn.example.com/feed.jpg': PHOTO })
    const images = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a', 'https://cdn.example.com/feed.jpg')], net, AT)

    expect(net.asked).toEqual(['https://cdn.example.com/feed.jpg'])
    expect(net.files.get(fileOf(images, 'a') ?? '')).toBe(PHOTO)
  })

  it('reads the page’s preview image when the story has none, or its own is too small', async () => {
    const net = ports(
      { 'https://example.com/a': page(['og:image', 'https://example.com/a.jpg']), 'https://example.com/b': page(['og:image', 'https://example.com/b.webp']) },
      { 'https://example.com/a.jpg': PHOTO, 'https://cdn.example.com/tiny.png': SMALL, 'https://example.com/b.webp': STILL_WEBP },
    )
    const images = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a'), story('b', 'https://example.com/b', 'https://cdn.example.com/tiny.png')], net, AT)

    expect(net.files.get(fileOf(images, 'a') ?? '')).toBe(PHOTO)
    expect(net.files.get(fileOf(images, 'b') ?? '')).toBe(STILL_WEBP)
  })

  it('passes over an SVG and a favicon for the next preview image', async () => {
    const net = ports(
      { 'https://example.com/a': page(['og:image', 'https://example.com/logo.svg'], ['og:image', 'https://example.com/favicon-512.png'], ['twitter:image', 'https://example.com/card.jpg']) },
      { 'https://example.com/logo.svg': SVG, 'https://example.com/favicon-512.png': PHOTO, 'https://example.com/card.jpg': PHOTO },
    )
    const images = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a')], net, AT)

    expect(net.asked).toEqual(['https://example.com/a', 'https://example.com/card.jpg'])
    expect(fileOf(images, 'a')).not.toBeNull()
  })

  it('falls back to the tile when the page names no preview image, and asks again a day later, not every poll', async () => {
    const net = ports({ 'https://example.com/a': page() }, {})
    const first = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a')], net, AT)
    expect(fileOf(first, 'a')).toBeNull()

    const hourLater = await gatherStoryImages(first, [story('a', 'https://example.com/a')], net, AT + HOUR)
    expect(net.asked).toEqual(['https://example.com/a'])
    await gatherStoryImages(hourLater, [story('a', 'https://example.com/a')], net, AT + DAY_MS)
    expect(net.asked).toEqual(['https://example.com/a', 'https://example.com/a'])
  })

  it('does not fetch a picture it already holds again', async () => {
    const net = ports({}, { 'https://cdn.example.com/feed.jpg': PHOTO })
    const first = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a', 'https://cdn.example.com/feed.jpg')], net, AT)
    await gatherStoryImages(first, [story('a', 'https://example.com/a', 'https://cdn.example.com/feed.jpg')], net, AT + 40 * DAY_MS)
    expect(net.asked).toHaveLength(1)
  })

  it('rejects the image a site serves for several different stories as its logo, the earlier story’s picture dropped too', async () => {
    const banner = page(['og:image', 'https://news.example.com/default-banner.jpg'])
    const net = ports({ 'https://news.example.com/1': banner, 'https://news.example.com/2': banner }, { 'https://news.example.com/default-banner.jpg': PHOTO })
    const first = await gatherStoryImages(emptyStoryImages(), [story('one', 'https://news.example.com/1')], net, AT)
    expect(fileOf(first, 'one')).not.toBeNull()

    const second = await gatherStoryImages(first, [story('two', 'https://news.example.com/2')], net, AT + HOUR)
    expect(fileOf(second, 'two')).toBeNull()
    expect(fileOf(second, 'one')).toBeNull()
    expect(net.files.size).toBe(0)
  })

  it('rejects a logo two stories of one poll share', async () => {
    const banner = page(['og:image', 'https://news.example.com/logo.jpg'])
    const net = ports({ 'https://news.example.com/1': banner, 'https://news.example.com/2': banner }, { 'https://news.example.com/logo.jpg': PHOTO })
    const images = await gatherStoryImages(emptyStoryImages(), [story('one', 'https://news.example.com/1'), story('two', 'https://news.example.com/2')], net, AT)
    expect([fileOf(images, 'one'), fileOf(images, 'two')]).toEqual([null, null])
  })

  it('falls back to the tile when a fetch fails, and does not retry it within the day', async () => {
    const net = ports({ 'https://example.com/a': page(['og:image', 'https://example.com/gone.jpg']) }, {})
    const first = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a')], net, AT)
    await gatherStoryImages(first, [story('a', 'https://example.com/a')], net, AT + 5 * HOUR)
    expect(fileOf(first, 'a')).toBeNull()
    expect(net.asked).toEqual(['https://example.com/a', 'https://example.com/gone.jpg'])
  })

  it('caches an animated GIF to play once', async () => {
    const net = ports({}, { 'https://cdn.example.com/a.gif': GIF })
    const images = await gatherStoryImages(emptyStoryImages(), [story('a', 'https://example.com/a', 'https://cdn.example.com/a.gif')], net, AT)
    expect(ascii(net.files.get(fileOf(images, 'a') ?? '') ?? new Uint8Array())).not.toContain('NETSCAPE2.0')
  })
})

describe('sourceTile', () => {
  it('draws a known source in its own colour, a subreddit in Reddit’s, any other in one of its own, with ink that reads on it', () => {
    expect(sourceTile('Hacker News')).toEqual({ colour: '#ff6600', ink: '#ffffff', initial: 'H' })
    expect(sourceTile('Hugging Face')).toEqual({ colour: '#ffd21e', ink: '#1b1b1b', initial: 'H' })
    expect(sourceTile('r/neovim')).toEqual({ colour: '#ff4500', ink: '#ffffff', initial: 'r/' })
    expect(sourceTile('Simon Willison')).toEqual(sourceTile('Simon Willison'))
    expect(sourceTile('Simon Willison').colour).toMatch(/^hsl\(/)
  })
})

describe('pruneStoryImages', () => {
  it('drops a story’s picture, file and all, when the history drops the story', async () => {
    const net = ports({}, { 'https://cdn.example.com/a.jpg': PHOTO, 'https://cdn.example.com/b.jpg': PHOTO })
    const images = await gatherStoryImages(
      emptyStoryImages(),
      [story('a', 'https://example.com/a', 'https://cdn.example.com/a.jpg'), story('b', 'https://example.com/b', 'https://cdn.example.com/b.jpg')],
      net,
      AT,
    )
    const pruned = pruneStoryImages(images, new Map([['b', 'b']]), net)

    expect(Object.keys(pruned.stories)).toEqual(['b'])
    expect([...net.files.keys()]).toEqual([fileOf(images, 'b')])
    expect(Object.values(pruned.served).flatMap((urls) => Object.values(urls).flat())).toEqual(['b'])
  })
})
