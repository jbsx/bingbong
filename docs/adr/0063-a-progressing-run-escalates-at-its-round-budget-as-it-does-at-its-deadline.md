# ADR 0063: A progressing Run escalates at its round budget as it does at its deadline

## Status

Accepted on 2026-09-21 for #266, grilled from the `fix-263-264` capture
(#263, #264) in the performance-state grill. Extends ADR 0042: the Tier
Escalation the application performs at the active-work deadline is also
performed at the tier's Tool Round budget, under the same Progress test and
the same once-per-Run bound. ADR 0027's budgets and Finalization Causes are
unchanged; ADR 0042 carries a note.

Amended on 2026-09-21 by the #266 implementation grill, before any code:
the Context's account of round 11 is corrected against the trace; the
Decision gains the decline record, the Notice's last sentence and the
placement of the warning sentence; the Consequences restate the capture
gate. The re-armed budget's clamp against the hard ceiling is ADR 0042's
note, since it corrects both arms.

## Context

ADR 0042 made the active-work deadline a decision point instead of a wall:
a Run whose current Approach is still making Progress when the deadline
crosses is escalated one tier, once, rather than finalized. The Tool Round
budget kept its ADR 0027 reading — a terminal boundary. That asymmetry was
not a decision; nothing in the #216 grill weighed it, because the deadline
was the boundary the manhwa sessions had crossed.

The live-web capture crossed the other one. Longitude, pass 2 of
`fix-263-264`: the Run Plan at round 1 declared Lookup for an ask that names
two catalogue records and nine Asked Items. A Lookup is "one page or one
search for a fact" and gets 12 rounds. The Run read the H4 record in rounds
3 to 5, including its Parts field naming the carrying case, then spent
rounds 10 to 12 on two searches for that case with a scroll of the results
between them, reached 12 of 12, and finalized `budget_exhausted` with seven
of eleven facts unsatisfied. The case record it already knew of was never
opened. The model may declare a Tier Escalation with evidence and did not,
as the 2026-09-07 tier-list session did not three times for the same kind
of task, after guidance written to stop exactly that. The deadline arm never
fired because the Run was nowhere near two minutes.

Reviewer said: "By round 11 the results page already linked the case, yet
the Run searched again instead of opening the case record."

Correction from the trace (2026-09-21): the round-11 scroll surfaced links
to the H4 mainspring fragments and to K1, not to the case. The case was
known from the H4 record's Parts field, and its record was never opened.
The reviewer's reading of the Run — progressing, yet not opening a record
it knew — stands; the sentence's detail does not.

Reconstructed against the no-progress rail, the Run would have passed ADR
0042's Progress test at round 12: round 9's end-of-page scroll exhausted one
Approach, and round 10's navigate to a fresh results page reset it. The
audit's reviewer called rounds 10 to 12 a Search Loop; the runtime loop
rule, which nudges at a streak of three, never fired at two. A fresh results
page is Progress to the rail, reworded or not — which is why this decision
does not let the Search Loop rule veto the arm: had it, the Run this
decision is built on would not have escalated.

The tier is the model's hypothesis about the work. ADR 0042 lets the
application correct that hypothesis with the one piece of evidence it can
vouch for — Progress — when time runs out. Rounds running out is the same
evidence.

## Decision

- **The round budget arms the Tier Escalation the deadline arms.** When a
  Run's Tool Rounds reach its tier's budget while the current Approach is
  making Progress by ADR 0042's test, the application escalates one tier,
  re-arming the Effort Epoch with the new tier's budget, warnings and
  deadline. From any tier below Investigation, never above it; reset by a
  Steering replan; reopening nothing else. The test is the no-progress
  rail's alone: no other rail vetoes it, and an epoch with no rail to vouch
  for Progress (a Browse Subagent, a lean pipeline) keeps its terminal
  budget as ADR 0042's note keeps its terminal deadline.
- **Without Progress the budget still ends the Run.** A Run whose recent
  rounds made no Progress finalizes `budget_exhausted` as ADR 0027 says. The
  escalation is for work that is landing, not for a Run that is flailing.
- **One escalation per Run, by either arm.** The once-per-Run bound is
  shared: a Run escalated at the deadline is not escalated again at the
  budget, and the reverse. A Tier Escalation the model declared does not
  spend it; the Investigation ceiling bounds that Run. When budget and
  deadline are both spent in the same check, the budget arm is the one
  that fires, matching the Finalization precedence a coincidence already
  has.
- **The reason is fixed and the application's.** The Run Plan event for a
  budget-armed escalation carries a fixed reason distinct from the
  deadline's; no model writes or varies it. The event names its arm, and
  the Run Trace and the Round Audit tell the two arms apart. The user hears
  the same one status line per Run the deadline arm speaks, and the model
  is told on its next round that the tier rose and why — with one sentence
  the deadline's Notice lacks: if the objective is already met, finish now.
  A Run escalated one fact short of done is not wrong to escalate, but it
  is told it may stop.
- **A refusal is recorded.** When a budget or a deadline is reached and no
  escalation follows, the Finalization carries the reason — no rail, no
  tier above, once spent, hard ceiling, no Progress — as that cause's
  specifics: in the Stop Record, and on the trace's Finalization entry the
  audit reads. The arm's silence is a fact of the Run, not an absence.
- **The budget warning says what will happen.** The two round-based budget
  warnings tell the model that a Run still making progress when its budget
  is spent rises one Effort Tier, once, and that one that is not is ended.
  The 60% warning is by elapsed deadline and already asks for a decision;
  it is unchanged.

## Consequences

- A mis-tiered Lookup costs its 12 rounds before the correction, not the
  whole Investigation budget it should have had. The correction is late by
  design: an admission rule on the plan's shape (more than a few Asked Items
  is not a Lookup) was considered and left aside, because it would decide
  the tier from the ask's wording rather than from what the Run found.
- An Investigation at 24 rounds still finalizes: there is nothing above it.
- A Lookup that is nearly done when its budget is spent — the Eurostar
  luggage initial of the same capture reached 12 of 12 with ten Progress
  rounds and one fact unsatisfied — is escalated too. Its Notice tells it
  it may finish; the pooled Run median is the check that it does.
- The #266 capture gates on wiring, not on the arm's effect: every Run
  below Investigation that ends `budget_exhausted` carries a decline
  reason, and none is declined for no Progress while the rail's own record
  says otherwise. Budget-armed escalations are reported per hunt, beside
  the audit's independent replay of the round before each, and declines
  are reported by reason; none is gated. Task Success is read pooled with
  `fix-263-264` and `baseline3`, the Run median held as no regression. The
  "last three rounds carried Progress" gate first written for this issue
  was dropped: the rail holds a state, not a window, and by the audit's
  replay it would have excluded the longitude Run itself.

## Relationships

Extends [ADR 0042](0042-a-progressing-run-escalates-at-its-deadline.md)
to the second boundary and shares its Progress test and its once-per-Run
bound. Keeps [ADR 0027](0027-bounded-progressive-browsing.md)'s budgets and
its `budget_exhausted` Cause for the no-Progress case. The decline reason
rides the Stop Record as ADR 0037's Blocker wall does. The tier summaries
and the #216 guidance in the Run Plan prompt are unchanged: the model is
still asked to tier correctly; this is what happens when it does not.
