# ADR 0039: User corrections and Candidate decisions retain their scope

## Status

Accepted on 2026-09-06, implemented in full on 2026-09-07: objective continuity
(#206), Inspection References (#210), objective-scoped Candidate decisions
(#208), and correction retention across a failed first request (#211). Extends
ADR 0028's distinction between User Observations, Assessments, and Candidates.
Session lifetime, source-grounding requirements, and the ban on speculative
partial Memory Commits remain unchanged.

ADR 0043 (accepted 2026-09-07, #218) amends the second boundary below: an
inherited correction is handed on once and lapses with the Run it was handed
to, and the bound of five is replaced by that rule. The "both wait" case it
argues for is given up there, with the captures that showed its price.

Two boundaries #211 settled, because the Decision below does not fix them:

- *Whose* words are retained. Every continuation command is retained verbatim,
  because deciding which utterances are corrections is the interpretation this
  ADR keeps out of the application. A Session's opening command retains
  nothing — there is no earlier work to correct — and a rejected or busy
  submission is not an accepted Run and mutates nothing.
- *What discharges* a retained correction. A Run resolves the words it was
  itself admitted with by answering: producing a model-written Answer is what
  it means to have addressed the user's latest command. Words inherited from a
  Run that never answered are a debt, discharged only by grounding — a
  Candidate decision the Session retains, or the objective or constraint those
  words revised. Until then the Candidate they name is neither presented again
  nor settled on the model's own authority. Because a User Observation is
  grounded against the events of the Run that heard it, the Session
  checkpoints an inherited correction's exact words itself, under that Run's
  provenance, as it hands them on — otherwise no later Run could cite the very
  words it is required to act on.

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

What the application enforces about an unresolved correction is mechanical:
the Inspection Reference is refused, and no Candidate decision is retained on
the model's own authority. An Answer's prose is still the model's own, so
"do not tell them it is ruled out" rides the orchestrator prompt rather than a
gate — the deterministic half holds because a rejection exists only as a
retained decision, and an unresolved correction is not one. Retention is also
bounded: five unresolved corrections per Session, oldest evicted. Only words
that outlived a Run that never answered accumulate, so reaching that bound
means five consecutive Runs failed to answer.
