// Asked Items (#250, ADR 0052): the things a command explicitly requests be
// reported, declared by the model in the Run's first Run Plan and carried
// by the Answer with a standing each — `stated` with the statement, or
// `unverified` with why. This module is the vocabulary both ends share:
// the bounds the Run Plan enforces, the standing the Answer contract
// parses, and the coverage check that decides whether an Answer's list is
// the declared list. It judges presence only, never what a standing says.

/** The most Asked Items one Run Plan may declare. */
export const MAX_ASKED_ITEMS = 12

/** The bound on one Asked Item's wording. */
export const MAX_ASKED_ITEM_CHARS = 160

/** The two standings an Answer may give an Asked Item — a moot item is `stated` as moot. */
export const ASKED_ITEM_STANDINGS = ['stated', 'unverified'] as const
export type AskedItemStandingKind = (typeof ASKED_ITEM_STANDINGS)[number]

/** One Asked Item's standing in an Answer: the item as declared, and the statement or the reason. */
export interface AskedItemStanding {
  readonly item: string
  readonly standing: AskedItemStandingKind
  /** The statement for `stated`; why it could not be established for `unverified`. */
  readonly statement: string
}

/**
 * One entry of an Answer's `asked_items` as written (#311): the item by
 * its 1-based position in the declared list, by its wording, or both. An
 * entry with `n` is the item it numbers whatever its wording says; one
 * without is matched by wording. The prompt asks for the item by `n`
 * and not by wording (#313); a wording is still read. What the Card
 * renders is the settled
 * `AskedItemStanding`, which names the item as declared and carries no
 * number.
 */
export interface AskedItemEntry {
  readonly n?: number
  readonly item?: string
  readonly standing: AskedItemStandingKind
  readonly statement: string
}

/** The reason a runtime-filled `unverified` standing carries when the Answer left the item unstated. */
export const ASKED_ITEM_UNSTATED = 'not stated in the Answer'

/**
 * The reason every declared Asked Item carries on a Deterministic Answer.
 * It is about the item and names no stop (#315, ADR 0038).
 */
export const ASKED_ITEM_UNESTABLISHED = 'not established'

/**
 * One Asked Item's identity for matching (#250): case, surrounding
 * whitespace, runs of whitespace, and trailing punctuation are not what
 * makes two wordings different items. A retry message names the missing
 * items verbatim, so the model can copy them; this tolerance covers the
 * rest.
 */
export function normalizeAskedItem(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.:;,!?]+$/u, '')
}

/** Items quoted for a model-facing sentence, so a reply can copy them verbatim. */
export function quoteAskedItems(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join('; ')
}

/** Whether two declarations name the same items, order aside. */
export function sameAskedItems(left: readonly string[], right: readonly string[]): boolean {
  const key = (items: readonly string[]) => JSON.stringify([...new Set(items.map(normalizeAskedItem))].sort())
  return key(left) === key(right)
}

function isStandingKind(value: unknown): value is AskedItemStandingKind {
  return typeof value === 'string' && (ASKED_ITEM_STANDINGS as readonly string[]).includes(value)
}

/** An entry's `n` as written: a whole number, or a string of digits; undefined when absent, null when it is neither. */
function parseItemNumber(raw: unknown): number | undefined | null {
  if (raw === undefined) return undefined
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) return Number(raw)
  return null
}

/**
 * Parses the Answer contract's `asked_items` value: a list of entries each
 * naming its item by `n`, by `item`, or both (#311), with a `standing` and
 * a non-empty `statement` — the statement for `stated`, the reason for
 * `unverified`; a `stated` entry that says nothing is the omission the
 * rule exists to stop, so it is not the shape. Null when the value is not
 * that shape — the Answer stands and the coverage check treats the list
 * as missing. Whether an `n` names a declared item is the coverage
 * check's question, since only it holds the declaration.
 */
export function parseAskedItemEntries(raw: unknown): AskedItemEntry[] | null {
  if (!Array.isArray(raw)) return null
  const entries: AskedItemEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const { n: rawN, item, standing, statement } = entry as Record<string, unknown>
    const n = parseItemNumber(rawN)
    if (n === null) return null
    if (item !== undefined && typeof item !== 'string') return null
    const wording = item?.trim() ?? ''
    if ((wording === '' && n === undefined) || !isStandingKind(standing)) return null
    if (typeof statement !== 'string' || statement.trim() === '') return null
    entries.push({ ...(n !== undefined ? { n } : {}), ...(wording !== '' ? { item: wording } : {}), standing, statement: statement.trim() })
  }
  return entries
}

/**
 * Which declared item each entry is (#311): the position its `n` names,
 * or the one its wording matches when it carries no `n`; null when it is
 * none. An `n` outside the declared list, or one an earlier entry already
 * used, makes its entry undeclared — as an unknown wording does — and an
 * `n` that disagrees with its wording wins without remark.
 */
function resolveAskedItems(declared: readonly string[], entries: readonly AskedItemEntry[]): (number | null)[] {
  const byWording = new Map(declared.map((item, index) => [normalizeAskedItem(item), index] as const).reverse())
  const numbered = new Set<number>()
  return entries.map((entry) => {
    if (entry.n === undefined) return byWording.get(normalizeAskedItem(entry.item ?? '')) ?? null
    const index = entry.n - 1
    if (index < 0 || index >= declared.length || numbered.has(index)) return null
    numbered.add(index)
    return index
  })
}

/** How an undeclared entry is named to the model and in the trace: its number, then its wording. */
function entryLabel(entry: AskedItemEntry): string {
  return entry.n === undefined ? (entry.item ?? '') : `#${entry.n}${entry.item !== undefined ? ` ${entry.item}` : ''}`
}

/** What the coverage check found: the declared items the Answer left out, and the entries it invented. */
export interface AskedItemsCoverage {
  readonly missing: readonly string[]
  readonly undeclared: readonly string[]
}

/**
 * Whether an Answer's list is the declared list (#250): every declared
 * item has a standing, and no entry names an item the Run Plan did not
 * declare. With nothing declared there is nothing to cover, and whatever
 * the Answer wrote is ignored rather than judged.
 */
export function askedItemsCoverage(
  declared: readonly string[],
  entries: readonly AskedItemEntry[] | undefined,
): AskedItemsCoverage {
  if (declared.length === 0) return { missing: [], undeclared: [] }
  const listed = entries ?? []
  const resolved = resolveAskedItems(declared, listed)
  const carried = new Set(resolved.filter((index) => index !== null))
  return {
    missing: declared.filter((_, index) => !carried.has(index)),
    undeclared: listed.filter((_, at) => resolved[at] === null).map(entryLabel),
  }
}

export function askedItemsCovered(coverage: AskedItemsCoverage): boolean {
  return coverage.missing.length === 0 && coverage.undeclared.length === 0
}

/** The declared items numbered as an entry's `n` names them: `1. "…"; 2. "…"`. */
export function numberedAskedItems(declared: readonly string[], items: readonly string[] = declared): string {
  return items.map((item) => `${declared.indexOf(item) + 1}. "${item}"`).join('; ')
}

/**
 * What one entry of `asked_items` holds, worded for a retry message: the
 * item's number and never its wording, which the application holds, and
 * for a `stated` entry the bare value (#313, ADR 0074).
 */
const ASKED_ITEM_ENTRY_FORM =
  '{"n": the item\'s number in the declared list, "standing": "stated" or "unverified", "statement": the established value alone, or why you could not}'

/**
 * The Answer Retry's message for a list that is not the declared list
 * (#250): the missing items by number and wording (#311), the undeclared
 * ones named, and every declared item numbered. An Answer the runtime
 * could read is asked for its list alone — `{"asked_items": [...]}`,
 * which the pipeline merges into the Answer it sent back, so nothing
 * else of it is written twice. A prose reply is described as what it was
 * — no JSON object, so no list — and asked for the whole Answer, since
 * there is no Answer to merge into. It shares the one retry with the
 * Malformed Answer case, and like that message it writes nothing of the
 * Answer.
 */
export function askedItemsRetryMessage(declared: readonly string[], coverage: AskedItemsCoverage, form: 'list' | 'prose'): string {
  const parts: string[] = []
  if (coverage.missing.length > 0) {
    parts.push(
      `it carries no standing for ${coverage.missing.length === 1 ? 'the Asked Item' : 'these Asked Items'}: ${numberedAskedItems(declared, coverage.missing)}`,
    )
  }
  if (coverage.undeclared.length > 0) {
    parts.push(`it names ${coverage.undeclared.length === 1 ? 'an item' : 'items'} the Run Plan never declared: ${quoteAskedItems(coverage.undeclared)}`)
  }
  const declaredList = `The declared Asked Items are ${numberedAskedItems(declared)}. `
  if (form === 'prose') {
    return (
      `Your last reply was meant as the Answer but was not the JSON object, so it carries no "asked_items": ${parts.join('; and ')}. ` +
      declaredList +
      `Reply with only the JSON object, "asked_items" carrying exactly one entry per declared Asked Item, each ${ASKED_ITEM_ENTRY_FORM}. ` +
      'An item you could not establish is "unverified", and "resolution" is then "partial".'
    )
  }
  return (
    `Your last reply was meant as the Answer but its "asked_items" is not the declared list: ${parts.join('; and ')}. ` +
    'The rest of that Answer stands as written and is not to be repeated. ' +
    declaredList +
    'Reply with {"asked_items": [...]} and nothing else — no other field, no text before or after it, no code fences — ' +
    `carrying exactly one entry per declared Asked Item, each ${ASKED_ITEM_ENTRY_FORM}. ` +
    'An item you could not establish is "unverified", and the application then records the Run as partial.'
  )
}

/**
 * The list a list-only retry leaves the Answer with (#311): the reply's
 * entries, then — for a declared item the reply gave no standing — the
 * standing the Answer first wrote, named as declared. A first-written
 * entry naming nothing declared is dropped. With no readable reply the
 * first list stands as written, and the coverage check settles what it
 * left unstated as a spent retry does.
 */
export function mergeAskedItems(
  declared: readonly string[],
  held: readonly AskedItemEntry[] | undefined,
  reply: readonly AskedItemEntry[] | null,
): readonly AskedItemEntry[] | undefined {
  if (reply === null) return held
  const answered = new Set(resolveAskedItems(declared, reply))
  const first = held ?? []
  const kept = resolveAskedItems(declared, first).flatMap((index, at) =>
    index === null || answered.has(index) ? [] : [{ item: declared[index]!, standing: first[at]!.standing, statement: first[at]!.statement }],
  )
  return [...reply, ...kept]
}

/**
 * The standings the Answer finally carries (#250): one per declared item,
 * in declared order — the Answer's own where it gave one, `unverified` as
 * unstated where it did not. Entries for items never declared are dropped:
 * the Card renders the declaration, not the invention.
 */
export function settleAskedItems(
  declared: readonly string[],
  entries: readonly AskedItemEntry[] | undefined,
): AskedItemStanding[] {
  const listed = entries ?? []
  const byIndex = new Map<number, AskedItemEntry>()
  resolveAskedItems(declared, listed).forEach((index, at) => {
    if (index !== null) byIndex.set(index, listed[at]!)
  })
  return declared.map((item, index) => {
    const given = byIndex.get(index)
    return given !== undefined ? { item, standing: given.standing, statement: given.statement } : { item, standing: 'unverified', statement: ASKED_ITEM_UNSTATED }
  })
}

/** Every declared item `unverified` for one reason — what a deterministic Answer renders. */
export function unverifiedAskedItems(declared: readonly string[], statement: string): AskedItemStanding[] {
  return declared.map((item) => ({ item, standing: 'unverified', statement }))
}
