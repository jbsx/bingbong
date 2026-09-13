# ADR 0049: A rail records what it observed, and the audit replays nothing the rail decided

## Status

Accepted on 2026-09-13 for #243, split out of #238 (ADR 0048) by that ADR's
own decision. Changes the Run Trace's shape by one additive record kind and
what the Round Audit's search replay is for; the Search Loop rail's rule,
signatures, tiers and threshold are unchanged. #243 blocks #238's capture,
not its code.

## Context

The Round Audit replays the Search Loop rail's rule over a Run Trace to count
the rounds the rule catches against the reviewer's. The replay sees only what
the trace keeps. A `navigate` search is visible: its URL carries `q=`. A
search typed into a site's own box is a search to the live rail, which
classifies it from the element's facts (`describeRef` → `isSearchInputRef`),
but the trace keeps no element facts, so the replay cannot tell a typed search
from other typing and — because a successful non-inspection call is escape —
resets on it, the opposite of what the rail did.

The live rail did count those searches. On watch baseline-1 the
`search_loop_nudge` Notice fired on round 8 only because rounds 3 and 6 were
typed into the museum's box. The audit's "by the streak rule" count therefore
understates even the rail as it ran, and the number #238 promises to move —
streak-rule rounds against the reviewer's — is navigate-only until the trace
carries the typed half.

Two things already record what a seam saw rather than the facts it saw them
from. ADR 0040 hangs a vision attempt's observation on the `vision_request`
record through an observer. The Vision Budget grant is recorded by the Tool
Round itself, as its own kind, through the trace seam on the tool context:
the round spends it, so the round records it.

## Decision

**The rail records what it observed, as a Search Observation.** When the
rail's `observe` classifies a call as a search, the Tool Round writes a
`search_observation` record to the Run Trace beside the call's tool result,
joined to it by `callId`: the tool name, the query exactly as the rail
classified it (the decoded `q=` string of a navigate, the typed text of a
type), the signature the search ran under — `url` or `input`, the two halves
of the glossary's search signature — and the streak after the call. The rail's
`observe` returns its verdict as a value, the nudge and the observation
together; the round records it through the same seam the Vision Budget uses.
The rail stays pure, with no trace dependency beyond the fault route.

**Searches only.** A call the rail read as inspection or as escape leaves no
record. Both are decided from the tool name and the outcome, which the trace
already holds and which `searchLoopRule.ts` now classifies for rail and audit
alike; the streak on an observation already carries the effect of every reset
between searches. Recording every call would double a Run's record count for
information the trace has.

**A refused or failed search is observed.** The rail advances its streak on a
search whatever the outcome — including one its own gate refused at the cap
and one the Risk Gate refused — and the observation is what the rail did. The
round's audit kind stays what the refusal makes it; the next search's streak
is the rail's, refused searches included, because that is the number the live
rail nudged and refused on.

**The audit trusts the rail, per attempt.** An attempt that carries any
observation takes its search rounds from them — query, signature, streak — and
does not run the replay. An attempt that carries none is replayed as before,
navigate-only. The two cannot mislabel each other: a navigate search the
replay finds is one the rail would have observed on a trace written after
this change, so an observation-free attempt whose replay finds a search is
provably older than the change, and an attempt with no search of either kind
counts zero under both. The report says per attempt which source it read
(`rail`, `replay`, `none`) and the aggregate counts attempts by source.

**Retained digests do not move.** Attempts read by replay produce the digest
they produced before, byte for byte, so no cached judgement re-keys. Attempts
read from the rail show the signature on the search line, which no cache has
seen. The head count (ADR 0048) reads per-call streaks and applies to both
sources unchanged.

**"Surface" keeps its meaning.** The issue called navigate-versus-typed the
surface; ADR 0048 and the Search Intent entry already use surface for the
engine or site a search ran on. The field is the signature, and the glossary
entry says so.

**Subagents record too.** A Browse Subagent's rail is its own instance and its
observations carry its agent id, as every record of its rounds does; the audit
reads the orchestrator's only, as it reads the orchestrator's rounds only.

## Considered options

- **A field on the published tool-result event.** Rejected: a tool result
  reaches the trace as the published `pipeline_event`, which the Session
  projection and the views also receive, and the glossary says the trace is
  never rendered. A diagnosis record is its own kind.
- **The rail writes the trace itself.** Rejected: the rail has never had a
  trace dependency, and the Vision Budget precedent is the round recording
  what its seams decided. A verdict returned as a value is also what the
  rail's tests can pin without a writer.
- **Record the element facts instead, so the audit re-derives the
  classification.** Rejected: the audit would then hold a second copy of
  `isSearchInputRef` and the `describeRef` memo, which is the drift ADR 0048
  just removed from `similarQueries`; and a rail bug would be corrected by the
  replay rather than measured by it. The audit measures the rail as it ran.
- **Infer typed searches from the `search_loop_nudge` Notice.** Rejected in
  ADR 0048: the nudge fires at streak 3 and hides the rounds where a fold
  turns 2 into 3.
- **Record every observed call, tagged search, inspection or escape.**
  Rejected: inspection and escape are derivable, and the audit's replay of
  them is the rail's own code since ADR 0048.
- **Replay anyway and flag rounds where the replay disagrees with the rail.**
  Rejected as the audit's behaviour; kept as a test. The replay exists only
  because the verdict was not recorded, and on navigate-only traces the two
  must agree by construction, which is a test's job to pin, not a report's.
- **A trace format version to mark post-change traces.** Rejected: the
  per-attempt detection rule is sound without it, and a version bump would
  touch every reader for an additive kind that no reader refuses.

## Consequences

- One glossary term, Search Observation, and one clause on the Run Trace
  entry. The reporting doc's paragraph saying the trace keeps no element facts
  now says when the replay runs and when it does not.
- The Run Trace gains one record per search the rail observed. Every existing
  reader tolerates unknown kinds; the Trace UI gains a one-line summary.
- The audit's "by the streak rule" count is the rail's count on every trace
  written after this change, typed and refused searches included. On retained
  traces it is unchanged, and the report says which attempts were read which
  way.
- #238's capture becomes honest: its three-pass set carries observations, so
  the streak-rule-versus-reviewer pair counts the typed half. The two issues
  share that set.
- A rail bug now reaches the audit as a wrong streak rather than being masked
  by a correct replay. That is intended: the audit's question is what the rail
  did.

## Implementation notes

- The observation is built where the rail already knows the classification:
  `observe` in `searchLoopRail.ts` returns `{ notice, observation }` in place
  of the bare nudge string; the round owes the notice as it did and records
  the observation through the tool context's trace seam, as `visionSeam.ts`
  records a grant.
- The record kind joins `RunTraceEventBody` in `runTrace.ts`; nothing else
  enumerates kinds except the Trace UI's summary switch.
- In `audit.ts` the source switch sits before the per-call replay: collect the
  attempt's observations by `callId`; if any exist, each search round's
  `search` comes from its observation and the replay's streak state is never
  consulted; else the existing replay runs. `searchSource` lands on
  `AuditMechanical` beside `searchLoopHeads`, outside the digest.
- The audit fixture builder gains the record for post-change fixtures; the
  retained baseline and fix-235 sets are the regression for the replay path.
