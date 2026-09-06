# ADR 0036: The round Finalization is entered during is never the bookkeeping Tool Round

## Status

Accepted. Refines the bookkeeping clause of ADR 0027 (#117): "at most one
… bookkeeping Tool Round before one reserved Answer-only model round" stands,
and this decision fixes *which* round that is. It withdraws the executor's
rule (#117/AC3) that a round Finalization was entered during counts as that
round however it ended. ADR 0035's rationale for where the Report Grace sits
depends on this decision and cites it.

## Context

Finalization has one door and two ways through it. A loop-top rail — the
tier budget, the hard ceiling, a deadline that crossed during the model
call — opens it *between* rounds, and the next round begins in Finalization:
it is the bookkeeping Tool Round, acquisition refused, Collection and
Bookkeeping open, the Answer after. A mid-round rail — the no-Progress trip,
a deadline that crosses during tool execution — opens it *during* a round,
and the executor then spent that same round as the bookkeeping round: the
remaining sibling calls were refused with the finalize directive, and the
round's end latched the epoch Answer-only.

That latch was written for the loop-top case, where it is a no-op — a round
that begins in Finalization is already latched when it begins — and its only
live effect was on the mid-round case. There it took the bookkeeping round
away. The round the door opened during was chosen by the model before it
knew, so none of its calls is a checkpoint; and the round after it, the
first one in which the model *could* checkpoint, was Answer-only. #200 found
the consequence while #199 was landing: the Report Grace delivers a worker's
findings into the model's context after a `no_progress` trip, the injected
report ends with a directive saying Bookkeeping remains open, and a model
that obeys it and calls `record_evidence` fails the run — the reserved
Answer round refuses tools. Nothing a rescued worker found could become
Session Evidence on the very stop the grace was built for.

Three shapes were on the table: document the gap and let a mid-round stop's
worker findings reach the Answer but not Session Evidence; make the
runtime checkpoint worker findings itself, with no model round; or give a
mid-round entry the bookkeeping round the loop-top entry already has.

## Decision

- **The bookkeeping Tool Round is the first round that begins in
  Finalization, whatever opened the door.** A round Finalization is entered
  *during* is never it. The trip round ends as it does today — its remaining
  acquisition siblings refused — and leaves the epoch finalizing, not
  Answer-only; the next round is the one bookkeeping round, latched when it
  begins, and the reserved Answer follows. The end-of-round latch goes.
- **The round is optional.** An Answer given in Finalization is the Answer,
  as it always was; the model is given a bookkeeping round, not made to
  spend one.
- **Injected worker reports say only what the next round will honour.** A
  report collected at a Finalization loop top ends, while the epoch is
  finalizing, with an invitation to record an Evidence Checkpoint for any
  finding worth keeping and then answer; once the epoch is Answer-only it
  ends with the answer directive alone and claims nothing about
  Bookkeeping. The trip round's own refusals are unchanged.
- **Session Evidence is the point.** A `no_progress` stop is a run that did
  not finish. Its workers' findings are mostly for the next attempt — the
  Steering follow-up, the retry — and a finding that lives only in a failed
  run's Answer text is gone. The Answer citing them is not enough.
- **Not the runtime's checkpoint.** ADR 0028 has the orchestrator checkpoint
  only relevant findings, and relevance is the model's judgement; a
  deterministic checkpoint would need a grounding rule this decision does
  not want to invent.

## Consequences

- A `no_progress` run may take one model round more than it did, and only
  when the model chooses to checkpoint. The hard ceiling already reserves
  that capacity: a trip in cumulative round 31 makes round 32 the
  bookkeeping round, which is what the reservation is for.
- Steering is unchanged. A Directive still cannot reopen a `no_progress` or
  `hard_limit` stop; a `deadline_reached` opened mid-round can be reopened
  by one exactly as a loop-top one can — the latch that guarded the
  bookkeeping round against a Directive is the one at its beginning, and
  that stays.
- `deadline_reached` behaves the same way whichever side of the model call
  the crossing lands on. Before this it had two behaviours a few hundred
  milliseconds apart.
- The sentence every refusal opens with — "The run's work budget is
  exhausted" — is still false after a `no_progress` trip. That is #201,
  and it is independent of this decision.
