// A ref's Ref State (CONTEXT.md): what the browser's accessibility tree says
// about the element — the tree a screen reader reads, so every state the
// page declares, natively or by ARIA, without a list of our own picking
// which matter (owner rule: the widest net). A label alone can lie: YouTube's
// captions button keeps "unavailable" in its name while it is pressed.

import { truncateLabel, type RefKind } from './snapshot'

/** One property of a CDP `Accessibility.AXNode`, as the protocol sends it. */
export interface AxProperty {
  readonly name: string
  readonly value: { readonly type: string; readonly value?: unknown }
}

/** The part of a CDP `Accessibility.AXNode` a Ref State is read from. */
export interface AxNode {
  readonly ignored?: boolean
  readonly role?: { readonly type: string; readonly value?: unknown }
  readonly name?: { readonly type: string; readonly value?: unknown }
  readonly description?: { readonly type: string; readonly value?: unknown }
  /** A slider's or a field's current value. */
  readonly value?: { readonly type: string; readonly value?: unknown }
  readonly properties?: readonly AxProperty[]
}

/** What the ref already says of itself, so its states don't repeat it. */
export interface RefShown {
  readonly kind: RefKind
  readonly label: string
  readonly inputType: string | null
}

/**
 * Properties that say nothing the ref line does not: nearly every control
 * is focusable, a link's url is its address, and the rest are the tree's
 * own bookkeeping.
 */
const UNTOLD = new Set(['focusable', 'settable', 'hiddenRoot', 'root', 'url'])

/** The properties whose `false` is news: a switch that is off, a menu that is shut. */
const TOGGLES = new Set(['pressed', 'checked', 'expanded', 'selected'])

/** Values that point at other nodes: no words a reader could use. */
const RELATIONS = new Set(['idref', 'idrefList', 'node', 'nodeList'])

/** The roles a text field of any input type takes: an `input[email]` ref already says it. */
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox'])

/** The tree's roles that name no role at all. */
const NO_ROLE = new Set(['generic', 'none', 'presentation'])

/** Whether the tree's role is what the ref's kind already says: a button's `button`, a video ref's `Video`. */
function roleRestates(role: string, shown: RefShown): boolean {
  const said = role.toLowerCase()
  if (NO_ROLE.has(said) || said === shown.kind || said === shown.inputType) return true
  if (shown.kind === 'input') return FIELD_ROLES.has(said)
  if (shown.kind === 'media') return said === 'video' || said === 'audio'
  return false
}

const collapsed = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The tree's description (a tooltip, an `aria-describedby`) or current value
 * (a slider's, a field's), named when it holds words the label lacks.
 */
function wordsOf(name: 'description' | 'value', node: AxNode, shown: RefShown): string | null {
  const raw = node[name]?.value
  if (typeof raw === 'number') return `${name}=${raw}`
  const said = typeof raw === 'string' ? collapsed(raw) : ''
  return said === '' || collapsed(shown.label).toLowerCase().includes(said.toLowerCase()) ? null : `${name}=${JSON.stringify(truncateLabel(said))}`
}

function stateOf(property: AxProperty, shown: RefShown): string | null {
  const { name, value } = property
  if (UNTOLD.has(name) || RELATIONS.has(value.type) || value.value === undefined || value.value === '') return null
  // A text field is editable by its kind: `input[text]` already says so.
  if (name === 'editable' && shown.kind === 'input') return null
  if ((value.value === false || value.value === 'false') && !TOGGLES.has(name)) return null
  return `${name}=${value.type === 'string' ? JSON.stringify(value.value) : String(value.value)}`
}

/**
 * What the tree says of a ref (#382, ADR 0084): its Ref State, and, for a
 * ref the page gave no label of its own, the label the browser computes
 * for it (an svg `<title>`, an `img` alt, an `aria-labelledby`); absent
 * when the ref had one, or the tree names it nothing.
 */
export interface RefRead {
  readonly label?: string
  readonly states: string[]
}

/** The tree's computed name, collapsed, when it has words; null otherwise. */
function nameOf(node: AxNode): string | null {
  const said = typeof node.name?.value === 'string' ? collapsed(node.name.value) : ''
  return said === '' ? null : truncateLabel(said)
}

/** A ref's Ref State, in the order the tree gives it, and its label from the tree when the page gave none; nothing for a node the tree ignores. */
export function refStatesOf(node: AxNode, shown: RefShown): RefRead {
  if (node.ignored === true) return { states: [] }
  const named = collapsed(shown.label) === '' ? nameOf(node) : null
  // A label from the tree is the one the states are read against: a description that repeats it is no news.
  const read = named === null ? shown : { ...shown, label: named }
  const role = typeof node.role?.value === 'string' ? node.role.value : ''
  const states = [
    ...(role !== '' && !roleRestates(role, read) ? [`role=${role}`] : []),
    wordsOf('description', node, read),
    wordsOf('value', node, read),
    ...(node.properties ?? []).map((property) => stateOf(property, read)),
  ].filter((state): state is string => state !== null)
  return named === null ? { states } : { label: named, states }
}
