# ADR 0042: A progressing Run escalates at its deadline instead of finalizing

## Status

Proposed on 2026-09-07, to be implemented in #216. Supersedes the part of ADR
0027 that makes the active-work deadline a terminal boundary; its budgets, its
definition of Progress, and its Finalization Causes are unchanged. ADR 0038's
Finalization Allowance and ADR 0041's verification routes are untouched.

## Context

The tier-list search of 2026-09-07 ran three times. Each Run declared Lookup,
while the model's own reasoning said the task needed Investigation; none
escalated; each was aborted at the two-minute deadline without warning, mid
round, while still making Progress; and each then lost both Finalization
rounds to the same latency, so the user heard only the deterministic Answer.

The deadline was designed as a Finalization boundary (ADR 0027): the point at
which a Run stops acquiring and answers with what it has. That is right for a
Run that has stopped moving. It is wrong for a Run that is moving and chose
too small a tier, and on this model the deadline is the limit that binds at
every tier: 7 to 27 seconds a round against an implied 7.5 to 12.5, so no
tier's round budget can be spent before its deadline. The budget warnings are
round-based, so such a Run is never warned either.

Raising the deadlines would hide the mismatch and make every failed Run
slower. Lowering the active-work rung to save time was measured in #166 to
lose Lookups to wandering. Leaving the choice with the model alone did not
work three times in a row.

## Decision

- **A Run is warned in time.** A third budget milestone fires once per epoch
  at 60 percent of the active-work deadline, by elapsed time, and asks for a
  decision: escalate now with the evidence that justifies it, or finish with
  what you have. It is cleared on re-arm like the round-based milestones, so
  an escalated epoch gets its own.
- **A deadline crossing with Progress is a Tier Escalation, not a stop.** When
  the deadline crosses and the no-progress rail's current Approach is not
  exhausted, the Run rises one tier — once per Run, from any tier below
  Investigation. Progress is the one definition the rail already holds; a Run
  the rail is about to stop for `no_progress` is never rescued by the deadline.
  A second crossing in the same Run finalizes for `deadline_reached` as before.
- **It reuses the re-arm a declared escalation already gets.** The new tier
  starts with its full deadline from zero, its own round budget, and its own
  warnings; cumulative rounds keep counting toward the hard ceiling. The round
  in flight continues under the new deadline rather than being aborted: a model
  round is the scarce thing, and throwing one away to start the next tier is
  the cost this decision exists to avoid.
- **It reopens nothing else.** A spent verification route stays spent: ADR
  0041 reserves reopening for a later Run or a Steering Directive, both of
  which are the user speaking, and the deadline is not. The Finalization
  Allowance is not started, because Finalization was not entered.
- **A Steering replan resets the once.** The user has spoken again, so the
  Run's own spend starts over — the rule the tool budget and the verification
  rail already follow.
- **It is visible in the same places a declared escalation is.** The Run Plan
  event carries the escalation with a source naming the deadline and a fixed
  reason; objective and headline are unchanged. The model is told on its next
  round that the tier rose and why. The user hears one short spoken status
  line, once per Run: this is a voice-first appliance, and a wait that has
  just grown from two minutes to five is something the user is told, not
  something they infer from silence. The line is a status line of the same
  kind as the session-expiry prompt, not an Answer.

## Consequences

A Lookup that is working can now take up to a Lookup and an Investigation's
deadlines before it answers, once. That is the trade: a longer wait for a Run
that is moving, in exchange for not stopping it while it moves. The bound is
still mechanical — one escalation, the new tier's own deadline, the hard
round ceiling — and a Run that stops moving is stopped by the no-progress rail
exactly as before.

What the deadline promises the user changes from "you will have an Answer
within this tier's time" to "you will have an Answer within this tier's time
unless the Run is demonstrably getting somewhere, in which case within the
next tier's". ADR 0027 permitted tuning the deadline's values; this changes
its meaning, which is why it is recorded here rather than as a number.

The tier guidance the model receives gains one sentence — finding a specific
page whose URL you do not know is Investigation work — so the case this
session showed declares the right tier more often and the automatic path is
the backstop, not the norm. Whether a live model honours that sentence is
measured on the corpus (#214), not assumed.

## Relationships

Supersedes the terminal-boundary reading of the active-work deadline in
[ADR 0027](0027-bounded-progressive-browsing.md) and keeps everything else in
it. Leaves [ADR 0038](0038-finalization-has-one-elapsed-time-allowance.md)'s
allowance untouched because Finalization is not entered, and
[ADR 0041](0041-a-failed-check-is-spent-until-something-can-answer-it.md)'s
routes closed because the deadline is not the user speaking. The Finalization
rung (#215) is a separate, reversible decision recorded in CONTEXT.md's Effort
Tier entry rather than here.
