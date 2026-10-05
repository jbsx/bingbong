# ADR 0074: An Answer's Card is published when its fields are written, and the Answer Tail is never waited for

## Status

Accepted on 2026-10-05 for #313, grilled the same day from the Round Audits
of `main-4dc72e9` and the code on main at 2d2900e, with every recommendation
taken. Amends the Answer contract. Not built: the work is #318 (the
measurement), #313 (the Asked Item entry) and #319 (the early Card), and no
capture has been run.

## Context

The round that writes the Answer is the dearest round of a Run. On
`main-4dc72e9`, 18 Runs and 21 Finalization-class rounds:

- **It writes a median 2,138 output tokens and takes a median 27.7 s.**
  Reasoning is not the main cost: three rounds that reasoned under 100
  characters took 19.7 to 27.7 s.
- **The Answer has not grown.** Against `fix-270` its parts are the same
  size: `display` 2,617 characters against 2,569, `asked_items` 1,415
  against 1,444, `speak` 299 against 277.
- **Half the round cannot be attributed.** `display`, `asked_items` and
  `speak` come to about 1,075 tokens at four characters a token. The Run
  Trace keeps no Answer as the model wrote it, so the Run Note, the memory
  patch, the Answer Checkpoints and the object's keys are unmeasured.
- **The owner's target was a Finalization round under 10 s.** At that
  capture's speed, a 4.6 s first token and 81 tokens a second, 10 s is
  about 430 tokens for the whole round. The Card alone is about 650.

What the code does, on main at 2d2900e:

- Only `speak` and `display` are required. `speak` is held to two
  sentences; nothing bounds `display` or an Asked Item's statement, and no
  request sets a token limit.
- The prompt asks for a named item's standing twice: in `display`, by the
  Itemized Verdict, and in `asked_items`, one statement an item. The Card
  shows both. Each entry is also asked to repeat its item's wording, which
  the application holds and, since #311, the entry's number identifies.
- No sentence gives the fields an order. The model follows the example
  object: `speak`, `display`, `run_note`, `memory_patch`, and after them
  `evidence_ids` and `asked_items`.
- The Card is published when the whole object has parsed and the Asked
  Items are covered. It is made from `display`, `evidence_ids`,
  `inspection_candidate_id` and `asked_items`. Everything else is used
  after the Card and the speech, and the user waits on none of it.
- Since #312 the spoken sentence is heard when it closes in the stream,
  about 75 tokens in. The Feed's live stream still shows that sentence.
- The live reviewer grades the `display` text alone.

## Decision

- **Ten seconds is not a target for the end of the Answer round.** What the
  user hears is #312's. The round is judged in output tokens, and on when
  the Card is shown.
- **The Card keeps its length.** No cap, no length by Effort Tier and no
  guidance on `display`. An Answer that leaves an asked fact out fails, and
  no Answer is limited.
- **An Asked Item entry names its item by number and states the established
  value.** The prompt no longer asks for the item's wording. A `stated`
  entry's statement is a phrase, not a sentence; an `unverified` entry
  keeps its reason. This is prompt guidance, with no cap in code, and an
  entry written the old way is read as before.
- **`display` stays self-sufficient.** It still states each named item's
  standing, because the reviewer reads nothing else.
- **Field order is part of the Answer contract.** The Card's fields come
  first: `speak`, `display`, `evidence_ids`, `inspection_candidate_id`,
  `asked_items`. The Answer Tail follows: `resolution`,
  `finalization_cause`, `run_note`, `memory_patch`, `mishear_proposals`,
  `checkpoints`.
- **The Card is published when its fields have closed in the stream.** An
  Answer of a Run that declared Asked Items publishes when `asked_items`
  closes; one of a Run that declared none, when `display` and the key after
  it have closed.
- **The Card's checks run there, on the Card's fields alone**: the
  Malformed Answer, the Off-language Answer, the Identity Slip repair and
  the Asked Items' coverage. A failure acts as it does today, with the
  Answer Retry or the list-only retry, and no Card is published early.
- **A shown Card stands**, as a spoken sentence stands under #312. When the
  round is cut, the transport fails or the JSON breaks inside the Answer
  Tail, each Tail field falls back as a missing one does today: the
  deterministic Run Note, no memory patch, no Answer Checkpoints, no
  mishear proposals, and a Run Resolution the application derives from the
  Asked Items and the Finalization Cause. No Answer Retry is spent. The
  fallback is logged as a continuity degradation and counted.
- **An Answer out of field order is published at the object's end**, as
  today, and counted. Only an on-contract Answer in order takes the early
  path.
- **The Run Trace keeps the reply text of every round read as an Answer.**
  The Round Audit reports each final Answer by field, in characters, from
  that text. Reported, never gated.

## Considered and refused

- **A cap or a per-tier length on `display`.** It trades the Answer's
  completeness for seconds the user no longer hears.
- **Dropping the statement of a `stated` entry.** The Card shows the list
  and the standing decides the Run Resolution; a `stated` claim would have
  nothing beside it.
- **`display` leaving the standings to the list.** It is the larger cut,
  and it changes what the reviewer must read, which breaks comparison with
  every earlier capture. Filed as #320 for its own grill.
- **A second model call for the Answer Tail.** It pays another first token,
  a median 4.6 s, and a second request to save the reader nothing the
  field order does not.
- **An Answer Retry when the Answer Tail fails.** It would replace a Card
  the user is reading and write the whole Answer again to recover a note.
- **Recording field sizes instead of the text.** Sizes answer the split
  and nothing after it; how much of a statement repeats `display` needs the
  text.
- **Deciding the cuts before measuring.** Only the two duplications with
  no reader were decided now. Half the round is unattributed, so anything
  further waits for #318.

## Consequences

- The Card can be on screen while the model is still writing. A Run's
  Resolution, its Run Note and its Memory Commit settle after the user has
  read the Answer, and a later failure changes none of what was shown.
- A Run whose Answer Tail fails keeps a deterministic Run Note and loses
  its memory patch and its Answer Checkpoints. The audit's count shows how
  often.
- The model must write the fields in order to gain anything. One that does
  not loses nothing it has today.
- `earlySentence.ts` relied on `speak` being the first key by the example
  alone; the order is now stated.
- The Feed's entry for an Answer changes once more after it appears, when
  the Answer Checkpoints are recorded, as ADR 0072 already has it.
- The reviewer's input is unchanged, so the captures stay comparable.

## The capture

`fix-311-312`, three passes, is owed to #311 and #312 and is started by the
owner. #318 lands before it, so it is also the measured base here. #313 and
#319 are then judged on one later capture of three passes against it.

| Gate | `main-4dc72e9` | Bar |
|---|---|---|
| Median output tokens per Finalization-class round (#313) | 2,138 | lower than `fix-311-312`; set by the owner once that capture is audited |
| Initials verified | 8 or 9 of 12 in earlier captures | not worse than `fix-311-312` |
| `answer_omitted` | as audited | not worse than `fix-311-312` |

Round start to the Card, Cards published early, Answers out of field order
and Answer Tails that fell back are reported for #319 and never gated.
Seconds a round are reported and never gated: they moved 9 to 14 s between
night and day captures on the same tokens.

## Relationships

Amends the Answer contract that [ADR 0072](0072-an-answer-carries-its-own-checkpoints-so-no-round-is-spent-recording-before-it.md)
last amended; Answer Checkpoints are still recorded after the Card, and
their cap of six is unchanged. Follows the #312 note on
[ADR 0034](0034-an-off-contract-reply-in-a-reserved-round-is-a-failed-round.md):
a spoken sentence stands, and now a shown Card does. Leaves the reasoning
inside the round to #314, what a hard failure may say to #315, and the
Itemized Verdict's place in `display` to #320.
