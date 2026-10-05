# ADR 0074: An Answer's Card is published when its fields are written, and the Answer Tail is never waited for

## Status

Accepted on 2026-10-05 for #313, grilled the same day from the Round Audits
of `main-4dc72e9` and the code on main at 2d2900e, with every recommendation
taken. Amends the Answer contract. The work is #318 (the measurement),
#313 (the Asked Item entry, built on 2026-10-05) and #319 (the early Card,
built on 2026-10-05); #318 was built on 2026-10-05, after the `fix-311-312`
capture it was meant to precede, so that capture's traces keep no reply.

Note (2026-10-05, #318): what building the measurement settled.

- The Run Trace is version 14 with one record, `answer_reply`: the round,
  the reply as the model wrote it, the parser's shape, whether the round
  was reserved, and how the pipeline read it: `accepted`, `held` (the
  Answer a list-only retry kept), `list_only`, `malformed`, `off_language`,
  `asked_items` (a prose reply asked for the whole Answer again) or
  `off_contract`. The reply is kept whole up to 64,000 characters.
- Three Answers leave no record. A Card that stood for a round that was cut
  or ended with tool calls: no reply landed as an Answer. The deterministic
  Answer: no model wrote it. An Answer a Steering replan let go before it
  was read.
- The Round Audit splits the last reply read `accepted` or `held`. `speak`,
  `display` and `run_note` are the text of the string; the `item` wording
  and the statements are summed over the entries; `evidence_ids`,
  `memory_patch` and `checkpoints` are the value as JSON. The remainder is
  the rest of the reply as written: keys, the other fields, the rest of
  each `asked_items` entry, string escapes and whitespace. A list-only
  reply is not in the split. A Run with no reply to split reads so, and a
  trace below version 14 reads "not recorded".
- A Finalization-class round is a round the audit filed as Finalization
  that reported its usage. Over the 18 Runs of `main-4dc72e9` the median
  is 2,138, as above. The Fix Ledger's line is per population, as every
  counter there is: 2,201 on initials and 2,056 on follow-ups for
  `main-4dc72e9`, 2,612 and 2,907 for `fix-311-312`.

Note (2026-10-05, #313): what building the Asked Item entry settled.

- Four texts changed and nothing that reads an entry: the Answer contract's
  `asked_items` sentence, its example object, the Run Plan acknowledgement
  and the Answer Retry's description of an entry, list-only or whole. Each
  asks for `n`, the standing and the statement.
- The contract no longer says how an entry carrying `item`, or one without
  `n`, is read. Both are read as before, and unit tests pin the parse, the
  match, the merge and the settled list for each; saying so in the prompt
  would ask for the wording again.
- The one example of a `stated` statement is "£4.20", in the contract's
  sentence. The acknowledgement and the Answer Retry say "the established value
  alone" and carry no example.
- The Card names each entry from the declared list, as it did.

Note (2026-10-05, #319): what building the early Card settled. #318 and
#313 are separate work, and no capture has been run.

- The Card's fields are known to have closed at one of three points:
  `asked_items` closes, a key that is not one of the Card's opens, or the
  object ends. `display` closing is not enough, since `evidence_ids` or
  `inspection_candidate_id` may follow it. A Run that declared no Asked
  Items therefore publishes when the first key of the Answer Tail opens,
  which is no later than that key closing.
- An Answer is in field order when `speak` and `display` open the object
  and the Card's other fields follow in the contract's order before any
  other key. The order inside the Answer Tail is not read.
- No Card is published early in a reserved round, an Answer Retry round or
  a list-only retry round, as no sentence is spoken early there. This was
  the reading #319 asked to be confirmed.
- A Card published early ends the Run when its round is cut or its request
  fails for any reason, not only at the transport: no bookkeeping round and
  no reserved round follow, and no error is shown or spoken. A deadline or
  the Finalization Allowance entered Finalization for that round, and the
  Run records that cause. A client timeout or a failed request enters none
  once a Card is shown, and the Run records `model_answered`.
- A Stop inside the Answer Tail cancels the Run as a Stop during the spoken
  line does: the Card stays in the Feed and the Run ends `cancelled`.
- A Card from an attempt the client then retried stands, and the Answer the
  retry returns is not taken as its Tail. The client retries only an
  attempt that returned nothing, so this is a guard and not a path a
  capture should show.
- A round that ends with tool calls after its Card was shown also ends the
  Run on that Card, and the calls are not run. The ruling named a cut, a
  transport failure and broken JSON; this fourth case is recorded with the
  reason `tool_calls`. Under #312 a round that closed only its sentence and
  then called tools still works on, and the Answer that lands later is
  spoken.
- A Steering replan after a Card was shown lets it go, as it lets a held
  sentence go. The corrected objective's Answer publishes its own Card, so
  that Run carries two `display` events marked `finalAnswer`.
- The Run Trace becomes version 13 with three records: `early_card` (round,
  `publishedAt`, time from the round's start and to its end),
  `answer_out_of_order` and `answer_tail_fallback` (round and reason:
  `cut`, `request_failed`, `broken_json`, `tool_calls`). The Round Audit
  counts all three beside the rounds and reads a trace below version 13 as
  not counted. The continuity degradation is `answer_tail_fell_back`.
- The live Answer latency is taken at the `display` event marked
  `finalAnswer`, so it now ends at the Card and not at the round's end.

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
