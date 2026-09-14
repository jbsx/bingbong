import type { SessionObservation } from '../session/sessionEvidence'
import { canonicalizeMemoryUrl } from '../session/workingMemory'

// Issue #240, ADR 0051: the Held Page Notice. A page the Session already
// holds accepted web Observations from still loads — the Run's own ledger
// has to hold the page for a checkpoint, a read or a Look to ground there —
// but the Action Outcome that lands on it names what the Session holds, so
// the rounds after the landing read the page for what those Observations do
// not state instead of recording them a second time.
//
// The Notice repeats Observation text the Session Evidence system block
// already carries. That is deliberate: the block is where the model looked
// and did not see.

/** How many held Observations one Notice lists before counting the rest. */
export const HELD_PAGE_NOTICE_OBSERVATIONS = 8

/** The fixed sentence every Held Page Notice ends on. */
export const HELD_PAGE_INSTRUCTION =
  'Cite these rather than re-recording them, and read this page only for what they do not state.'

const canonicalPage = (url: string | null): string | null =>
  url === null || url.trim() === '' ? null : canonicalizeMemoryUrl(url)

/**
 * Whether a call settled on a different page from the one the Run last
 * settled on, by the store's own canonical URL (ADR 0051: no new URL rule) —
 * a fragment, a trailing slash or a reordered query is the same page. A Run
 * that has settled nowhere yet lands wherever it is; a page that is not a
 * web address is no landing, since no Observation can hold it.
 */
export function landedOnAnotherPage(previousUrl: string | null, landedUrl: string | null): landedUrl is string {
  const landed = canonicalPage(landedUrl)
  return landed !== null && canonicalPage(previousUrl) !== landed
}

/**
 * The Notice a landing on a Held Page carries: every held Observation as
 * `id: text`, volatile ones marked, capped with a count of the rest, then
 * the fixed sentence. Null when the Session holds nothing from the page.
 */
export function heldPageNotice(observations: readonly SessionObservation[]): string | null {
  if (observations.length === 0) return null
  const listed = observations.slice(0, HELD_PAGE_NOTICE_OBSERVATIONS)
  const rest = observations.length - listed.length
  return [
    `Session Evidence already holds ${observations.length} ${observations.length === 1 ? 'Observation' : 'Observations'} from this page:`,
    ...listed.map((observation) => `${observation.id}${observation.volatile === true ? ' (volatile)' : ''}: ${observation.text}`),
    ...(rest > 0 ? [`and ${rest} more in Session Evidence.`] : []),
    HELD_PAGE_INSTRUCTION,
  ].join('\n')
}
