// The displayed Answer's evidence grounding (#122, ADR 0028; #141): the
// model's own wording with its Identity Slips repaired (#246), the source
// links derived from the Session Evidence the Answer cites, and the split
// between the two surfaces that show them. The live Feed renders the
// structured Answer Evidence Summary from the declared evidence
// identities (#141) — no generated Sources block rides the live text.
// The derived links ride the `display` event beside it, where the Run
// Trace records them; since Recorded History was retired (#188) nothing
// renders them. The Card and the spoken line are repaired here and
// nowhere else; the declared evidence identities are never touched. This
// is the display boundary.

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
 * run preceded by a slash, `=` or a word character is not a token.
 */
const IDENTITY_RUN_RE = /(?<![/=\w])(?:memory|obs)-\d+(?:\/(?:memory|obs)-\d+)*\b/gi
const MEMORY_ENTRY_ID_RE = /^memory-\d+$/i

/** Which rendering of an Answer an Identity Slip was written into (#246). */
export type IdentitySlipSurface = 'display' | 'speak'

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
  return repairRendering(speak, 'speak', () => null)
}

/**
 * Replaces each slipped id with what `substitute` renders for it, or
 * deletes it when that is null. A text with no slip comes back exactly as
 * written; only a deletion earns the tidy.
 */
function repairRendering(text: string, surface: IdentitySlipSurface, substitute: (id: string) => string | null): RepairedRendering {
  const slips: IdentitySlip[] = []
  const repaired = text.replace(IDENTITY_RUN_RE, (run) =>
    run
      .split('/')
      .map((id) => {
        const replacement = substitute(id)
        slips.push({ surface, id, repair: replacement === null ? 'deleted' : 'substituted' })
        return replacement
      })
      .filter((replacement) => replacement !== null)
      .join('/'),
  )
  if (!slips.some((slip) => slip.repair === 'deleted')) return { text: repaired, slips }
  return {
    // Tidy the punctuation deletions leave behind: collapsed runs of
    // spaces and commas, then a comma left against a paren or bracket,
    // which a substitution beside a deletion leaves.
    text: repaired
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/(?:[ \t]*,[ \t]*){2,}/g, ', ')
      .replace(/[ \t]*,[ \t]*([)\]])/g, '$1')
      .replace(/([([])[ \t]*,[ \t]*/g, '$1'),
    slips,
  }
}

/** A reference as a markdown link: its title, else its URL's host, escaped so the link stays one link. */
function markdownLink(reference: MemoryReference): string {
  const label = (reference.title?.trim() || (hostFromUrl(reference.url) ?? reference.url)).replace(/[\\[\]]/g, (char) => `\\${char}`)
  const target = reference.url.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
  return `[${label}](${target})`
}
