// The displayed Answer's evidence grounding (#122, ADR 0028; #141): the
// model's own wording scrubbed of internal identities, the source links
// derived from the Session Evidence the Answer cites, and the split
// between the two surfaces that show them. The live Feed renders the
// structured Answer Evidence Summary from the declared evidence
// identities (#141) — no generated Sources block rides the live text.
// The derived links ride the `display` event beside it, where the Run
// Trace records them; since Recorded History was retired (#188) nothing
// renders them. The spoken line and the model's own wording are
// untouched; this is the display boundary.

import type { MemoryEntryId, MemoryReference } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'

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
 * Internal identities that must never appear in displayed text: the
 * Memory Entry ids (`memory-N`) Session Evidence addresses Observations
 * and Candidates by, and the Run Observation ids (`obs-N`) the ledger
 * retains. Id-shaped segments inside URLs survive — only the standalone
 * tokens go.
 */
const INTERNAL_ID_RE = /(?<![/=\w])(?:memory|obs)-\d+\b/gi

/**
 * The text the live Feed shows (#122, #141): the model's display with
 * internal identity tokens scrubbed — holes tidied — and nothing else.
 * The structured Answer Evidence Summary, not a generated Sources list,
 * presents the cited evidence beside this text.
 */
export function scrubAnswerText(display: string): string {
  return display
    .replace(INTERNAL_ID_RE, '')
    // Tidy the holes deleted tokens leave behind: collapsed runs of
    // spaces and commas, then parens or brackets the deletions emptied.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(?:[ \t]*,[ \t]*){2,}/g, ', ')
    .replace(/\([ \t]*,[ \t]*\)/g, '()')
    .replace(/\[[ \t]*,[ \t]*\]/g, '[]')
}
