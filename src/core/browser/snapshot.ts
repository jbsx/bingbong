import type { Cover, CoverProbe } from './actionOutcome'
import {
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
  className?: string
  /**
   * Where this element sat in the collect before this one, or -1 when this
   * collect is the first to see it (ADR 0033). DOM node identity across a
   * renumbering, reported by the collector because only the page holds the
   * nodes; absent in older payloads, read as -1.
   */
  previousIndex?: number
}

export interface CollectedViewport {
  width: number
  height: number
  scrollX?: number
  scrollY: number
  scrollHeight: number
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
}

export type RefKind = 'link' | 'button' | 'input' | 'media' | 'iframe'

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
}

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

function refKindOf(element: CollectedElement): RefKind {
  if (element.tag === 'iframe') return 'iframe'
  if (element.tag === 'video' || element.tag === 'audio') return 'media'
  if (element.tag === 'a' || element.tag === 'area' || element.role === 'link') return 'link'
  if (
    element.tag === 'button' ||
    element.role === 'button' ||
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
    default:
      return null
  }
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
      checked: nullableBoolean(el.checked),
      selectedOption: optionalString(el.selectedOption),
      value: typeof el.value === 'string' ? el.value : null,
      ariaPressed: optionalString(el.ariaPressed),
      className: typeof el.className === 'string' ? el.className : '',
      previousIndex: isFiniteNumber(el.previousIndex) ? el.previousIndex : -1,
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

function truncateLabel(label: string): string {
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

export function buildPageSnapshot(page: CollectedPage, options?: { maxRefs?: number }): PageSnapshot {
  const maxRefs = options?.maxRefs ?? MAX_SNAPSHOT_REFS
  // Dialog-layer elements bypass the viewport bound: the dialog is the page's
  // current interaction layer, and its controls may sit below the fold inside
  // the dialog's own scroller (the click path scrolls them into view).
  const visible = page.elements.filter(
    (element) => element.layer === 'dialog' || intersectsViewport(element, page.viewport),
  )
  const taken = visible.slice(0, maxRefs)

  return {
    url: page.url,
    title: page.title,
    viewport: page.viewport,
    dialogOpen: page.dialogOpen ?? false,
    dialogText: page.dialogText ?? '',
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
  return `[${ref.ref}] ${ref.kind}${subtype}${label}${src}${href}${state.length > 0 ? ` ${state.join(' ')}` : ''}${dialogMarker}`
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
 * of the text it showed (ADR 0047); one that fits carries none.
 */
export function formatPageSnapshot(snapshot: PageSnapshot): string {
  const lines = snapshotHead(snapshot)
  if (snapshot.textDigest) {
    lines.push('page text:', snapshot.textDigest)
    if (snapshot.textLength > snapshot.textDigest.length) {
      lines.push(previewFactLine(snapshot.textDigest.length, snapshot.textLength))
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
 * text in place of the preview. Part 1 starts at the top; a page of several
 * parts ends with the line naming this part and the next. A part the page
 * does not have throws the refusal read_page's admission step gives.
 */
export function formatPageRead(snapshot: PageSnapshot, part: number): string {
  const parts = splitPageRead(snapshot.textBlocks)
  if (!Number.isInteger(part) || part < 1 || part > parts.length) throw new Error(partPastTheEnd(part, parts.length))
  const lines = snapshotHead(snapshot)
  const text = parts[part - 1]!
  if (text !== '') lines.push('page text:', text)
  const partLine = pageReadPartLine(part, parts.length, snapshot.textCut)
  if (partLine !== null) lines.push(partLine)
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
