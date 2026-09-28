# ADR 0028: Grounded evidence may outlive the Run that found it

## Status

Accepted. ADR 0039 extends this decision with pre-model retention of user
corrections, explicit Inspection References, and objective-scoped Candidate
decisions; retaining an utterance does not assert that it has been interpreted.

Note of 2026-09-14 (#246): the display boundary that keeps internal
identities out of an Answer (#122) deleted the token and tidied the
punctuation around it. In fix-240-1's Eurostar initial the model wrote three
Memory Entry ids into its prose; the user read a sentence with three holes
and no sign of them, and nothing recorded that the boundary had acted. An id
the model writes into the Card or the Spoken Rendering is an Identity Slip.
Where a Card's id names a Session Evidence Observation the boundary now
substitutes a link to that Observation's first reference — its title, else
its host — or a fixed phrase for a User Observation; an id it cannot resolve,
a Run Observation id among them, is still deleted, and the Spoken Rendering
only ever deletes, since a spoken citation is noise. The substitute does not
enter the Answer's declared support: the Answer Evidence Summary reflects what
the model declared, and a slip may not rewrite the grounding. Every slip
leaves a Run Trace record so the Round Audit can count them. A retry round was
considered and refused: a Finalization round is a high price for a cosmetic
loss, and the count now says whether the model slips often enough to pay it.
The Subagent Report is model-facing and outside the boundary. The prompt,
which already forbids the id twice, is untouched.

Note of 2026-09-28 (#300): the boundary of #246 reached the Card's text and
the Spoken Rendering and nothing else the Answer renders. The Asked Items
ride the same display and were printed as written: in 7 of the 339 retained
Cards that list them a statement carried an id, 31 ids in all, none recorded
(`fix-263-264-2`'s Voyager initial ends three statements on `(memory-5)`,
`(memory-4)` and `(memory-3, memory-2)` under a Card text with none). An
Asked Item's name and statement are now renderings of the Answer. The id is
removed, never substituted: a statement is plain text, and the Answer
Evidence Summary beside it already shows the sources. Removal takes a range
(`memory-1..6`) whole and the brackets it leaves empty with it. Each is
recorded as a slip on a surface of its own and counted with the others,
forward from the Run Trace version that adds it; the seven are not
recounted. The Subagent Announcement is a rendering too, made from a
model-facing report, and is repaired by removal: none of the 54 retained
carried an id, but a Subagent is shown Memory Entry ids and told to cite
them. It records no slip, since it is spoken outside any Run's trace. Three
things stay outside on purpose. The report shown whole on the Subagent's
card is the model-facing text. The account of a Run's work, its reasoning
and tool calls, is read by its ids. And the streamed Answer is never drawn:
the Feed shows that an Answer is being written, not its text.

Note of 2026-09-27 (#284): [ADR 0071](0071-two-observations-from-one-address-are-not-presumed-to-disagree.md)
reverses the contradiction handling below. Two Observations from one address
are not presumed to disagree, no pair is retained, and the Memory Compaction
sentence's unresolved contradictions no longer exist. Exact duplicates still
merge.

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
