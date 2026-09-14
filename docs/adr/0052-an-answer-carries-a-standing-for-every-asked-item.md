# ADR 0052: An Answer carries a standing for every Asked Item, and an unverified one makes the Run partial

## Status

Accepted on 2026-09-14 for #250. Not yet implemented. Changes the Run Plan
(one bounded argument), the Answer contract (one structured field), and gives
the runtime authority over one Run Resolution transition. Amends nothing in
ADR 0045's audit or in #245's Answer Retry beyond sharing the retry.

## Context

The second Baseline (#247) verified 4 of 12 initial Hunts. The Round Audit's
top verdict on the initials is now answer omitted, 5 of 12: the Run read the
material, four times recorded it as an Evidence Checkpoint, and the Answer
left it unstated. All three Eurostar initials declared `completed` while
omitting the same check. Every omitted fact was something the command itself
enumerated.

The Itemized Verdict (#242) already states the rule — each named item's
standing, unverified forces partial — but it lives in the static prompt
only. Two wordings moved the Eurostar omission from 3/3 to 1/3, and the next
Baseline read 3/3 again. Today the Answer's relationship to what the Run
holds is asserted by the model in `evidence_ids` and only ever narrowed by
code, never checked for omission.

## Decision

An **Asked Item** is one thing the command explicitly requests be reported.
The model declares the Run's Asked Items in its first Run Plan, at most
twelve, one per reported thing and one per named item under a smallest-change
command; a later Run Plan under the same objective cannot change the list,
and a Steering replan re-declares it. A Lookup or Investigation Run Plan with
none is rejected as Bookkeeping and counted once as a no-Progress action.
Direct Actions declare none. Follow-ups declare their own. Subagents never
do.

The Answer contract gains one structured field: one entry per declared
Asked Item with a standing, `stated` with the statement or `unverified` with
why. A missing or short list, or undeclared items, is a shape failure met
with the one Answer Retry per Run that #245 grants, shared with the
Malformed Answer case; the reply to the retry stands. Any `unverified`
standing under `resolution: "completed"` is overridden to `partial` by the
runtime, recorded in the Stop Record, and costs no round. The Card renders
the list; "speak" is unchanged; a deterministic Answer renders every declared
item `unverified`.

## Considered options

- **Checkpoint-citation coverage**: every Observation the Run recorded must
  appear in `evidence_ids` or the Answer is retried. Rejected on the six
  baseline2 cases: citing an id is not stating a fact, a checkpoint holds the
  model's own claim text and no excerpt, one omission sat in a Run that
  recorded two checkpoints in twenty-four rounds, and one Answer cited the
  excerpt it then reasoned against.
- **A Finalization self-check ledger**: the bookkeeping round lists each held
  Observation as stated, omitted or irrelevant, and an unresolved omission
  refuses the Answer. Rejected: the same model judges itself, which is the
  advisory route #242 exhausted, and it spends a round on every Run.
- **A Notice or a third prompt wording**. Rejected for the same reason.
- **A refusal-and-retry on the resolution**, instead of an override.
  Rejected: it buys a model that writes `stated` where it wrote
  `completed`, at the price of a round.
- **A third standing, `not_applicable`**. Rejected: a moot ask is stated as
  moot, and a third standing is where omissions would go to hide.
- **Declaring at Finalization**. Rejected: a list the model writes after it
  knows what it failed to find is no gate. The first Run Plan is before it
  has found anything to be satisfied with.

## Consequences

- The runtime decides one Run Resolution transition, `completed` to
  `partial`, on a mechanical fact the model itself supplied. It never
  promotes, and it never judges a statement's content.
- Presence and the partial rule are deterministic; what a standing says is
  the model's, as it must be. The rule stops a fact the Run holds from going
  unstated, not a wrong statement.
- The one Answer Retry is shared. A Run whose Answer is both malformed and
  short gets one retry, not two.
- The measurement (#250) reports answer-omitted verdicts and the Eurostar
  initial against baseline2 as targets, and the median Run duration against
  a bound of one round's latency as a closing condition: completeness bought
  with minutes is a different trade the owner should see as a number.
