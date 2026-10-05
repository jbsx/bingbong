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

Amended on 2026-09-15 by ADR 0057 (#256): the bookkeeping share is measured
twice over — ten seconds of silence before the round's first token, then ten
more from that token — never past the reserved Answer's protected floor. The
sixty seconds and the three shares stand.

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

## Notes

- 2026-09-25 (#271, [ADR 0066](0066-a-transport-failure-is-retried-once-and-a-second-is-a-finalization-cause.md)).
  A model round whose request and its one Transport Retry both failed at
  the transport enters Finalization under a new cause, `model_unreachable`,
  rather than `deadline_reached`. The #219 client timeout reused the
  deadline's cause because a cut is a cut whichever timer fired; a request
  that rejected in under a second crossed no deadline, and recording one
  would be the substitution this ADR forbids: the Stop Record would answer
  a later "why did you stop?" with a limit that was never reached. The new
  cause changes nothing else here — the allowance, its shares, the
  reserved Answer and the deterministic fallback run as for any cause, and
  a transport failure inside Finalization keeps the handling its round
  already had.

- 2026-10-05 (#315, grilled from the 423 live Runs retained). The last
  Decision bullet — limits and provider errors stay in diagnostics — is the
  rule the owner restated while grilling #312: the user never has to deal
  with the application's limits or errors. It was already written here; it
  leaked. The deterministic Answer named no bound, but 24 of 156
  model-written Answers on Runs that did not meet their objective named the
  stop ("before the budget closed"), 15 of them in speech, and 22 more
  carried internal names; every Asked Item of a deterministic Answer read
  "not established before the run stopped" (100 items in 15 Runs); and 3
  Runs that failed outright spoke "I could not finish that request." with
  the raw provider error as a Feed line and no Card.
  - **The test.** A sentence may be said if it would still be true and mean
    something had a person done the research by hand. "I could not open the
    catalogue record", "the thread is behind a check I could not pass" and
    "the collections search is down" pass, and so does "this run" used as
    "this time". The application's bounds (time, budget, rounds, "before the
    run stopped") and its internal names and tooling (`memory-N`, Session
    Evidence, a subagent, a tool's error) do not.
  - **Its reach.** The Spoken Rendering, the Card, the Peek Card, a
    Subagent Announcement and every top-level Feed line. The raw error line
    leaves the Feed; the run hint and the Peek Card no longer count model
    retries; a voice failure shows "Something went wrong." without the
    error. The per-Run expander is the opened record of tool calls and is
    left as it is. The Tier Escalation line stays (it reports that work
    continues, not that a limit was reached), a Blocker still reaches the
    user, and the Stop Record still answers a direct "why did you stop".
  - **A Run that fails outright ends on the deterministic Answer**, as ADR
    0027 promised of a failed reserved round: what it found so far, or that
    it has nothing to show. No model round is tried and no Finalization
    Cause is invented; the outcome stays `failed` and the failure stays in
    the Stop Record. After a sentence spoken early nothing more is spoken
    (ADR 0034, #312). These Runs now count in `deterministicAnswer`.
  - **Product-owned texts.** The Asked Item text is "not established". A
    Subagent stopped at a bound or failed is announced by the opening
    alone. A `memory-N` token is deleted from the Spoken Rendering, the
    Card and Asked Item statements: it is an exact token with no ordinary
    meaning, so a deletion cannot misfire.
  - **Model-written Answers are not checked in code.** The words involved
    are ordinary English a user's own topic can carry (a keyword sweep made
    121 false hits against 45 true ones), an Answer Retry would spend 15–20
    s of the allowance, and deleting the sentence would take its accurate
    half. The cause is treated instead: the Answers repeat the Finalize
    Instruction's words, so for `budget_exhausted`, `deadline_reached`,
    `hard_limit` and `model_unreachable` it opens on one sentence naming no
    bound, and "state honestly what was and was not completed" becomes "say
    what you established and what is still unverified", there and in the
    system prompt. `blocker` and `no_progress` keep their reasons; the
    mid-Run warnings and the Stop Record keep the real cause. The Round
    Audit counts Answers that name the stop, reported and never gated; a
    check is the next step only if that count does not fall.

- 2026-10-05 (#323, implementation of the note above). The Finalize
  Instruction's opening for `budget_exhausted`, `deadline_reached`,
  `hard_limit` and `model_unreachable` is one sentence, "No further
  acquisition is possible in this run" (`ACQUISITION_ENDED_REASON`), on
  every carrier: a closed tool's refusal, the Notice on a bookkeeping
  result, an injected Subagent Report and the Finalization request.
  `no_progress` and `blocker` open as before. The closing is one text
  (`ANSWER_CLOSING`), "say what you established and what is still
  unverified": in the four Finalization texts, the directive of the action
  that exhausts the second Approach, the worker's three finalize texts, the
  system prompt's line for a failed Run and the shared policy's
  Finalization sentence, which read "when a notice says the work budget is
  spent" and now reads "when a notice says to finalize", since no notice
  to the Run's model says so any longer. The worker's finalize notice keeps
  its reason ("Your delegated work budget … is spent", "The parent run's
  active-work deadline has passed"): its report goes to the orchestrator
  and never to the user. The mid-Run warnings, the Stop Record's detail
  sentences and the Run Trace are unchanged.
  - **The counter.** The Round Audit's `answerNamings` reads the last
    model-written Answer the user met — the Spoken Rendering, the Card and
    the Asked Item statements — against a phrase list for the stop and the
    bound, and a second for internal names, and lists each hit with the
    words around it. The base over the 71 capture sets on disk: 22 of 152
    Answers on a Run that did not end `objective_met` name the stop (the
    hand count was 24 of 156), and 0 of 254 on a Run that did; 5 of 69 from
    fix-260-262 on. A set family's own number is in
    `docs/live-web-reporting.md`. The list also reads the new opening,
    should an Answer repeat it. Reported, never gated.
