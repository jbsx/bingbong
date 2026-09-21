# ADR 0063: A progressing Run escalates at its round budget as it does at its deadline

## Status

Accepted on 2026-09-21 for #266, grilled from the `fix-263-264` capture
(#263, #264) in the performance-state grill. Extends ADR 0042: the Tier
Escalation the application performs at the active-work deadline is also
performed at the tier's Tool Round budget, under the same Progress test and
the same once-per-Run bound. ADR 0027's budgets and Finalization Causes are
unchanged; ADR 0042 carries a note.

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
search for a fact" and gets 12 rounds. By round 11 the results page linked
the case record the task needed; the Run searched once more, reached 12 of
12, and finalized `budget_exhausted` with seven of eleven facts unsatisfied.
The model may declare a Tier Escalation with evidence and did not, as the
2026-09-07 tier-list session did not three times for the same kind of task,
after guidance written to stop exactly that. The deadline arm never fired
because the Run was nowhere near two minutes.

Reviewer said: "By round 11 the results page already linked the case, yet
the Run searched again instead of opening the case record."

The tier is the model's hypothesis about the work. ADR 0042 lets the
application correct that hypothesis with the one piece of evidence it can
vouch for — Progress — when time runs out. Rounds running out is the same
evidence.

## Decision

- **The round budget arms the Tier Escalation the deadline arms.** When a
  Run's Tool Rounds reach its tier's budget while the current Approach is
  making Progress by ADR 0042's test, the application escalates one tier,
  re-arming the Effort Epoch with the new tier's full budget, warnings and
  deadline. Never above Investigation; reset by a Steering replan; reopening
  nothing else.
- **Without Progress the budget still ends the Run.** A Run whose recent
  rounds made no Progress finalizes `budget_exhausted` as ADR 0027 says. The
  escalation is for work that is landing, not for a Run that is flailing.
- **One escalation per Run, by either arm.** The once-per-Run bound is
  shared: a Run escalated at the deadline is not escalated again at the
  budget, and the reverse.
- **The reason is fixed and the application's.** The Run Plan event for a
  budget-armed escalation carries a fixed reason distinct from the
  deadline's; no model writes or varies it. The Run Trace and the Round Audit
  tell the two arms apart.
- **The budget warning says what will happen.** The 60% budget warning tells
  the model that a progressing Run will be escalated at the budget, so it
  can still choose to finish early.

## Consequences

- A mis-tiered Lookup costs its 12 rounds before the correction, not the
  whole Investigation budget it should have had. The correction is late by
  design: an admission rule on the plan's shape (more than a few Asked Items
  is not a Lookup) was considered and left aside, because it would decide
  the tier from the ask's wording rather than from what the Run found.
- An Investigation at 24 rounds still finalizes: there is nothing above it.
- The #266 capture reports budget-armed escalations per hunt and gates on
  Lookup Runs that end `budget_exhausted` with Progress in their last
  rounds, at zero.

## Relationships

Extends [ADR 0042](0042-a-progressing-run-escalates-at-its-deadline.md)
to the second boundary and shares its Progress test and its once-per-Run
bound. Keeps [ADR 0027](0027-bounded-progressive-browsing.md)'s budgets and
its `budget_exhausted` Cause for the no-Progress case. The tier summaries
and the #216 guidance in the Run Plan prompt are unchanged: the model is
still asked to tier correctly; this is what happens when it does not.
