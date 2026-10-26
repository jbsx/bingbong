import type { TextBelow } from '../browser/pageText'
import type { CommandRef } from './command'

// A Capture Op (#466, ADR 0095, CONTEXT.md "Capture"): what a ref of a
// capturing kind carries on the action card because of its kind, the way a
// media ref carries its Media Ops (ADR 0080): `capture-N`. A link is
// captured by its address, an image by its bytes, a block of text by its
// text; `capture-page` takes the page itself, its address under its title.
// A control — a button, a field, a menu item — is no capturing kind: its
// label is noise on the card. Each capture is one evaluate on any site,
// never per site; what it read goes to a file on the Shelf
// (`bingbong_downloads`) and to the OS clipboard, always both.

/** The words a card line quotes of what it takes: the first 80 characters, as a Show Op quotes its block. */
const quoted = (text: string): string => JSON.stringify(text.slice(0, 80))

/** A ref's Capture Op on the action card (#466): `copy the link [12] "Pricing" (its address) to the Shelf and the clipboard`. */
export function captureRefLine(kind: 'link' | 'image', ref: number, label: string): string {
  return kind === 'link' ? `copy the link [${ref}] ${quoted(label)} (its address) to the Shelf and the clipboard` : `copy the image [${ref}] ${quoted(label)} to the Shelf and the clipboard`
}

/** A block's Capture Op (#466): by its `[text-N]` entry off the view, or quoted from the Text in view line. */
export function captureTextLine(block: TextBelow, n?: number): string {
  const which = n !== undefined ? `[text-${n}] ${block.kind !== undefined ? `${block.kind} ` : ''}` : 'in view '
  return `copy the text ${which}${quoted(block.text)} to the Shelf and the clipboard`
}

/** The page's own Capture Op (#466): its address, its title on the first line. */
export const CAPTURE_PAGE_LINE = "copy this page's address (its link) and title to the Shelf and the clipboard"

/** What a capture took: a link's address, a block's text, an image's bytes, or the page's address and title. */
export type CaptureKind = 'link' | 'text' | 'image' | 'page'

/**
 * A Capture Op as a Command carries it (#466): what it takes; for a block
 * of text, the block — the ref, when there is one, is the Command's
 * target; `named`, what the card called it, which names the file.
 */
export interface CaptureAction {
  readonly kind: CaptureKind
  readonly block?: TextBelow
  readonly named: string
}

/** A capture as the Feed and "Done so far" name it: `copy the link "Pricing" to the Shelf and the clipboard`. */
export function describeCapture(capture: CaptureAction): string {
  const what = capture.kind === 'page' ? 'this page' : `the ${capture.kind} ${JSON.stringify(capture.named.length <= 80 ? capture.named : `${capture.named.slice(0, 79).trimEnd()}…`)}`
  return `copy ${what} to the Shelf and the clipboard`
}

/** The kind of capture a ref carries (#466): a link with an address, or an image; null for every control. */
export function captureKindOf(ref: CommandRef): 'link' | 'image' | null {
  if (ref.kind === 'image') return 'image'
  return ref.kind === 'link' && ref.href !== null ? 'link' : null
}

/** A ref's capture (#466): a link's or an image's, named by its label, a link with no words by its address; null for a control. */
export function captureOfRef(ref: CommandRef): CaptureAction | null {
  const kind = captureKindOf(ref)
  return kind === null ? null : { kind, named: ref.label !== '' ? ref.label : (ref.href ?? '') }
}

/** What a card label names to capture: a ref by its number, a block off the view by its `[text-N]`, a block in view by its place, or the page. */
export type CaptureLabel = { readonly of: 'ref' | 'text' | 'view'; readonly n: number } | { readonly of: 'page' }

/** The capture a card label names; null for any other label. */
export function captureLabelOf(label: string): CaptureLabel | null {
  if (label === 'capture-page') return { of: 'page' }
  const match = /^capture-(?:(text|view)-)?(\d+)$/.exec(label)
  if (match === null) return null
  return { of: (match[1] as 'text' | 'view' | undefined) ?? 'ref', n: Number(match[2]) }
}

/** How many words of what was captured name its file. */
const SLUG_WORDS = 8

/** Two digits. */
const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * A capture's file name on the Shelf (#466): `capture-<yyyymmdd-hhmmss>-<slug>.<ext>`,
 * the local time it was taken and the first words of what it took — a
 * page's title, a link's or an image's label, a block's text — lower case;
 * the time alone when those carry no words.
 */
export function captureFileName(at: Date, words: string, ext: string): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  const slug = words
    .toLowerCase()
    // A page title's " - Site" tail names the site, not the thing.
    .replace(/\s+[-–—|]\s+[^-–—|]*$/, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .slice(0, SLUG_WORDS)
    .join('-')
  return `capture-${stamp}${slug !== '' ? `-${slug}` : ''}.${ext}`
}

/** What the page's own fetch of an image brought back (#466): its bytes in base64 and its type, or nothing when the fetch failed; its address, always. */
export interface ImageFetch {
  readonly src: string
  readonly data?: string
  readonly type?: string
  /** The image drawn as a PNG, in base64, when its own type is no PNG or JPEG: what the clipboard can take. */
  readonly png?: string
}

/** An image as the Shelf keeps it: its bytes, its extension, and whether they are the image's own or a screenshot of its box. */
export interface CapturedImage {
  readonly bytes: Uint8Array
  readonly ext: string
  readonly via: 'fetch' | 'screenshot'
  /** A PNG of it for the clipboard, when its own type is one the clipboard cannot decode. */
  readonly png?: Uint8Array
}

/** The extensions an image's type names, beyond its own subtype. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = { jpeg: 'jpg', 'svg+xml': 'svg', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico' }

/** An image's extension: off its type, else off its address; none when neither names one. */
function imageExtension(type: string, src: string): string | null {
  const subtype = /^image\/([\w.+-]+)/i.exec(type)?.[1]?.toLowerCase()
  if (subtype !== undefined) return IMAGE_EXTENSIONS[subtype] ?? subtype
  const fromPath = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.exec(src.split(/[?#]/)[0] ?? '')?.[1]?.toLowerCase()
  return fromPath === undefined ? null : fromPath === 'jpeg' ? 'jpg' : fromPath
}

/** Base64 to bytes. */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * An image capture (#466): the bytes the page's own fetch of its address
 * brought back, kept with the extension its type names; when that fetch
 * failed (a cross-origin image the page may show but not read) or brought
 * back no image, a JPEG screenshot of the image's box, `clip`.
 */
export async function captureImage(fetched: ImageFetch, clip: () => Promise<Uint8Array>): Promise<CapturedImage> {
  const typed = fetched.type ?? ''
  const ext = fetched.data !== undefined && fetched.data !== '' && (typed === '' || /^image\//i.test(typed)) ? imageExtension(typed, fetched.src) : null
  if (ext !== null && fetched.data !== undefined) return { bytes: bytesOf(fetched.data), ext, via: 'fetch', ...(fetched.png !== undefined && fetched.png !== '' ? { png: bytesOf(fetched.png) } : {}) }
  return { bytes: await clip(), ext: 'jpg', via: 'screenshot' }
}

/** A capture's Answer (#466): one sentence, said and shown — "Copied the link to the Shelf." */
export function captureAnswer(kind: CaptureKind): string {
  return `Copied the ${kind} to the Shelf.`
}
