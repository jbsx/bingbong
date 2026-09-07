# ADR 0038: Finalization has one elapsed-time allowance

## Status

Accepted on 2026-09-06. Refines ADR 0027's Finalization deadline exemption,
ADR 0035's Report Grace timing, and ADR 0036's optional bookkeeping
opportunity. The active-work deadline remains distinct from the Finalization
Allowance; bounded acquisition and worker report semantics stand.

The outcome-first stopping decision — the last of the Decisions below, with
the Stop Record that makes an explicit "why did you stop?" answerable —
shipped on 2026-09-06 (#203). The unsettled-action boundary — a Stop that ends
the Run's wait while the action's browser resource stays withheld until it is
observed to end — shipped on 2026-09-06 (#205); Answer-side disclosure of an
uncertain outcome arrives with the allowance that needs it. Bookkeeping
recovery shipped on 2026-09-06 (#207). The Finalization Allowance itself and
its Pause interaction shipped on 2026-09-07 (#209): sixty seconds from entry,
the three shares scaling together under one test/e2e override, a cutoff at
which the Run lets go of an action it is still waiting on, and a Steering
replan that drops the allowance rather than leaving it ticking against
reopened work. Every Decision below is now implemented.

## Context

The tier-list search ended with two consecutive two-minute model requests and
no tool execution. The first request crossed the active-work deadline; the
following bookkeeping request could fail before the reserved Answer's fallback
protection applied. With no tool results, the model also received no standalone
Finalization instruction. A round-count limit did not bound the user's wait or
guarantee an Answer through every Finalization failure.

Independent request limits preserve more chances for model-written evidence
and Answers, but can accumulate into minutes after useful work has stopped.
Immediate deterministic fallback would bound the wait but discard the chance
to checkpoint timely worker reports and synthesize a better Answer.

## Decision

- One Finalization Allowance runs from entry until the Card is available. Start
  with 60 seconds total: up to 30 seconds of Report Grace, up to 10 seconds of
  bookkeeping, and a protected 20 seconds for the reserved Answer. Earlier
  savings remain available to the Answer. These are tunable starting defaults,
  not measured optima; retries share the limits instead of restarting them.
- Explicit user Pause suspends the allowance, including the grace time it
  contains. Stop takes precedence. Speech playback is outside the allowance.
  Report Grace still precedes bookkeeping and ends early when workers settle.
- Inform the model explicitly when Finalization begins, including when there
  is no tool-result history. Do not depend on a later tool result to deliver
  the instruction that acquisition has ended.
- Bookkeeping is one optional opportunity. Its request failing must not reopen
  acquisition, repeat bookkeeping indefinitely, or escape as a raw error.
  Advance to the reserved Answer within the remaining allowance, or return the
  deterministic grounded Answer when no opportunity remains. Accepted Evidence
  Checkpoints survive; no speculative Assessment is committed by fallback.
- A non-interruptible action cannot postpone the Card indefinitely. Disclose
  uncertain action outcomes, exclude late results from the finalized Answer
  and its continuity, and keep the action's browser resource unavailable to
  new actions until it settles or is safely isolated. Answer availability and
  safe resource reuse are separate boundaries.
- Preserve the original Finalization Cause. A later bookkeeping or Answer
  failure is additional diagnostic information, not a replacement entry cause.
  The Run retains all three separately in its Stop Record — the entry cause,
  that cause's specifics, and any later failure — in the Run Journal it
  already carries, so a later explicit "why did you stop?" is answered from
  bounded Session continuity rather than a second diagnostic store.
- Model-written and deterministic Answers describe grounded task progress,
  uncertainty, and actionable external blockers. Resource limits and provider
  errors stay in diagnostics by default, but are explained truthfully when
  the user explicitly asks why work stopped. Never imply exhaustive search,
  continuing background work, or a resolved rejection that was not retained.

## Consequences

Bounded, honest task output takes precedence over waiting indefinitely for a
better model Answer. Some timely but uncheckpointed work may not enter Session
Evidence when the allowance is spent; the fallback cannot invent its relevance.
The allowance does not authorize unsafe resource reuse or conceal a failure to
verify the result. Deterministic timing, failure-path, late-result, and output
tests can prove these guarantees without a paid live-model run.

The confirmed scope and verification boundary are in
[Reliable Search Continuation](../search-continuation-design.md).
