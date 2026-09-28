// The displayed Answer's evidence grounding (#122, ADR 0028; #141): the
// model's own wording with its Identity Slips repaired (#246), the source
// links derived from the Session Evidence the Answer cites, and the split
// between the two surfaces that show them. The live Feed renders the
// structured Answer Evidence Summary from the declared evidence
// identities (#141) — no generated Sources block rides the live text.
// The derived links ride the `display` event beside it, where the Run
// Trace records them; since Recorded History was retired (#188) nothing
// renders them. The Card, the spoken line and the Asked Items the Card
// lists (#300) are repaired here and nowhere else, by the one pattern the
// Subagent Announcement's removal reads too; the declared evidence
// identities are never touched. This is the display boundary.

import type { AskedItemStanding } from '../agent/askedItems'
import type { MemoryEntryId, MemoryReference } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import { hostFromUrl } from './blockerGate'

/**
 * The source links an Answer's cited evidence carries (#122): each
 * cited Observation's web references, in citation order, deduplicated
 * by canonical URL. User Observations contribute no links — the user's
 * words are not a page — and unknown identities silently contribute
 * nothing (support validation elsewhere handles honesty).
 */
export function deriveAnswerSources(
  evidenceIds: readonly MemoryEntryId[] | undefined,
  resolve: (id: MemoryEntryId) => SessionObservation | null,
): MemoryReference[] {
  if (evidenceIds === undefined) return []
  const byUrl = new Map<string, MemoryReference>()
  for (const id of evidenceIds) {
    for (const reference of resolve(id)?.references ?? []) {
      if (!byUrl.has(reference.url)) byUrl.set(reference.url, reference)
    }
  }
  return [...byUrl.values()]
}

/**
 * Internal identities that must never appear in a rendering the user
 * receives: the Memory Entry ids (`memory-N`) Session Evidence addresses
 * Observations and Candidates by, and the Run Observation ids (`obs-N`)
 * the ledger retains. One match is a run of ids joined by slashes
 * (`memory-1/memory-2`), so the ids behind the first slash are not
 * mistaken for a URL's path. Id-shaped segments inside URLs survive — a
 * run preceded by a slash, `=` or a word character is not a token. A
 * range (`memory-1..6`, `memory-1–6`) is one id as written (#300): it
 * names no single Observation, so it is only ever removed, whole.
 */
const IDENTITY_RE = /(?:memory|obs)-\d+(?:(?:\.\.|–)(?:(?:memory|obs)-)?\d+)?/
const IDENTITY_RUN_RE = new RegExp(`(?<![/=\\w])${IDENTITY_RE.source}(?:\\/${IDENTITY_RE.source})*\\b`, 'gi')
const MEMORY_ENTRY_ID_RE = /^memory-\d+$/i

/**
 * Which rendering an Identity Slip was written into: the Card or the
 * Spoken Rendering (#246), or an Asked Item the Card lists, its name or
 * its statement (#300).
 */
export type IdentitySlipSurface = 'display' | 'speak' | 'asked_item'

/** What the display boundary did with a slipped id (#246). */
export type IdentitySlipRepair = 'substituted' | 'deleted'

/** One internal id the model wrote into a rendering, and its repair (#246). */
export interface IdentitySlip {
  readonly surface: IdentitySlipSurface
  /** The id as the model wrote it. */
  readonly id: string
  readonly repair: IdentitySlipRepair
}

/** A rendering after the boundary: the text the user receives, and every slip repaired in it. */
export interface RepairedRendering {
  readonly text: string
  readonly slips: readonly IdentitySlip[]
}

/** What a Card says in place of an id naming the user's own words (#246). */
export const USER_OBSERVATION_PHRASE = 'what you told me'

/**
 * The Card the live Feed shows (#122, #141, #246): the model's display
 * with every Identity Slip repaired, and nothing else. An id that names a
 * Session Evidence Observation becomes a link to its first reference —
 * titled, else by host — or {@link USER_OBSERVATION_PHRASE} for a User
 * Observation; an id the store cannot resolve, a Run Observation id among
 * them, is deleted and the punctuation it leaves tidied. The structured Answer Evidence
 * Summary, not a generated Sources list, presents the cited evidence
 * beside this text, and a substitution never enters it.
 */
export function repairCard(
  display: string,
  resolve: (id: MemoryEntryId) => SessionObservation | null,
): RepairedRendering {
  return repairRendering(display, 'display', (id) => {
    if (!MEMORY_ENTRY_ID_RE.test(id)) return null
    const observation = resolve(id.toLowerCase() as MemoryEntryId)
    if (observation === null) return null
    if (observation.sourceKind === 'user') return USER_OBSERVATION_PHRASE
    const reference = observation.references[0]
    return reference === undefined ? null : markdownLink(reference)
  })
}

/**
 * The Spoken Rendering as it is voiced (#246): every slipped id deleted,
 * never substituted — a spoken citation is noise.
 */
export function repairSpokenRendering(speak: string): RepairedRendering {
  return repairRendering(speak, 'speak', deleteIdentity)
}

/** The Asked Items a Card lists after the boundary, and every slip repaired in them (#300). */
export interface RepairedAskedItems {
  readonly items: readonly AskedItemStanding[]
  readonly slips: readonly IdentitySlip[]
}

/**
 * The Asked Items the Card lists (#300): each item's name and statement
 * with every slipped id removed, never substituted — a statement is plain
 * text, and the Answer Evidence Summary shows the sources. One slip per
 * id, an item's name before its statement. An item with no slip comes
 * back as it was; a statement removal left empty stays empty, which the
 * Card renders as no statement.
 */
export function repairAskedItems(items: readonly AskedItemStanding[]): RepairedAskedItems {
  const slips: IdentitySlip[] = []
  const repaired = items.map((entry) => {
    const item = repairRendering(entry.item, 'asked_item', deleteIdentity)
    const statement = repairRendering(entry.statement, 'asked_item', deleteIdentity)
    if (item.slips.length === 0 && statement.slips.length === 0) return entry
    slips.push(...item.slips, ...statement.slips)
    return { ...entry, item: item.text.trim(), statement: statement.text.trim() }
  })
  return { items: repaired, slips }
}

/**
 * A text with every internal id removed and the removal tidied, for a
 * rendering that is not an Answer's — the Subagent Announcement (#300).
 * It names no surface and records nothing: an Identity Slip is an id
 * written into a rendering of an Answer.
 */
export function removeIdentities(text: string): string {
  return rewriteIdentities(text, deleteIdentity).text
}

/** Replaces each slipped id as `substitute` says, and records every one as a slip on `surface`. */
function repairRendering(text: string, surface: IdentitySlipSurface, substitute: IdentitySubstitute): RepairedRendering {
  const rewritten = rewriteIdentities(text, substitute)
  return { text: rewritten.text, slips: rewritten.ids.map((entry) => ({ surface, ...entry })) }
}

/** What stands in place of an id as written; null deletes it. */
type IdentitySubstitute = (id: string) => string | null
/** The substitute of a rendering that only ever deletes. */
const deleteIdentity: IdentitySubstitute = () => null

/** Stands where an id was deleted until the tidy has read what the deletion emptied; no rendering carries it. */
const DELETION_MARK = '\u0000'
/**
 * A pair of brackets holding no bracket of its own, with the space before
 * it. Square brackets that open a markdown link are its label, never a
 * citation, and are left for the link to keep its shape.
 */
const BRACKET_PAIR_RE = /[ \t]*(?:\(([^()[\]]*)\)|\[([^()[\]]*)\](?!\())/g
/** What a pair of brackets holds when deletions emptied it: the marks, and what joined the ids. */
const ONLY_DELETIONS_RE = /^(?:[\s,;&/]|\band\b)*\0(?:[\s,;&/\0]|\band\b)*$/

/**
 * Replaces each id with what `substitute` renders for it, or deletes it
 * when that is null, and says what it did with each, in the order
 * written. A text with no id comes back exactly as written; only a
 * deletion earns the tidy.
 */
function rewriteIdentities(text: string, substitute: IdentitySubstitute): { text: string; ids: Omit<IdentitySlip, 'surface'>[] } {
  const ids: Omit<IdentitySlip, 'surface'>[] = []
  // A text that already carries the mark could not tell its own from a
  // deletion's; it is not one a model writes, and it goes first.
  const rewritten = text.replaceAll(DELETION_MARK, '').replace(IDENTITY_RUN_RE, (run) => {
    const kept = run
      .split('/')
      .map((id) => {
        const replacement = substitute(id)
        ids.push({ id, repair: replacement === null ? 'deleted' : 'substituted' })
        return replacement
      })
      .filter((replacement) => replacement !== null)
    return kept.length === 0 ? DELETION_MARK : kept.join('/')
  })
  if (ids.length === 0) return { text, ids }
  if (!ids.some((entry) => entry.repair === 'deleted')) return { text: rewritten, ids }
  return {
    // Tidy what deletions leave behind: the brackets one emptied go with
    // it (#300), and only those — brackets written empty stay — and so
    // does the space one left against a closing bracket; then collapsed
    // runs of spaces and commas, then a comma left against a paren or
    // bracket, which a substitution beside a deletion leaves.
    text: rewritten
      .replace(BRACKET_PAIR_RE, (pair, round?: string, square?: string) => (ONLY_DELETIONS_RE.test(round ?? square ?? '') ? '' : pair))
      .replace(/[ \t]+\0(?=[)\]])/g, '')
      .replaceAll(DELETION_MARK, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/(?:[ \t]*,[ \t]*){2,}/g, ', ')
      .replace(/[ \t]*,[ \t]*([)\]])/g, '$1')
      .replace(/([([])[ \t]*,[ \t]*/g, '$1'),
    ids,
  }
}

/** A reference as a markdown link: its title, else its URL's host, escaped so the link stays one link. */
function markdownLink(reference: MemoryReference): string {
  const label = (reference.title?.trim() || (hostFromUrl(reference.url) ?? reference.url)).replace(/[\\[\]]/g, (char) => `\\${char}`)
  const target = reference.url.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
  return `[${label}](${target})`
}
