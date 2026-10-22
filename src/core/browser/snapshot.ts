import type { Cover, CoverProbe } from './actionOutcome'
import { regionStateOf } from './scrollOp'
import {
  emptyPageReadLine,
  pageReadPartLine,
  partPastTheEnd,
  previewFactLine,
  renderPageText,
  splitPageRead,
  type CollectedTextBlock,
} from './pageText'

export interface CollectedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CollectedElement {
  tag: string
  role: string | null
  inputType: string | null
  label: string
  rect: CollectedRect
  /** Absolute src of a cross-origin iframe (challenge widget); absent in older payloads. */
  src?: string | null
  /** Absolute link target; absent in older payloads. */
  href?: string | null
  /** Risk facts, computed in-page (DOM-specific); absent in older payloads. */
  downloadsFile?: boolean
  submitsForm?: boolean
  credentialField?: boolean
  paymentField?: boolean
  inForm?: boolean
  formHasCredential?: boolean
  formHasPayment?: boolean
  /** Search-flavored field (ADR 0015): type="search", or name/id/aria-label/
   * placeholder matching /search|query|^q$/i; absent in older payloads. */
  searchField?: boolean
  /** The associated form contains a search-flavored field; absent in older payloads. */
  formHasSearch?: boolean
  /** 'dialog' marks elements of the page's topmost open dialog; absent in older payloads. */
  layer?: 'dialog' | 'page'
  checked?: boolean | null
  selectedOption?: string | null
  value?: string | null
  ariaPressed?: string | null
  /** The Ref State the accessibility tree gave (refStates.ts); the controller adds it after the collect, for the elements that become refs. */
  states?: readonly string[]
  /** The label is the browser's accessible name (#382, ADR 0084), the page's own being empty; the controller sets it beside the states. */
  named?: true
  /** A video or audio element's own facts (#372); absent for every other element, and in older payloads. */
  media?: MediaFacts
  /** A Scroll Region's own facts (#383, ADR 0085): the collect sends them only for an element its scroll cue took. */
  region?: RegionFacts
  className?: string
  /**
   * Where this element sat in the collect before this one, or -1 when this
   * collect is the first to see it (ADR 0033). DOM node identity across a
   * renumbering, reported by the collector because only the page holds the
   * nodes; absent in older payloads, read as -1.
   */
  previousIndex?: number
  /**
   * An iframe's slot in its document's `window.frames` (#377, ADR 0081):
   * the identity a frame read on its own is paired with its iframe by,
   * since `frames` follows creation order, not the DOM's. -1 or absent for
   * every other element, and for an iframe whose window is gone.
   */
  frameIndex?: number
  /** An iframe's content-box origin in its document's viewport (#377): what a frame's own coordinates are offset by. */
  frameBox?: { x: number; y: number }
  /** The host of the frame this element was read in, without `www.` (#377); absent for the top document's own. */
  frameHost?: string
}

export interface CollectedViewport {
  width: number
  height: number
  scrollX?: number
  scrollY: number
  scrollHeight: number
}

/**
 * The page's media element as the collect reads it (#363, ADR 0079): the
 * one playing, else the first that has started — its title, where it is,
 * and the flags a right-click menu toggles that the DOM never shows.
 * `duration` is Infinity for a live stream.
 */
export interface PageMedia {
  readonly title: string
  readonly paused: boolean
  readonly currentTime: number
  readonly duration: number
  readonly loop: boolean
  readonly muted: boolean
}

/**
 * A media element's own facts (#372, ADR 0080): what its ref line carries
 * and what its Media Ops are gated by — never its state, only its ability
 * (a seekable range, text tracks). `duration` is Infinity for a live
 * stream, whose fractions a seek maps onto the seekable range.
 */
export interface MediaFacts {
  readonly paused: boolean
  readonly ended: boolean
  readonly currentTime: number
  readonly duration: number
  /** 0–1, as the element holds it. */
  readonly volume: number
  readonly muted: boolean
  readonly loop: boolean
  /** The playback rate; 1 is normal. */
  readonly rate: number
  /** The range a seek can reach; null when the element has none (nothing loaded, or a stream that allows no seek). */
  readonly seekable: { readonly start: number; readonly end: number } | null
  /** How many text tracks (captions, subtitles) the element has. */
  readonly tracks: number
  /** The language of the text track showing; null when none shows. */
  readonly captions: string | null
  /** Waiting for data while meant to play. */
  readonly buffering: boolean
  /** The element's load or decode failed. */
  readonly failed: boolean
}

/**
 * A Scroll Region's own facts (#383, ADR 0085), in CSS pixels: how far it
 * is scrolled (`scrollTop`), how tall its content is (`scrollHeight`) and
 * how tall its view (`clientHeight`). Its line's position and length, and
 * a Scroll Op's change, are read off these.
 */
export interface RegionFacts {
  readonly top: number
  readonly height: number
  readonly view: number
}

// Raw output of the in-page collector script: everything DOM-specific
// (labeling, rects, visibility) is done in the page; everything policy-ish
// (kind resolution, numbering, caps, formatting) happens here, fixture-tested.
export interface CollectedPage {
  url: string
  title: string
  viewport: CollectedViewport
  dialogOpen?: boolean
  /** Text of the topmost open dialog (Tier 2 facts for the model). */
  dialogText?: string
  /**
   * The page's text blocks in document order, raw (#235, ADR 0047): the
   * whole page's text, rendered and cut here. Absent in older payloads,
   * which carried the capped digest and the viewport text below instead.
   */
  textBlocks?: CollectedTextBlock[]
  /** The collector stopped taking blocks at MAX_COLLECTED_PAGE_TEXT: the page's text runs on past them. */
  textCut?: boolean
  /** Older payloads: the page's text, capped from the top. */
  textDigest?: string
  /**
   * Older payloads: the page's text blocks that intersected the viewport, in
   * document order (#194). A payload with `textBlocks` marks those in view
   * on the blocks themselves.
   */
  viewportText?: string[]
  elements: CollectedElement[]
  /** The playing media element (#363); absent or null when none has started. */
  media?: PageMedia | null
  /** A frame's own slot in its parent's `window.frames` (#377); -1 or absent for the top document. */
  frameIndex?: number
  /** The document's origin (#377): a script-written frame's is its parent's, where its address is only `about:blank`. */
  origin?: string
}

export type RefKind = 'link' | 'button' | 'input' | 'media' | 'iframe' | 'region'

// Facts the risk gate (core/pipeline/riskGate.ts) classifies from. All DOM
// heuristics (autocomplete tokens, name/id matching, form association) are
// folded into these flags by the in-page collector.
export interface SnapshotRef {
  ref: number
  kind: RefKind
  label: string
  inputType: string | null
  rect: CollectedRect
  /** Absolute src for iframe refs (cross-origin challenge widgets); null otherwise. */
  src: string | null
  /** Absolute link target for link refs; null otherwise. Never truncated here —
   * the risk gate reads it; only the formatted display truncates. */
  href: string | null
  downloadsFile: boolean
  submitsForm: boolean
  credentialField: boolean
  paymentField: boolean
  inForm: boolean
  formHasCredential: boolean
  formHasPayment: boolean
  /** Search-flavored field itself (ADR 0015); the Enter-submit exemption reads it. */
  searchField: boolean
  /** The associated form contains a search-flavored field; the click-submit exemption reads it. */
  formHasSearch: boolean
  checked?: boolean | null
  selectedOption?: string | null
  value?: string | null
  ariaPressed?: string | null
  /** The Ref State (refStates.ts): what the accessibility tree says of the element; absent when it said nothing. */
  states?: readonly string[]
  /** The label is the browser's accessible name (#382, ADR 0084): the page's own script reads this element's label as empty. */
  named?: true
  /** A media ref's own facts (#372, ADR 0080); absent for every other kind. */
  media?: MediaFacts
  /** A Scroll Region's own facts (#383, ADR 0085); absent for every other kind. */
  region?: RegionFacts
  /** The host of the frame the ref was read in (#377, ADR 0081); absent for the top document's own. */
  frame?: string
  className?: string
  /** 'dialog' marks a control of the topmost open dialog; 'page' otherwise. */
  layer?: 'dialog' | 'page'
  /** The element's position in the previous collect, -1 when it is new to
   * this one (ADR 0033). The scroll delta's identity. */
  previousIndex?: number
}

export interface PageSnapshot {
  url: string
  title: string
  viewport: CollectedViewport
  dialogOpen: boolean
  /** Text of the topmost open dialog, capped; '' when no dialog is open. */
  dialogText: string
  /**
   * The Page Preview (ADR 0047): the page's text from the top, capped at
   * MAX_SNAPSHOT_TEXT. What an Action Outcome carries, what the Blocker
   * classifier reads, and what the settled state fingerprints.
   */
  textDigest: string
  /** Every text block collected, in document order — what a Page Read cuts into parts. */
  textBlocks: string[]
  /** The length of the whole collected text, blocks joined by line breaks; the preview's is at most the cap. */
  textLength: number
  /** The page's text runs on past what was collected (MAX_COLLECTED_PAGE_TEXT). */
  textCut: boolean
  /** Text blocks intersecting the viewport when this snapshot was taken (#194). */
  viewportText: string[]
  refs: SnapshotRef[]
  totalVisible: number
  truncated: boolean
  /** The playing media element (#363); null, or absent in an older snapshot, when none has started. */
  media?: PageMedia | null
}

/**
 * One link of the whole page (#303, note on ADR 0070): its label, cut as a
 * ref's is, and its absolute href, whole. What a Result Pick's candidates
 * are made from, since the refs are the links in view.
 */
export interface PageLink {
  readonly label: string
  readonly href: string
}

/** How many links the in-page collector reports at most (#303): a bound on the payload, well past the candidates' own cut. */
export const MAX_COLLECTED_PAGE_LINKS = 1000

export const MAX_SNAPSHOT_REFS = 75

/** The Page Preview's cap (ADR 0047) — the size any page text an Action
 * Outcome carries is held to, a scroll's New In View included (#194). */
export const MAX_SNAPSHOT_TEXT = 1800
const MAX_LABEL_LENGTH = 80
/**
 * The printed href's cap (#258, ADR 0050): a result address is rarely over
 * 200 characters, and prompt tokens do not move latency, so a link the model
 * is shown is nearly always shown whole. The ref keeps the whole href
 * whatever its length — the risk gate and the Composed Address rail read it
 * there — and only the formatted line is cut.
 */
export const MAX_HREF_LENGTH = 200

const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image'])

/**
 * The ARIA widget roles a click acts on (#380): a menu row, a tab, a list
 * choice, a toggle, a tree row. Kinded as buttons, so none is offered a
 * type; `textbox`, `searchbox` and `combobox` stay inputs.
 */
const CLICK_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'checkbox', 'radio', 'switch', 'treeitem'])

export function refKindOf(element: CollectedElement): RefKind {
  if (element.tag === 'iframe') return 'iframe'
  if (element.tag === 'video' || element.tag === 'audio') return 'media'
  // The collect sends a region's facts only for an element its scroll cue took (#383, ADR 0085).
  if (element.region !== undefined) return 'region'
  // An anchor with no address and a button's role goes nowhere (#381): an Unmarked Control <a onclick> is a button.
  const addressless = element.href === null && element.role === 'button'
  if (((element.tag === 'a' || element.tag === 'area') && !addressless) || element.role === 'link') return 'link'
  if (
    element.tag === 'button' ||
    element.role === 'button' ||
    (element.role !== null && CLICK_ROLES.has(element.role)) ||
    (element.tag === 'input' && element.inputType !== null && BUTTON_INPUT_TYPES.has(element.inputType))
  ) {
    return 'button'
  }
  return 'input'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function optionalBoolean(value: unknown): boolean {
  return value === true
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** One collected text block, or null for an entry of no known shape — dropped, not fatal. */
function parseTextBlock(entry: unknown): CollectedTextBlock | null {
  if (typeof entry !== 'object' || entry === null) return null
  const block = entry as Record<string, unknown>
  const inView = block.inView === true ? { inView: true } : {}
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  switch (block.kind) {
    case 'text':
      if (typeof block.text !== 'string') return null
      return { kind: 'text', text: block.text, ...(block.heading === true ? { heading: true } : {}), ...inView }
    case 'pre':
      return typeof block.text === 'string' ? { kind: 'pre', text: block.text, ...inView } : null
    case 'row':
      return Array.isArray(block.cells) ? { kind: 'row', cells: block.cells.map(text), ...inView } : null
    case 'definitions':
      if (!Array.isArray(block.items)) return null
      return {
        kind: 'definitions',
        items: block.items.flatMap((item: unknown) => {
          if (typeof item !== 'object' || item === null) return []
          const { term, text: value } = item as Record<string, unknown>
          return typeof value === 'string' ? [{ term: term === true, text: value }] : []
        }),
        ...inView,
      }
    case 'frame':
      return isFiniteNumber(block.slot) ? { kind: 'frame', slot: block.slot } : null
    default:
      return null
  }
}

/** A media element's facts as the page sends them (#372) — the collect's, or a Media Op's before and after — or undefined for none or ones that do not read as such; a null duration is a live stream's Infinity. */
export function parseMediaFacts(raw: unknown): MediaFacts | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const facts = raw as Record<string, unknown>
  const duration = facts.duration === null ? Infinity : facts.duration
  const flags = ['paused', 'ended', 'muted', 'loop', 'buffering', 'failed'] as const
  if (!flags.every((flag) => typeof facts[flag] === 'boolean')) return undefined
  if (!isFiniteNumber(facts.currentTime) || !isFiniteNumber(facts.volume) || !isFiniteNumber(facts.rate) || typeof duration !== 'number' || Number.isNaN(duration)) return undefined
  if (!isFiniteNumber(facts.tracks) || (facts.captions !== null && typeof facts.captions !== 'string')) return undefined
  const range = facts.seekable
  const seekable = typeof range === 'object' && range !== null && isFiniteNumber((range as Record<string, unknown>).start) && isFiniteNumber((range as Record<string, unknown>).end) ? (range as { start: number; end: number }) : null
  return {
    paused: facts.paused as boolean,
    ended: facts.ended as boolean,
    currentTime: facts.currentTime,
    duration,
    volume: facts.volume,
    muted: facts.muted as boolean,
    loop: facts.loop as boolean,
    rate: facts.rate,
    seekable: seekable === null ? null : { start: seekable.start, end: seekable.end },
    tracks: facts.tracks,
    captions: facts.captions as string | null,
    buffering: facts.buffering as boolean,
    failed: facts.failed as boolean,
  }
}

/** A collected media element, or null for none or one that does not read as one; a null duration is a live stream's Infinity. */
function parseMedia(raw: unknown): PageMedia | null {
  if (typeof raw !== 'object' || raw === null) return null
  const media = raw as Record<string, unknown>
  const duration = media.duration === null ? Infinity : media.duration
  if (typeof media.title !== 'string' || typeof media.paused !== 'boolean' || typeof media.loop !== 'boolean' || typeof media.muted !== 'boolean') return null
  if (!isFiniteNumber(media.currentTime) || typeof duration !== 'number' || Number.isNaN(duration)) return null
  return { title: media.title, paused: media.paused, currentTime: media.currentTime, duration, loop: media.loop, muted: media.muted }
}

/** A Scroll Region's facts as the page sends them (#383) — the collect's, or a Scroll Op's before and after — or undefined for none or ones that do not read as such. */
export function parseRegionFacts(raw: unknown): RegionFacts | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { top, height, view } = raw as Record<string, unknown>
  return isFiniteNumber(top) && isFiniteNumber(height) && isFiniteNumber(view) && view > 0 ? { top, height, view } : undefined
}

/** The `media` entry of a collected element: its facts when it sent any that read, nothing otherwise. */
function mediaFactsEntry(raw: unknown): { media: MediaFacts } | Record<string, never> {
  const media = parseMediaFacts(raw)
  return media !== undefined ? { media } : {}
}

/** The `region` entry of a collected element (#383): its facts when it sent any that read, nothing otherwise. */
function regionFactsEntry(raw: unknown): { region: RegionFacts } | Record<string, never> {
  const region = parseRegionFacts(raw)
  return region !== undefined ? { region } : {}
}

function frameBoxEntry(raw: unknown): { frameBox: { x: number; y: number } } | Record<string, never> {
  if (typeof raw !== 'object' || raw === null) return {}
  const { x, y } = raw as Record<string, unknown>
  return isFiniteNumber(x) && isFiniteNumber(y) ? { frameBox: { x, y } } : {}
}

export function parseCollectedPage(raw: unknown): CollectedPage {
  const malformed = () => new Error('collected page payload malformed')

  if (typeof raw !== 'object' || raw === null) throw malformed()
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.url !== 'string' || typeof candidate.title !== 'string') throw malformed()

  const viewport = candidate.viewport
  if (
    typeof viewport !== 'object' ||
    viewport === null ||
    !['width', 'height', 'scrollY', 'scrollHeight'].every((key) => isFiniteNumber((viewport as Record<string, unknown>)[key]))
  ) {
    throw malformed()
  }

  if (!Array.isArray(candidate.elements)) throw malformed()
  const elements: CollectedElement[] = candidate.elements.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw malformed()
    const el = entry as Record<string, unknown>
    if (typeof el.tag !== 'string' || typeof el.label !== 'string') throw malformed()
    if (el.role !== null && typeof el.role !== 'string') throw malformed()
    if (el.inputType !== null && typeof el.inputType !== 'string') throw malformed()
    const rect = el.rect
    if (typeof rect !== 'object' || rect === null || !['x', 'y', 'width', 'height'].every((key) => isFiniteNumber((rect as Record<string, unknown>)[key]))) {
      throw malformed()
    }
    return {
      tag: el.tag,
      role: el.role as string | null,
      inputType: el.inputType as string | null,
      label: el.label,
      rect: rect as CollectedRect,
      src: optionalString(el.src),
      href: optionalString(el.href),
      downloadsFile: optionalBoolean(el.downloadsFile),
      submitsForm: optionalBoolean(el.submitsForm),
      credentialField: optionalBoolean(el.credentialField),
      paymentField: optionalBoolean(el.paymentField),
      inForm: optionalBoolean(el.inForm),
      formHasCredential: optionalBoolean(el.formHasCredential),
      formHasPayment: optionalBoolean(el.formHasPayment),
      searchField: optionalBoolean(el.searchField),
      formHasSearch: optionalBoolean(el.formHasSearch),
      layer: el.layer === 'dialog' || el.layer === 'page' ? el.layer : undefined,
      ...mediaFactsEntry(el.media),
      ...regionFactsEntry(el.region),
      checked: nullableBoolean(el.checked),
      selectedOption: optionalString(el.selectedOption),
      value: typeof el.value === 'string' ? el.value : null,
      ariaPressed: optionalString(el.ariaPressed),
      className: typeof el.className === 'string' ? el.className : '',
      previousIndex: isFiniteNumber(el.previousIndex) ? el.previousIndex : -1,
      ...(isFiniteNumber(el.frameIndex) && el.frameIndex >= 0 ? { frameIndex: el.frameIndex } : {}),
      ...frameBoxEntry(el.frameBox),
    }
  })

  const parsedViewport = viewport as Record<string, unknown>

  return {
    url: candidate.url,
    title: candidate.title,
    viewport: {
      width: parsedViewport.width as number,
      height: parsedViewport.height as number,
      scrollX: isFiniteNumber(parsedViewport.scrollX) ? parsedViewport.scrollX : 0,
      scrollY: parsedViewport.scrollY as number,
      scrollHeight: parsedViewport.scrollHeight as number,
    },
    dialogOpen: candidate.dialogOpen === true,
    dialogText: typeof candidate.dialogText === 'string' ? candidate.dialogText : '',
    ...(Array.isArray(candidate.textBlocks)
      ? { textBlocks: candidate.textBlocks.flatMap((entry) => parseTextBlock(entry) ?? []), textCut: candidate.textCut === true }
      : {}),
    textDigest: typeof candidate.textDigest === 'string' ? candidate.textDigest : '',
    viewportText: Array.isArray(candidate.viewportText)
      ? candidate.viewportText.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
      : [],
    elements,
    media: parseMedia(candidate.media),
    ...(isFiniteNumber(candidate.frameIndex) ? { frameIndex: candidate.frameIndex } : {}),
    ...(typeof candidate.origin === 'string' ? { origin: candidate.origin } : {}),
  }
}

function intersectsViewport(element: CollectedElement, viewport: CollectedViewport): boolean {
  if (element.rect.width < 1 || element.rect.height < 1) return false
  const { x, y, width, height } = element.rect
  return y + height > 0 && x + width > 0 && y < viewport.height && x < viewport.width
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

export function truncateLabel(label: string): string {
  return truncateText(label, MAX_LABEL_LENGTH)
}

// Display-only truncation (#77): the ref keeps the full href for the risk
// gate and the Composed Address rail; only the formatted line caps it, so a
// link-dense SERP stays within format bounds.
function truncateHref(href: string): string {
  return truncateText(href, MAX_HREF_LENGTH)
}

/**
 * Every link ref's whole href, in ref order (#258, ADR 0050): what the
 * Composed Address rail offers from a page, because the printed ref line
 * cuts an href over {@link MAX_HREF_LENGTH}. A ref without an href is no
 * address and is left out.
 */
export function linkHrefsOf(snapshot: PageSnapshot): string[] {
  return snapshot.refs.flatMap((ref) => (ref.href === null ? [] : [ref.href]))
}

/**
 * The page's links as the in-page collector reported them (#303), in
 * document order: labels cut as a ref's are, hrefs whole. An entry of no
 * known shape is dropped, not fatal; a payload that is no list is malformed.
 */
export function parsePageLinks(raw: unknown): PageLink[] {
  if (!Array.isArray(raw)) throw new Error('page links payload malformed')
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { label, href } = entry as Record<string, unknown>
    return typeof href === 'string' && href !== '' ? [{ label: truncateLabel(typeof label === 'string' ? label : ''), href }] : []
  })
}

/** A collected page's text: its blocks, the preview, the whole length, and what is in view. */
function pageTextOf(page: CollectedPage): Pick<PageSnapshot, 'textBlocks' | 'textDigest' | 'textLength' | 'textCut' | 'viewportText'> {
  if (page.textBlocks !== undefined) {
    const { blocks, viewportText } = renderPageText(page.textBlocks)
    const whole = blocks.join('\n')
    return {
      textBlocks: blocks,
      textDigest: whole.slice(0, MAX_SNAPSHOT_TEXT),
      textLength: whole.length,
      textCut: page.textCut === true,
      viewportText,
    }
  }
  // An older payload sent only the capped digest: it is all the text there is.
  const digest = page.textDigest ?? ''
  return {
    textBlocks: digest === '' ? [] : digest.split('\n'),
    textDigest: digest,
    textLength: digest.length,
    textCut: false,
    viewportText: page.viewportText ?? [],
  }
}

// Dialog-layer elements bypass the viewport bound: the dialog is the page's
// current interaction layer, and its controls may sit below the fold inside
// the dialog's own scroller (the click path scrolls them into view).
function isVisible(element: CollectedElement, page: CollectedPage): boolean {
  return element.layer === 'dialog' || intersectsViewport(element, page.viewport)
}

/** The collected elements that become refs, by their index in the collect — the page registry's index. */
export function refElementIndices(page: CollectedPage, options?: { maxRefs?: number }): number[] {
  const indices = page.elements.flatMap((element, index) => (isVisible(element, page) ? [index] : []))
  return indices.slice(0, options?.maxRefs ?? MAX_SNAPSHOT_REFS)
}

export function buildPageSnapshot(page: CollectedPage, options?: { maxRefs?: number }): PageSnapshot {
  const visible = page.elements.filter((element) => isVisible(element, page))
  // The same elements the controller read Ref States for (readRefStates.ts): one rule picks both.
  const taken = refElementIndices(page, options).map((index) => page.elements[index])

  return {
    url: page.url,
    title: page.title,
    viewport: page.viewport,
    dialogOpen: page.dialogOpen ?? false,
    dialogText: page.dialogText ?? '',
    media: page.media ?? null,
    ...pageTextOf(page),
    refs: taken.map((element, index) => ({
      ref: index + 1,
      kind: refKindOf(element),
      label: truncateLabel(element.label),
      inputType: element.inputType,
      rect: element.rect,
      src: element.src ? truncateLabel(element.src) : null,
      href: element.href ?? null,
      downloadsFile: element.downloadsFile ?? false,
      submitsForm: element.submitsForm ?? false,
      credentialField: element.credentialField ?? false,
      paymentField: element.paymentField ?? false,
      inForm: element.inForm ?? false,
      formHasCredential: element.formHasCredential ?? false,
      formHasPayment: element.formHasPayment ?? false,
      searchField: element.searchField ?? false,
      formHasSearch: element.formHasSearch ?? false,
      checked: element.checked ?? null,
      selectedOption: element.selectedOption ?? null,
      value: element.value ?? null,
      ariaPressed: element.ariaPressed ?? null,
      className: element.className ?? '',
      ...(element.states !== undefined && element.states.length > 0 ? { states: element.states } : {}),
      ...(element.named === true ? { named: true as const } : {}),
      ...(element.media !== undefined ? { media: element.media } : {}),
      ...(element.region !== undefined ? { region: element.region } : {}),
      ...(element.frameHost !== undefined ? { frame: element.frameHost } : {}),
      layer: element.layer ?? 'page',
      previousIndex: element.previousIndex ?? -1,
    })),
    totalVisible: visible.length,
    truncated: visible.length > taken.length,
  }
}

const MAX_DIALOG_TEXT = 200

/** One numbered ref as the model reads it — the same line whether it arrives
 * in a whole page read or in a scroll's `new in view` block (#194). */
export function formatRefLine(ref: SnapshotRef): string {
  const subtype = ref.kind === 'input' && ref.inputType ? `[${ref.inputType}]` : ''
  const label = ref.label ? ` "${ref.label}"` : ''
  const src = ref.src ? ` src=${JSON.stringify(ref.src)}` : ''
  const href = ref.href ? ` href=${JSON.stringify(truncateHref(ref.href))}` : ''
  const state = [
    ...(typeof ref.checked === 'boolean' ? [`checked=${ref.checked}`] : []),
    ...(ref.selectedOption ? [`selected=${JSON.stringify(ref.selectedOption)}`] : []),
    ...(ref.value ? [`value=${JSON.stringify(ref.value)}`] : []),
    ...(ref.ariaPressed ? [`aria-pressed=${JSON.stringify(ref.ariaPressed)}`] : []),
  ]
  const dialogMarker = ref.layer === 'dialog' ? ' (dialog)' : ''
  const frame = ref.frame !== undefined ? ` in ${ref.frame}` : ''
  // A Scroll Region's position and length (#383, ADR 0085), as the action card's line carries them.
  const region = ref.region !== undefined ? ` ${regionStateOf(ref.region)}` : ''
  return `[${ref.ref}] ${ref.kind}${subtype}${label}${frame}${region}${src}${href}${state.length > 0 ? ` ${state.join(' ')}` : ''}${dialogMarker}`
}

/** How many contained refs a labelled or unlabelled Cover names (ADR 0062). */
export const MAX_COVER_REFS = 3

/**
 * A Cover probe named as a page read names refs (ADR 0062), against the refs
 * the outcome's numbers belong to: a number they do not list names nothing,
 * so it is dropped, and a ref cover they do not list falls back to a bare element.
 */
export function coverOf(probe: CoverProbe, refs: readonly SnapshotRef[]): Cover {
  const lineOf = (ref: number): string | null => {
    const listed = refs.find((candidate) => candidate.ref === ref)
    return listed === undefined ? null : formatRefLine(listed)
  }
  if ('ref' in probe) {
    const line = lineOf(probe.ref)
    return line === null ? { kind: 'unlabelled', tag: 'element', contains: [] } : { kind: 'ref', line }
  }
  const contains = probe.contains.map(lineOf).filter((line): line is string => line !== null).slice(0, MAX_COVER_REFS)
  return 'role' in probe ? { kind: 'labelled', role: probe.role, name: probe.name, contains } : { kind: 'unlabelled', tag: probe.tag, contains }
}

/** Everything a formatted snapshot says above its page text. */
function snapshotHead(snapshot: PageSnapshot): string[] {
  const lines = [
    `# ${snapshot.title} — ${snapshot.url}`,
    // Zoomed pages (#53) scroll on fractional CSS pixels; the header line
    // keeps its integer-pixel contract.
    `viewport ${snapshot.viewport.width}x${snapshot.viewport.height} scroll ${Math.round(snapshot.viewport.scrollY)}/${Math.round(snapshot.viewport.scrollHeight)}`,
    `signature ${pageSignature(snapshot)}`,
  ]
  if (snapshot.dialogOpen) {
    const text = truncateText(snapshot.dialogText, MAX_DIALOG_TEXT)
    lines.push(`dialog open: ${JSON.stringify(text)}`)
  }
  for (const ref of snapshot.refs) lines.push(formatRefLine(ref))
  if (snapshot.truncated) {
    lines.push(`(+${snapshot.totalVisible - snapshot.refs.length} more not listed)`)
  }
  return lines
}

/**
 * The settled page as an Action Outcome carries it: refs and the Page
 * Preview. A preview that was cut ends with the fact line naming how much
 * of the text it showed (ADR 0047) and how many parts a read of it comes in
 * (#290); one that fits carries none.
 */
export function formatPageSnapshot(snapshot: PageSnapshot): string {
  const lines = snapshotHead(snapshot)
  if (snapshot.textDigest) {
    lines.push('page text:', snapshot.textDigest)
    if (snapshot.textLength > snapshot.textDigest.length) {
      lines.push(previewFactLine(snapshot.textDigest.length, snapshot.textLength, pageReadPartCount(snapshot)))
    }
  }
  return lines.join('\n')
}

/** How many parts a Page Read of this snapshot's text takes — at least one. */
export function pageReadPartCount(snapshot: PageSnapshot): number {
  return splitPageRead(snapshot.textBlocks).length
}

/**
 * A Page Read (ADR 0047): the snapshot with one part of the page's whole
 * text in place of the preview. Part 1 starts at the top; every read ends
 * with the line naming this part and how many there are (#290), a one-part
 * page included, and a page with no text says it has none. A part the page
 * does not have throws the refusal read_page's admission step gives.
 */
export function formatPageRead(snapshot: PageSnapshot, part: number): string {
  const parts = splitPageRead(snapshot.textBlocks)
  if (!Number.isInteger(part) || part < 1 || part > parts.length) throw new Error(partPastTheEnd(part, parts.length))
  const lines = snapshotHead(snapshot)
  const text = parts[part - 1]!
  if (text !== '') lines.push('page text:', text)
  lines.push(text === '' && parts.length === 1 ? emptyPageReadLine() : pageReadPartLine(part, parts.length, snapshot.textCut))
  return lines.join('\n')
}

export function findSnapshotRef(snapshot: PageSnapshot, ref: number): SnapshotRef | undefined {
  return snapshot.refs.find((candidate) => candidate.ref === ref)
}

/** FNV-1a, 8 hex characters: the compact deterministic hash behind page
 * signatures (#113) and the Progress fingerprints (#125). */
export function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// ADR 0027 Action Outcomes: a compact fingerprint of one settled page
// state — url, title, scroll, dialog, and the interactive-ref identity —
// hashed FNV-1a into 8 hex characters. Identical states hash identically,
// so the model (and later Progress rails, #125) can compare `signature`
// lines across tool outcomes instead of re-reading the page to tell "same
// state" from "new state".
export function pageSignature(snapshot: PageSnapshot): string {
  const identity = [
    snapshot.url,
    snapshot.title,
    Math.round(snapshot.viewport.scrollX ?? 0),
    Math.round(snapshot.viewport.scrollY),
    snapshot.dialogOpen ? `dialog:${snapshot.dialogText}` : '',
    snapshot.refs.length,
    snapshot.totalVisible,
    ...(snapshot.truncated ? ['+truncated'] : []),
    ...snapshot.refs.map((ref) => `${ref.kind}\u0000${ref.label}\u0000${ref.href ?? ''}`),
  ].join('\u0001')
  return fnv1a32(identity)
}

// Click coordinates: the element center, clamped into the part of the element
// that is actually inside the viewport (CDP drops clicks outside it).
export function clickPoint(
  ref: SnapshotRef,
  viewport: CollectedViewport,
): { x: number; y: number } {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
  const { rect } = ref
  const visibleLeft = Math.max(rect.x, 0)
  const visibleRight = Math.min(rect.x + rect.width, viewport.width)
  const visibleTop = Math.max(rect.y, 0)
  const visibleBottom = Math.min(rect.y + rect.height, viewport.height)
  return {
    x: Math.round(clamp(rect.x + rect.width / 2, visibleLeft, Math.max(visibleLeft, visibleRight - 1))),
    y: Math.round(clamp(rect.y + rect.height / 2, visibleTop, Math.max(visibleTop, visibleBottom - 1))),
  }
}
