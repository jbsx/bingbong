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
  /** Risk facts, computed in-page (DOM-specific); absent in older payloads. */
  href?: string | null
  downloadsFile?: boolean
  submitsForm?: boolean
  credentialField?: boolean
  paymentField?: boolean
  inForm?: boolean
  formHasCredential?: boolean
  formHasPayment?: boolean
  /** 'dialog' marks elements of the page's topmost open dialog; absent in older payloads. */
  layer?: 'dialog' | 'page'
  checked?: boolean | null
  selectedOption?: string | null
  value?: string | null
  ariaPressed?: string | null
  className?: string
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
  textDigest?: string
  elements: CollectedElement[]
}

export type RefKind = 'link' | 'button' | 'input' | 'media'

// Facts the risk gate (core/pipeline/riskGate.ts) classifies from. All DOM
// heuristics (autocomplete tokens, name/id matching, form association) are
// folded into these flags by the in-page collector.
export interface SnapshotRef {
  ref: number
  kind: RefKind
  label: string
  inputType: string | null
  rect: CollectedRect
  href: string | null
  downloadsFile: boolean
  submitsForm: boolean
  credentialField: boolean
  paymentField: boolean
  inForm: boolean
  formHasCredential: boolean
  formHasPayment: boolean
  checked?: boolean | null
  selectedOption?: string | null
  value?: string | null
  ariaPressed?: string | null
  className?: string
}

export interface PageSnapshot {
  url: string
  title: string
  viewport: CollectedViewport
  dialogOpen: boolean
  textDigest: string
  refs: SnapshotRef[]
  totalVisible: number
  truncated: boolean
}

export const MAX_SNAPSHOT_REFS = 75
const MAX_LABEL_LENGTH = 80

const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image'])

function refKindOf(element: CollectedElement): RefKind {
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
      href: optionalString(el.href),
      downloadsFile: optionalBoolean(el.downloadsFile),
      submitsForm: optionalBoolean(el.submitsForm),
      credentialField: optionalBoolean(el.credentialField),
      paymentField: optionalBoolean(el.paymentField),
      inForm: optionalBoolean(el.inForm),
      formHasCredential: optionalBoolean(el.formHasCredential),
      formHasPayment: optionalBoolean(el.formHasPayment),
      layer: el.layer === 'dialog' || el.layer === 'page' ? el.layer : undefined,
      checked: nullableBoolean(el.checked),
      selectedOption: optionalString(el.selectedOption),
      value: typeof el.value === 'string' ? el.value : null,
      ariaPressed: optionalString(el.ariaPressed),
      className: typeof el.className === 'string' ? el.className : '',
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
    textDigest: typeof candidate.textDigest === 'string' ? candidate.textDigest : '',
    elements,
  }
}

function intersectsViewport(element: CollectedElement, viewport: CollectedViewport): boolean {
  if (element.rect.width < 1 || element.rect.height < 1) return false
  const { x, y, width, height } = element.rect
  return y + height > 0 && x + width > 0 && y < viewport.height && x < viewport.width
}

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label
  return `${label.slice(0, MAX_LABEL_LENGTH - 1)}…`
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
    textDigest: page.textDigest ?? '',
    refs: taken.map((element, index) => ({
      ref: index + 1,
      kind: refKindOf(element),
      label: truncateLabel(element.label),
      inputType: element.inputType,
      rect: element.rect,
      href: element.href ?? null,
      downloadsFile: element.downloadsFile ?? false,
      submitsForm: element.submitsForm ?? false,
      credentialField: element.credentialField ?? false,
      paymentField: element.paymentField ?? false,
      inForm: element.inForm ?? false,
      formHasCredential: element.formHasCredential ?? false,
      formHasPayment: element.formHasPayment ?? false,
      checked: element.checked ?? null,
      selectedOption: element.selectedOption ?? null,
      value: element.value ?? null,
      ariaPressed: element.ariaPressed ?? null,
      className: element.className ?? '',
    })),
    totalVisible: visible.length,
    truncated: visible.length > taken.length,
  }
}

export function formatPageSnapshot(snapshot: PageSnapshot): string {
  const lines = [
    `# ${snapshot.title} — ${snapshot.url}`,
    `viewport ${snapshot.viewport.width}x${snapshot.viewport.height} scroll ${snapshot.viewport.scrollY}/${snapshot.viewport.scrollHeight}`,
  ]
  for (const ref of snapshot.refs) {
    const subtype = ref.kind === 'input' && ref.inputType ? `[${ref.inputType}]` : ''
    const label = ref.label ? ` "${ref.label}"` : ''
    const state = [
      ...(typeof ref.checked === 'boolean' ? [`checked=${ref.checked}`] : []),
      ...(ref.selectedOption ? [`selected=${JSON.stringify(ref.selectedOption)}`] : []),
      ...(ref.value ? [`value=${JSON.stringify(ref.value)}`] : []),
      ...(ref.ariaPressed ? [`aria-pressed=${JSON.stringify(ref.ariaPressed)}`] : []),
    ]
    lines.push(`[${ref.ref}] ${ref.kind}${subtype}${label}${state.length > 0 ? ` ${state.join(' ')}` : ''}`)
  }
  if (snapshot.truncated) {
    lines.push(`(+${snapshot.totalVisible - snapshot.refs.length} more not listed)`)
  }
  if (snapshot.textDigest) lines.push('page text:', snapshot.textDigest)
  return lines.join('\n')
}

export function findSnapshotRef(snapshot: PageSnapshot, ref: number): SnapshotRef | undefined {
  return snapshot.refs.find((candidate) => candidate.ref === ref)
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
