import type { ObservationContradiction, SessionObservation } from '../../core/session/sessionEvidence'
import { answerEvidenceContradictions, answerEvidenceObservations } from '../../core/session/answerEvidenceSummary'
import type { MemoryEntryId } from '../../core/session/workingMemory'
import { EvidenceSourceControl } from './EvidenceSourceControl'
import { formatFeedTime } from './ActivityFeed'

/**
 * The Answer Evidence Summary (#141, ADR 0028): the collapsed, read-only
 * view of exactly the Observations an Answer declared as its support —
 * its `evidence_ids`, resolved against the current authoritative Session
 * snapshot. No second model judgment decides relevance, unknown
 * identities simply stay absent, and the Answer's own text above it is
 * immutable. Replaces the generated Markdown Sources list in the live
 * Feed, so the cited evidence reads as one structured record instead of
 * a duplicate link dump.
 *
 * Contradiction warnings (#143): when the current snapshot retains a
 * mechanical contradiction whose earlier member this Answer cited, the
 * summary gains a warning — flagged on the collapsed row, explained
 * inside — recomputed on every snapshot read, so a later Run warns an
 * already-rendered Answer. The Answer's own text never changes: what
 * was said stays exactly what was said.
 */

/** One shared empty default — props stay optional without allocating per render. */
const NO_CONTRADICTIONS: readonly ObservationContradiction[] = []

export function AnswerEvidenceSummary({
  evidenceIds,
  observations,
  contradictions = NO_CONTRADICTIONS,
}: {
  evidenceIds: readonly MemoryEntryId[]
  observations: readonly SessionObservation[]
  contradictions?: readonly ObservationContradiction[]
}) {
  const cited = answerEvidenceObservations(evidenceIds, observations)
  if (cited.length === 0) return null
  const warnings = answerEvidenceContradictions(evidenceIds, contradictions)
  const contradicted = new Set(warnings.flatMap((pair) => [pair.earlierObservationId, pair.laterObservationId]))
  // One cited Observation contradicted twice still counts once: the
  // warning names the support that fell, not the pile of disagreements.
  const contradictedSupport = new Set(warnings.map((pair) => pair.earlierObservationId)).size
  return (
    <details className="answer-evidence">
      <summary className="answer-evidence-summary">
        <span className="answer-evidence-title">evidence</span>
        {warnings.length > 0 ? <span className="answer-evidence-warning-chip">contradicted</span> : null}
        <span className="answer-evidence-count">{cited.length}</span>
      </summary>
      <div className="answer-evidence-entries">
        {warnings.length > 0 ? (
          <p className="answer-evidence-warning" role="note">
            {`Later evidence from the same source contradicts ${
              contradictedSupport === 1 ? 'a supporting observation' : `${contradictedSupport} supporting observations`
            } below. Every version is retained — the answer above is unchanged.`}
          </p>
        ) : null}
        {cited.map((observation) => (
          <article key={observation.id} className="evidence-card answer-evidence-card" data-evidence-id={observation.id}>
            <header className="evidence-card-head">
              <span className="evidence-kind">{observation.sourceKind}</span>
              {contradicted.has(observation.id) ? (
                <span className="evidence-chip evidence-chip--contradicted">contradicted</span>
              ) : null}
              <time className="feed-time">{formatFeedTime(observation.observedAt)}</time>
            </header>
            <p className="evidence-text">{observation.text}</p>
            {observation.references.length > 0 ? (
              // The shared source control (#144): exactly the Evidence
              // Browser's own — label, selectable URL, `Copy source` —
              // never a link that could navigate the pane.
              <div className="answer-evidence-source">
                {observation.references.map((reference) => (
                  <EvidenceSourceControl key={reference.url} reference={reference} />
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </details>
  )
}
