import type { SessionObservation } from '../../core/session/sessionEvidence'
import { answerEvidenceObservations } from '../../core/session/answerEvidenceSummary'
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
 * a duplicate link dump. It carries no contradiction warning (ADR 0071):
 * two Observations from one address are not presumed to disagree, and a
 * disagreement across sources is the Answer's own to disclose.
 */

export function AnswerEvidenceSummary({
  evidenceIds,
  observations,
}: {
  evidenceIds: readonly MemoryEntryId[]
  observations: readonly SessionObservation[]
}) {
  const cited = answerEvidenceObservations(evidenceIds, observations)
  if (cited.length === 0) return null
  return (
    <details className="answer-evidence">
      <summary className="answer-evidence-summary">
        <span className="answer-evidence-title">evidence</span>
        <span className="answer-evidence-count">{cited.length}</span>
      </summary>
      <div className="answer-evidence-entries">
        {cited.map((observation) => (
          <article key={observation.id} className="evidence-card answer-evidence-card" data-evidence-id={observation.id}>
            <header className="evidence-card-head">
              <span className="evidence-kind">{observation.sourceKind}</span>
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
