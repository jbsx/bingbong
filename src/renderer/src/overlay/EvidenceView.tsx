import { useEffect, useRef, useState } from 'react'
import type { MemoryEntryId } from '../../../core/session/workingMemory'
import type { SessionCandidate, SessionObservation } from '../../../core/session/sessionEvidence'
import {
  CANDIDATE_FILTERS,
  OBSERVATION_FILTERS,
  candidateMatchesFilter,
  describeObservationProvenance,
  describeProvenance,
  isDelegatedObservation,
  newestFirstCandidates,
  newestFirstObservations,
  observationMatchesFilter,
  sourceLabel,
  type CandidateFilter,
  type ObservationFilter,
} from '../../../core/session/evidenceBrowser'
import { formatFeedTime } from '../ActivityFeed'

/**
 * The complete Session Evidence Browser (#142, ADR 0028): the current
 * Session's checkpointed evidence as two distinct newest-first sections —
 * Observations and Candidates — each with its own filter row, rendered
 * from the authoritative snapshot (never patched from notifications,
 * never anything of a foreign Session). Observation cards carry the full
 * grounded record: statement, presented source kind, observed time,
 * uncertainty, revalidation need, source labels, and human-readable
 * provenance. Candidate cards carry subject, detail, live status, and
 * support that references — focuses — existing Observation cards instead
 * of copying their contents. Internal identities (Memory Entry, Run,
 * Observation, Subagent) never appear as visible text; Assessments are
 * not Evidence (the store never holds them as Observations). Filtering is
 * renderer-local and moves no browser or Run state, and the header's
 * `Evidence N` total (owned by the panel chrome) counts everything
 * regardless of the active filters. Switching to this view stays
 * renderer-local exactly as in #139.
 */
export function EvidenceView({
  observations,
  candidates,
  headerActions,
  footer,
}: {
  observations: readonly SessionObservation[]
  candidates: readonly SessionCandidate[]
  headerActions?: React.ReactNode
  /** Below the list — the panel's prompt row, same as Activity. */
  footer?: React.ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // Filters are presentation state local to this view: they hide cards,
  // never evidence — the count the header shows is filter-independent.
  const [observationFilter, setObservationFilter] = useState<ObservationFilter>('all')
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('all')
  // The Observation a support reference focused: resolved after render,
  // so a filter widened for the focus has already committed.
  const [pendingFocus, setPendingFocus] = useState<MemoryEntryId | null>(null)

  // Newest evidence stays visible, same contract as the feed list.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = 0
  }, [observations, candidates])

  useEffect(() => {
    if (pendingFocus === null) return
    const card = listRef.current?.querySelector(`[data-evidence-id="${CSS.escape(pendingFocus)}"]`)
    if (!(card instanceof HTMLElement)) return
    card.scrollIntoView({ block: 'center' })
    card.classList.add('evidence-card--focused')
    setPendingFocus(null)
    const flash = window.setTimeout(() => card.classList.remove('evidence-card--focused'), 1_600)
    return () => window.clearTimeout(flash)
  }, [pendingFocus, observations, candidates, observationFilter])

  const byId = new Map(observations.map((observation) => [observation.id, observation]))
  const visibleObservations = newestFirstObservations(observations)
    .filter((observation) => observationMatchesFilter(observation, observationFilter))
  const visibleCandidates = newestFirstCandidates(candidates)
    .filter((candidate) => candidateMatchesFilter(candidate, candidateFilter))

  /** A Candidate's support: reference the existing card — never copy it. */
  const focusObservation = (id: MemoryEntryId): void => {
    const observation = byId.get(id)
    if (observation === undefined) return
    // A reference always reaches its card: if the active Observation
    // filter hides it, widen to all first — the focus commits after.
    if (!observationMatchesFilter(observation, observationFilter)) setObservationFilter('all')
    setPendingFocus(id)
  }

  return (
    <div className="feed" aria-label="session evidence">
      <div className="feed-header">
        evidence
        {headerActions ? <span className="feed-header-actions">{headerActions}</span> : null}
      </div>
      <div className="feed-list" ref={listRef}>
        {observations.length === 0 && candidates.length === 0 ? (
          <p className="feed-empty">Nothing has been checkpointed as evidence in this session yet.</p>
        ) : null}
        <section className="evidence-section" aria-label="observations">
          <header className="evidence-section-head">
            <h3 className="evidence-section-title">observations</h3>
            <span className="evidence-section-count">
              {visibleObservations.length}/{observations.length}
            </span>
          </header>
          {observations.length > 0 ? (
            <div className="evidence-filters" role="group" aria-label="filter observations by source">
              {OBSERVATION_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`evidence-filter${filter === observationFilter ? ' evidence-filter--active' : ''}`}
                  aria-pressed={filter === observationFilter}
                  onClick={() => setObservationFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
          {visibleObservations.length === 0 ? (
            <p className="evidence-section-empty">
              {observations.length === 0 ? 'No observations yet.' : 'No observations match this filter.'}
            </p>
          ) : (
            visibleObservations.map((observation) => (
              <article
                key={observation.id}
                className={`evidence-card${observation.volatile === true ? ' evidence-card--volatile' : ''}`}
                data-evidence-id={observation.id}
              >
                <header className="evidence-card-head">
                  <span className="evidence-kind">{observation.sourceKind}</span>
                  {isDelegatedObservation(observation) ? (
                    <span className="evidence-chip evidence-chip--delegated">delegated</span>
                  ) : null}
                  {observation.volatile === true ? (
                    <span className="evidence-chip evidence-chip--volatile">needs revalidation</span>
                  ) : null}
                  <time className="feed-time">{formatFeedTime(observation.observedAt)}</time>
                </header>
                <p className="evidence-text">{observation.text}</p>
                {observation.uncertainty !== undefined ? (
                  <p className="evidence-uncertainty">uncertainty: {observation.uncertainty}</p>
                ) : null}
                {observation.references.length > 0 ? (
                  <p className="evidence-source">{observation.references.map(sourceLabel).join(' · ')}</p>
                ) : null}
                <p className="evidence-provenance">{describeObservationProvenance(observation)}</p>
              </article>
            ))
          )}
        </section>
        <section className="evidence-section" aria-label="candidates">
          <header className="evidence-section-head">
            <h3 className="evidence-section-title">candidates</h3>
            <span className="evidence-section-count">
              {visibleCandidates.length}/{candidates.length}
            </span>
          </header>
          {candidates.length > 0 ? (
            <div className="evidence-filters" role="group" aria-label="filter candidates by status">
              {CANDIDATE_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`evidence-filter${filter === candidateFilter ? ' evidence-filter--active' : ''}`}
                  aria-pressed={filter === candidateFilter}
                  onClick={() => setCandidateFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
          {visibleCandidates.length === 0 ? (
            <p className="evidence-section-empty">
              {candidates.length === 0 ? 'No candidates yet.' : 'No candidates match this filter.'}
            </p>
          ) : (
            visibleCandidates.map((candidate) => (
              <article
                key={candidate.id}
                className="evidence-card evidence-card--candidate"
                data-candidate-id={candidate.id}
                data-candidate-status={candidate.status}
              >
                <header className="evidence-card-head">
                  <span className={`evidence-status evidence-status--${candidate.status}`}>{candidate.status}</span>
                  <time className="feed-time">{formatFeedTime(candidate.recordedAt)}</time>
                </header>
                <p className="evidence-text">{candidate.subject}</p>
                {candidate.detail !== undefined ? <p className="evidence-detail">{candidate.detail}</p> : null}
                {candidate.supportingObservationIds.length > 0 ? (
                  <div className="evidence-support">
                    {candidate.supportingObservationIds.flatMap((id) => {
                      const support = byId.get(id)
                      return support === undefined
                        ? []
                        : [
                          <button
                            key={id}
                            type="button"
                            className="evidence-support-ref"
                            aria-label={`Show the supporting ${support.sourceKind} observation`}
                            onClick={() => focusObservation(id)}
                          >
                            {support.sourceKind} · {formatFeedTime(support.observedAt)}
                          </button>,
                        ]
                    })}
                  </div>
                ) : null}
                <p className="evidence-provenance">{describeProvenance(candidate.provenance)}</p>
              </article>
            ))
          )}
        </section>
      </div>
      {footer}
    </div>
  )
}
