# ADR 0028: Grounded evidence may outlive the Run that found it

## Status

Accepted

## Context

Run Working State currently discards every tool observation when a Run fails or
is cancelled, and Memory Commit applies only at a successful Run boundary. That
causes later Runs in the same Session to repeat verified browsing work and makes
long Runs resend obsolete page snapshots on every model round. Persisting raw
tool transcripts would violate the bounded, distilled Session model.

## Decision

- Session Evidence is a source-grounded class of Session Working Memory, not a
  second store. It uses Memory Entry identity, references, provenance,
  contradiction handling, compaction, and the existing Session lifetime.
- An Evidence Checkpoint records a concise Observation, source, supporting
  excerpt or structured Action Outcome, uncertainty, observation time, Run
  provenance, and Subagent provenance when applicable. The application accepts
  web evidence only from a source observed in the Session. When the source
  observation contains text, the supporting excerpt must be verified against
  it; vision-derived evidence references the corresponding Look result.
- Observations, Assessments, and Candidates remain distinct. Assessments cite
  supporting Observations; user statements are explicit User Observations;
  contradictory evidence is retained until reconciled. Exact duplicates merge,
  while rejected and superseded evidence keeps its provenance.
- Evidence is checkpointed only when it changes the objective, establishes a
  relevant fact, eliminates a Candidate, or prevents repeated work. Routine
  navigation and transient UI state remain Run Working State.
- A verified checkpoint survives a later failed or cancelled Run, but remains
  Session-only and disappears at Lapse or Session Reset. Stable evidence may be
  reused; current, time-sensitive, uncertain, or action-critical state must be
  revalidated.
- After Run Context pressure crosses a threshold, old checkpointed tool
  observations are deterministically replaced in model context by their
  Session Evidence Memory Entry references. No summarization model is invoked.
  The latest actionable page state, unresolved failures, Steering Directives,
  and observations not yet checkpointed remain intact.
- Subagents cannot mutate Session Working Memory. Their source-grounded reports
  retain hidden worker provenance; the orchestrator checkpoints only relevant
  findings.

## Consequences

- Useful evidence is not lost because later work failed, and later Runs avoid
  repeating source inspection within the Session.
- This deliberately narrows Memory Commit's former all-or-nothing boundary:
  grounded evidence may commit before the final Answer, but speculative
  Assessments still do not.
- Run Context Compaction reduces a current Run's tool-result history. Separately,
  Memory Compaction preserves evidence supporting active objectives,
  unresolved contradictions, user corrections, and final Answers. Duplicate,
  superseded, and low-value observations yield first.
- Recorded History stores Effort Tier, Run Resolution, Finalization Cause, counts, and
  timing, but not Session Evidence content. Existing rows receive null values
  through an additive migration; no historical meaning is inferred.
