import { NEWS_IMAGE_SCHEME } from './ipcChannels'
import { decodeEntities } from './markup'
import { hostOf } from './news'
import { DAY_MS } from './score'

// Story Image (CONTEXT.md): the one picture each story the News card shows
// carries — Today's Highlight and Big News, a handful a poll. In order: the
// source's own image for the story (a feed post's media, a repo's social
// preview, a Reddit post's preview), else the article page's preview image
// (og:image, then twitter:image), else the source's tile, which the card
// draws. A candidate is passed over when it is an SVG or a favicon, under
// MIN_WIDTH wide, not a raster image at all, or the one its site has served
// for another story (the site's logo or default banner). A picture is
// downloaded once into the cache main keeps in userData, an animated one
// rewritten to play through once, and dropped with its story when the story
// history prunes it; a story left with the tile is asked about again a day
// later, not every poll.

/** The narrowest picture kept: anything smaller is an icon or a logo. */
export const MIN_WIDTH = 300

/** How soon a story that got the tile is asked about again. */
export const IMAGE_RETRY_MS = DAY_MS

export type ImageFormat = 'jpg' | 'png' | 'gif' | 'webp'

export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
  animated: boolean
}

/** What one shown story gave: its cached file (null: the tile), the address it came from, when it was asked, and the story's site and cluster. */
export interface StoryImageRecord {
  file: string | null
  url: string | null
  at: number
  site: string
  cluster: string
}

/** The colours the tile of a source the card knows is drawn in: its own. */
const SOURCE_COLOURS: Record<string, string> = {
  'Hacker News': '#ff6600',
  'GitHub trending': '#24292f',
  'Hugging Face': '#ffd21e',
  'Hugging Face papers': '#ffd21e',
  OpenAI: '#10a37f',
  Anthropic: '#d97757',
  'Google DeepMind': '#4285f4',
  'Ars Technica': '#ff4e00',
  'The Verge': '#5200ff',
  Electrek: '#1e8f4e',
}

const REDDIT_COLOUR = '#ff4500'

/** Whether a #rrggbb colour is light enough that dark ink reads on it. */
function isLight(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55
}

/**
 * The tile a story with no picture shows instead (CONTEXT.md, Story Image):
 * its source's colour — a feed or subreddit the card does not know gets one
 * of its own from its name — the ink that reads on it, and the source's
 * initial for a thumbnail ("r/" for a subreddit).
 */
export function sourceTile(source: string): { colour: string; ink: string; initial: string } {
  const initial = source.startsWith('r/') ? 'r/' : (/[\p{L}\p{N}]/u.exec(source)?.[0] ?? '?').toUpperCase()
  const known = SOURCE_COLOURS[source] ?? (source.startsWith('r/') ? REDDIT_COLOUR : undefined)
  if (known !== undefined) return { colour: known, ink: isLight(known) ? '#1b1b1b' : '#ffffff', initial }
  let hash = 0
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return { colour: `hsl(${hash % 360} 52% 40%)`, ink: '#ffffff', initial }
}

/** The cache's index, kept in news.json: each shown story's picture by story key, and each site's images by the clusters it served them for. */
export interface StoryImages {
  stories: Record<string, StoryImageRecord>
  served: Record<string, Record<string, string[]>>
}

/** A shown story as the picture is chosen for it. */
export interface ImageStory {
  key: string
  cluster: string
  link: string
  /** The source's own image for it: the first candidate. */
  image: string | null
}

/** The network and the cache, main's: a page's head as text, an image's bytes, a file saved (its name answered) and removed. */
export interface StoryImagePorts {
  fetchPage(url: string): Promise<string>
  fetchImage(url: string): Promise<Uint8Array>
  save(bytes: Uint8Array, format: ImageFormat): string
  remove(file: string): void
}

export function emptyStoryImages(): StoryImages {
  return { stories: {}, served: {} }
}

/** A cached file's name as main saves it: a name and a raster image's extension, nothing that leaves the cache folder. */
export const CACHED_FILE = /^[\w-]+\.(jpg|png|gif|webp)$/

/** The address the renderer loads a cached picture from. */
export function storyImageUrl(file: string): string {
  return `${NEWS_IMAGE_SCHEME}://image/${file}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Anything (news.json) as the cache's index: well-formed entries kept, a file name that could leave the cache folder dropped. */
export function sanitizeStoryImages(raw: unknown): StoryImages {
  if (!isRecord(raw)) return emptyStoryImages()
  const stories: StoryImages['stories'] = {}
  for (const [key, record] of Object.entries(isRecord(raw.stories) ? raw.stories : {})) {
    if (!isRecord(record)) continue
    const { file, url, at, site, cluster } = record
    if (!(file === null || (typeof file === 'string' && CACHED_FILE.test(file))) || !(url === null || typeof url === 'string')) continue
    if (typeof at !== 'number' || typeof site !== 'string' || typeof cluster !== 'string') continue
    stories[key] = { file, url, at, site, cluster }
  }
  const served: StoryImages['served'] = {}
  for (const [site, urls] of Object.entries(isRecord(raw.served) ? raw.served : {})) {
    if (!isRecord(urls)) continue
    for (const [url, clusters] of Object.entries(urls)) {
      const kept = Array.isArray(clusters) ? clusters.filter((cluster): cluster is string => typeof cluster === 'string') : []
      if (kept.length > 0) served[site] = { ...served[site], [url]: kept }
    }
  }
  return { stories, served }
}

const u16le = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8)
const u16be = (bytes: Uint8Array, at: number): number => (bytes[at] << 8) | bytes[at + 1]
const u24le = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
const u32be = (bytes: Uint8Array, at: number): number => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
const u32le = (bytes: Uint8Array, at: number): number => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
const tag = (bytes: Uint8Array, at: number, length = 4): string => String.fromCharCode(...bytes.subarray(at, at + length))

/** A PNG's chunks: each one's type and where its data starts and ends. */
function pngChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
  const chunks = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = u32be(bytes, at)
    chunks.push({ type: tag(bytes, at + 4), start: at + 8, end: at + 8 + length })
    at += 12 + length
  }
  return chunks
}

/** A WebP's chunks: each one's fourcc and where its data starts. */
function webpChunks(bytes: Uint8Array): { type: string; start: number; size: number }[] {
  const chunks = []
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = u32le(bytes, at + 4)
    chunks.push({ type: tag(bytes, at), start: at + 8, size })
    at += 8 + size + (size % 2)
  }
  return chunks
}

/** A GIF's blocks after its header and colour table: each extension's label and each image, with where it starts and ends. */
function gifBlocks(bytes: Uint8Array): { kind: 'extension' | 'image'; label: string; start: number; end: number }[] | null {
  const packed = bytes[10]
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0)
  const blocks = []
  const subBlocks = (from: number): number => {
    let next = from
    while (next < bytes.length && bytes[next] !== 0) next += bytes[next] + 1
    return next + 1
  }
  while (at < bytes.length) {
    const start = at
    if (bytes[at] === 0x3b) return blocks
    if (bytes[at] === 0x21) {
      const label = bytes[at + 1] === 0xff ? tag(bytes, at + 3, bytes[at + 2]) : String(bytes[at + 1])
      at = subBlocks(at + 2)
      blocks.push({ kind: 'extension' as const, label, start, end: at })
    } else if (bytes[at] === 0x2c) {
      const local = bytes[at + 9]
      at += 10 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0)
      at = subBlocks(at + 1)
      blocks.push({ kind: 'image' as const, label: '', start, end: at })
    } else return null
  }
  return blocks
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  for (let at = 2; at + 9 < bytes.length; ) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2
      continue
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) }
    at += 2 + u16be(bytes, at + 2)
  }
  return null
}

/** A raster image's format, size and whether it moves, read from its bytes; null for an SVG, an icon, a page, or anything else the card does not show. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 16) return null
  if (bytes[0] === 0x89 && tag(bytes, 1, 3) === 'PNG') {
    const chunks = pngChunks(bytes)
    const idat = chunks.findIndex((chunk) => chunk.type === 'IDAT')
    return { format: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20), animated: chunks.slice(0, idat === -1 ? undefined : idat).some((chunk) => chunk.type === 'acTL') }
  }
  if (tag(bytes, 0, 4) === 'GIF8') {
    const blocks = gifBlocks(bytes)
    if (blocks === null) return null
    return { format: 'gif', width: u16le(bytes, 6), height: u16le(bytes, 8), animated: blocks.filter((block) => block.kind === 'image').length > 1 }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(bytes)
    return size === null ? null : { format: 'jpg', ...size, animated: false }
  }
  if (tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'WEBP') {
    const [first] = webpChunks(bytes)
    if (first?.type === 'VP8X') return { format: 'webp', width: u24le(bytes, first.start + 4) + 1, height: u24le(bytes, first.start + 7) + 1, animated: (bytes[first.start] & 0x02) !== 0 }
    if (first?.type === 'VP8 ') return { format: 'webp', width: u16le(bytes, first.start + 6) & 0x3fff, height: u16le(bytes, first.start + 8) & 0x3fff, animated: false }
    if (first?.type === 'VP8L') {
      const bits = u32le(bytes, first.start + 1)
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false }
    }
  }
  return null
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * An animated image rewritten to play through once and hold its last frame,
 * since the screen is always on: a GIF without its loop extension, a WebP or
 * an APNG with its loop count one. A still image is answered as it is.
 */
export function playOnce(bytes: Uint8Array): Uint8Array {
  const info = imageInfo(bytes)
  if (info === null || !info.animated) return bytes
  if (info.format === 'gif') {
    const loops = (gifBlocks(bytes) ?? []).filter((block) => block.kind === 'extension' && (block.label === 'NETSCAPE2.0' || block.label === 'ANIMEXTS1.0'))
    const parts: Uint8Array[] = []
    let from = 0
    for (const loop of loops) {
      parts.push(bytes.subarray(from, loop.start))
      from = loop.end
    }
    parts.push(bytes.subarray(from))
    const once = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    parts.reduce((at, part) => (once.set(part, at), at + part.length), 0)
    return once
  }
  const once = bytes.slice()
  const view = new DataView(once.buffer)
  if (info.format === 'webp') {
    const anim = webpChunks(once).find((chunk) => chunk.type === 'ANIM')
    if (anim !== undefined) view.setUint16(anim.start + 4, 1, true)
    return once
  }
  const actl = pngChunks(once).find((chunk) => chunk.type === 'acTL')
  if (actl !== undefined) {
    view.setUint32(actl.start + 4, 1)
    view.setUint32(actl.end, crc32(once.subarray(actl.start - 4, actl.end)))
  }
  return once
}

const OG_IMAGE = new Set(['og:image', 'og:image:url', 'og:image:secure_url'])
const TWITTER_IMAGE = new Set(['twitter:image', 'twitter:image:src'])

/** The preview images a page's head names, in the order they are tried: its og:image ones, then its twitter:image ones, each resolved against the page; none when it names none. */
export function previewImages(head: string, page: string): string[] {
  const og: string[] = []
  const twitter: string[] = []
  for (const [meta] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attribute = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(meta)?.slice(1).find((value) => value !== undefined)
    const name = (attribute('property') ?? attribute('name') ?? '').toLowerCase()
    const content = attribute('content')
    if (content === undefined || !URL.canParse(decodeEntities(content.trim()), page)) continue
    const url = new URL(decodeEntities(content.trim()), page).href
    if (!/^https?:/.test(url)) continue
    if (OG_IMAGE.has(name)) og.push(url)
    else if (TWITTER_IMAGE.has(name)) twitter.push(url)
  }
  return [...new Set([...og, ...twitter])]
}

/** An address that is never a story's picture, whatever it answers: an SVG, an icon. */
function refusedByName(url: string): boolean {
  const path = URL.canParse(url) ? new URL(url).pathname.toLowerCase() : url
  return /\.(svg|ico)$/.test(path) || /favicon|apple-touch-icon/.test(path)
}

/** Whether a site has served this image for a story of another cluster: its logo or default banner, then, not the story's picture. */
function isSiteDefault(served: StoryImages['served'], site: string, url: string, cluster: string): boolean {
  return (served[site]?.[url] ?? []).some((other) => other !== cluster)
}

function noteServed(served: StoryImages['served'], site: string, urls: readonly string[], cluster: string): StoryImages['served'] {
  const urlsOf = { ...served[site] }
  for (const url of urls) if (!(urlsOf[url] ?? []).includes(cluster)) urlsOf[url] = [...(urlsOf[url] ?? []), cluster]
  return { ...served, [site]: urlsOf }
}

/** The first candidate that is a picture: downloaded, a raster image at least MIN_WIDTH wide, rewritten to play once. */
async function firstPicture(candidates: readonly string[], ports: StoryImagePorts): Promise<{ url: string; bytes: Uint8Array; format: ImageFormat } | null> {
  for (const url of candidates) {
    const bytes = await ports.fetchImage(url).catch(() => null)
    const info = bytes === null ? null : imageInfo(bytes)
    if (bytes === null || info === null || info.width < MIN_WIDTH) continue
    return { url, bytes: playOnce(bytes), format: info.format }
  }
  return null
}

/**
 * The cache with a picture for every shown story that needs one: a story
 * never asked about, or one left with the tile a day ago. A story already
 * holding a picture is not asked again. Its page is read only when the
 * source gave no image, or that image was no picture.
 */
export async function gatherStoryImages(images: StoryImages, stories: readonly ImageStory[], ports: StoryImagePorts, now: number): Promise<StoryImages> {
  const due = stories.filter((story) => {
    const held = images.stories[story.key]
    return held === undefined || (held.file === null && now - held.at >= IMAGE_RETRY_MS)
  })
  if (due.length === 0) return images
  const pageImages = async (story: ImageStory): Promise<string[]> => previewImages(await ports.fetchPage(story.link).catch(() => ''), story.link)
  // Every due story's candidates first, so a logo two of them share is known before either takes it.
  const candidates = await Promise.all(due.map(async (story) => (story.image !== null ? [story.image] : pageImages(story))))
  let served = images.served
  due.forEach((story, index) => (served = noteServed(served, hostOf(story.link), candidates[index], story.cluster)))
  const usable = (story: ImageStory, urls: readonly string[]): string[] => urls.filter((url) => !refusedByName(url) && !isSiteDefault(served, hostOf(story.link), url, story.cluster))
  const found = await Promise.all(
    due.map(async (story, index) => {
      const picture = await firstPicture(usable(story, candidates[index]), ports)
      if (picture !== null || story.image === null) return picture
      const more = await pageImages(story)
      served = noteServed(served, hostOf(story.link), more, story.cluster)
      return firstPicture(usable(story, more), ports)
    }),
  )
  const records = { ...images.stories }
  due.forEach((story, index) => {
    const picture = found[index]
    const held = { site: hostOf(story.link), cluster: story.cluster, at: now }
    records[story.key] = picture === null ? { ...held, file: null, url: null } : { ...held, file: ports.save(picture.bytes, picture.format), url: picture.url }
  })
  // A picture a site has since served for another story is its default: every story holding it falls back to the tile.
  for (const [key, record] of Object.entries(records)) {
    if (record.file === null || record.url === null || !isSiteDefault(served, record.site, record.url, record.cluster)) continue
    ports.remove(record.file)
    records[key] = { ...record, file: null, url: null, at: now }
  }
  return { stories: records, served }
}

/**
 * The cache with only the stories the story history still keeps — `keep`,
 * each key to its cluster — each dropped story's file removed, and the
 * images each site served counted only for clusters still kept.
 */
export function pruneStoryImages(images: StoryImages, keep: ReadonlyMap<string, string>, ports: Pick<StoryImagePorts, 'remove'>): StoryImages {
  const stories: StoryImages['stories'] = {}
  for (const [key, record] of Object.entries(images.stories)) {
    if (keep.has(key)) stories[key] = record
    else if (record.file !== null) ports.remove(record.file)
  }
  const clusters = new Set(keep.values())
  const served: StoryImages['served'] = {}
  for (const [site, urls] of Object.entries(images.served)) {
    const kept = Object.entries(urls)
      .map(([url, of]) => [url, of.filter((cluster) => clusters.has(cluster))] as const)
      .filter(([, of]) => of.length > 0)
    if (kept.length > 0) served[site] = Object.fromEntries(kept)
  }
  return { stories, served }
}
