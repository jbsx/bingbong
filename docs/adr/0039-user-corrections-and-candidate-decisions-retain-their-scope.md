# ADR 0039: User corrections and Candidate decisions retain their scope

## Status

Accepted on 2026-09-06. Objective continuity (#206) and Inspection References
(#210) are implemented; correction retention across a failed first request and
objective-scoped Candidate decisions remain pending. Extends ADR 0028's
distinction between User Observations, Assessments, and Candidates. Session
lifetime, source-grounding requirements, and the ban on speculative partial
Memory Commits remain unchanged.

## Context

The tier-list search changed "a post I found" into "a post I authored" across
continuations. An Answer presented multiple Candidates without a durable,
explicit inspection subject, and a subsequent first-request timeout could
prevent the model from recording a rejection at all. Distilled model notes
and the current browser page are insufficient evidence of what the user meant.

Relying entirely on terminal model-written memory is simpler but loses user
corrections when that model request fails. Automatically classifying arbitrary
utterances would retain decisions at the cost of inventing user intent. Keeping
whole transcripts would abandon the bounded, distilled Session model.

## Decision

- Reuse objective and constraint Memory Entries, User Observations, Candidate
  identities, and Run Notes. A model Assessment cannot become a user fact
  through summarization, and "keep looking" preserves the user's objective
  and constraints rather than asking the model to reconstruct them freely.
- Retain an accepted correction's exact utterance and its unambiguous
  Inspection Reference before model execution. Retention is not interpretation:
  an unresolved correction survives request failure and takes precedence over
  older Assessments. Resolve it before accepting or presenting an affected
  Candidate again; clarify ambiguity rather than inventing a rejection.
- An Inspection Reference explicitly connects an Answer with the existing
  Candidate it presents for inspection. Inspection commands preserve it; a
  new presentation replaces it, and an objective change or Session end clears
  it. The current browser page alone never creates one. Multiple Candidates
  without a clear subject require clarification before a targeted rejection.
- Candidate decisions retain their objective, decision provenance, and reason.
  A user rejection stands until the user explicitly reopens it. A model
  elimination may be reconsidered when new evidence overturns its rationale.
- A revised constraint continues the same objective: retain its Candidates and
  user rejections, but reconsider model eliminations invalidated by the change.
  A replacement objective does not inherit old rejection decisions, although
  underlying Observations may remain useful. Clarify ambiguous transitions.
- Retain relevant mechanically observed failures without invented causal
  explanations. A vision deadline breach describes the attempt, not permanent
  Session-wide unavailability. Preserve relevant failed Approaches rather than
  making every continuation start the same unsuccessful search again.

## Consequences

The application owns retention, identity, and provenance while interpretation
remains explicit and grounded. This narrows model-only memory authority without
creating a second Session store or a parallel objective identity system.
Rejecting a Candidate is neither rejecting every page currently open nor
globally banning that source from future objectives.

Useful grounded leads may be returned as explicitly unverified Candidates;
their existence is not proof that they satisfy the defining constraints. The
confirmed retry, Run Resolution, and verification policies are in
[Reliable Search Continuation](../search-continuation-design.md). Regression
coverage must span presentation, correction, first-request failure, and a later
continuation; isolated successful-Run tests cannot prove correction retention.
