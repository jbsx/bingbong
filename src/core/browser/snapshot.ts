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
  textDigest?: string
  /**
   * The page's text blocks that currently intersect the viewport, in
   * document order (#194). The digest above is the whole page's text,
   * capped from the top, so it barely moves when the page scrolls; this
   * is what a scroll actually brought into view.
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
  textDigest: string
  /** Text blocks intersecting the viewport when this snapshot was taken (#194). */
  viewportText: string[]
  refs: SnapshotRef[]
  totalVisible: number
  truncated: boolean
}

export const MAX_SNAPSHOT_REFS = 75

/** The text cap read_page's digest is collected under — the size any other
 * page text a tool result carries is held to as well (#194). */
export const MAX_SNAPSHOT_TEXT = 1800
const MAX_LABEL_LENGTH = 80
const MAX_HREF_LENGTH = 80

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
// gate; only the formatted line caps it, so a link-dense SERP stays within
// format bounds.
function truncateHref(href: string): string {
  return truncateText(href, MAX_HREF_LENGTH)
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
    textDigest: page.textDigest ?? '',
    viewportText: page.viewportText ?? [],
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

export function formatPageSnapshot(snapshot: PageSnapshot): string {
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
  if (snapshot.textDigest) lines.push('page text:', snapshot.textDigest)
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
