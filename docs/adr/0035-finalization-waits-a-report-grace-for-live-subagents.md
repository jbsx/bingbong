# ADR 0035: Finalization waits a Report Grace for live Subagents

## Status

Accepted. Supersedes the clause in ADR 0027 that records a worker "the Run's
own Finalization cancelled before it reached a cause": Finalization no longer
cancels a worker, so no worker ends without a cause. The reason the wait
sits before the bookkeeping Tool Round holds only because of ADR 0036, which
fixes that round as the first to *begin* in Finalization — before it, a
mid-round entry had no bookkeeping round for the wait to sit before.

ADR 0038 places Report Grace inside a shared Finalization Allowance and suspends
that allowance, including grace, during explicit user Pause. The report-first
ordering and distinction between bounded reports and cancellation stand.

## Context

Entering Finalization — for any cause, through the one door — cancelled every
live Browse Subagent at once. That was tolerable while the causes were the
budget and the shared deadline: the clock or the rounds were spent for
everyone. It stopped being tolerable when the no-progress rail joined the
causes (#126, #159): a `no_progress` trip is the orchestrator's own
accounting, its workers run their own rails, and a worker mid-task may hold
exactly the evidence the run lacks. The 2026-09-06 session (#199) showed it:
at the trip, one worker had a Look placing "The Boxer" in one tier and
"Horizon" in another — enough to eliminate its candidate — and another had
found the 10/10 tier it was sent for and was zooming in. Both were cancelled
within six seconds, neither reported, and the reserved Answer round had
nothing from them. Even for the shared deadline the parent cancelled first,
so a worker never produced the bounded report its own deadline check would
have given it. (#197 removed the false trip that session hit; this decision is
about the true ones.)

Three shapes were on the table for a kept worker: let it run to its own end;
close its acquisition and give it one reserved report round now; take the
deterministic bounded report at once with no model round. And three bounds on
the parent's wait: the shared active-work deadline, which for
`deadline_reached` is already past; one worker round, bounded only by the
client's timeout; a fixed window from Finalization entry.

## Decision

- **Report Grace.** Entering Finalization, for any cause, does not cancel a
  live Subagent. The Run waits a **Report Grace** — 30 seconds from the moment
  of entry, a default beside the tier budgets and deadlines that evaluation
  may tune — and only then calls the model for its bookkeeping Tool Round.
  The wait sits before bookkeeping, not before the Answer, because a worker's
  findings become Session Evidence only through the orchestrator's
  checkpoint, and that round is the last place it can happen (ADR 0028).
- **One report round, under its own cause.** Each live worker enters its own
  Finalization through its own Effort Epoch's door with the new Finalization
  Cause `parent_finalized`: its in-flight call settles, the rest of its
  round's acquisition calls are refused with the report directive — "The
  parent run is finalizing. Tool calls are closed. Reply now with ONLY your
  final report JSON." — and its reserved report round runs. The same shape as
  its own budget exhaustion; a worker with Look results in context turns them
  into findings in one round, where the bounded report, which invents
  nothing, could not.
- **A kept worker always reports.** One that reports within the grace returns
  a Subagent Report. One whose report round is still running when the grace
  ends has that call abandoned and returns the bounded Subagent Report — its
  cause, its last action, the sources it observed. `cancelled` is reserved for
  a decision: the user's Stop, the orchestrator's cancel, a Session Reset.
  Finalization never produces it.
- **Subagent-only cause.** `parent_finalized` is a Finalization Cause a
  Subagent alone can carry. The Run's Answer parser treats it as malformed,
  the way it treats causes the model cannot attest.
- **Bounded is recorded.** The finished-worker diagnostic event and the
  report's hidden provenance say whether the report is bounded — for every
  bounded report, not only a missed grace — so the delegation summary's
  stop-cause breakdown can tell a model-written report from the fallback.
- **The user sees nothing new.** The status stays `acting`, the Run Headline
  stays up, the feed's worker updates carry on. The wait is under a minute
  and a new status would touch the Status Capsule, the Peek Card, and the
  hands-free rules for it.

## Consequences

- A run that has just declared itself stuck or spent may take up to thirty
  seconds longer to answer, in exchange for answering with what its workers
  found. A worker's report round averaged about six seconds in the #199
  session, and a Look or navigate settles in two to three, so the default
  covers one settling call and one report round with margin.
- A Steering replan that reopens work during the grace does not un-tell a
  worker already told to report; it finishes, and the orchestrator may spawn
  fresh ones. A user's Stop during the grace cancels every worker at once, as
  any Stop does.
- The worker's directive and cause sentence join the two the worker already
  has (budget spent, parent deadline passed) in `subagentRunner`; the grace
  clock is the Run's, not the worker's.
- ADR 0027's shared-deadline rule for workers stands: the deadline is still
  taken ahead of a worker's remaining rounds. What changes is that the parent
  no longer races it to the cancellation.
