# ADR 0087: A done Task speaks the block of the page that states what was asked, chosen beside the Verdict

## Status

Accepted on 2026-10-23 by the owner ("add it"), grilled from #401. Amends
ADR 0076 (a done Task now speaks) and ADR 0082 (#394's Where Ask yes
carries the passage too). Of the grill's eight questions, six were decided
by AGENTS.md's widen and ties rules, ADR 0086, CONTEXT.md and the code
beside them; the owner ruled the other two: the whole block is spoken, as
a guess, and #402 (the appliance's own facts) stays a separate issue.

## Context

A question that ended done said nothing. The 2026-10-23 rerun on main
17f82618 ended 5 of 9 question lines done, none spoken (`cli-2-mvkw8yms`,
London on DuckDuckGo, yes 0.98 in 3.7 s); `endLineOf` is silent on a done
of one action and says only "Done." after several (#399). On 2026-10-20
the owner ruled that the main path uses no generating model ("they're
expensive, mostly the temporal cost but also fiscally"). The orchestrator's
Selected Passage (ADR 0069) had chosen a block as evidence for a generating
model; it was removed with the orchestrator (#283) and no code survives.

## Decision

Every Jev call that carries a Verdict also carries a passage Choice: which
block of Text in view, now numbered on the state, states what the user
asked for, or `none`. When the Verdict is a sure yes and the pick is sure,
the Task's Answer is that block, spoken verbatim and whole and shown under
the page title, in place of "Done." or silence. No line is marked as a
question; a line that asked nothing has no block that states it. With no
sure pick the Task ends as it does today; it does not hop on, because a
sure yes already said the page shows what was asked. Text Further Down
stays targets (ADR 0086). A Step with Steps to come speaks its passage at
its own end.

Whether the Choice rides the Verdict's call or is one call after a sure yes
is measured, not argued: both arms are built and gated on passage cases
grown from the rerun's landings, with latency from `perf:report`. The
winning arm and its numbers are recorded here at build time.

## Considered options

- **A generating Answer Writer** given the landing's Page Read: ruled out
  of the main path on 2026-10-20 for its latency and cost.
- **A hop-0 "ask or do" Choice** that turns the passage ask on: a
  judgement made before anything is seen, which closes the road when
  wrong. Asking beside every Verdict is the widest net.
- **One hop deeper when no passage is sure**: argues with a sure yes and
  spends actions.

## Consequences

- No generating model on the main path. An Answer is still never written
  by a model: the words are the page's own.
- Numbering the in-view blocks changes the state every question on the
  call reads. It is a widening and passes the gate on its own before the
  passage counts.
- Recorded as guesses, to be settled by the owner's ear on live runs:
  speaking the whole block (≤300 characters) rather than its first
  sentence; speaking a Step's passage before the next Step.
- Some answer boxes read badly aloud (a run of figures). The words are not
  rewritten; that is a card or page problem for a later report.
