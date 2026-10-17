# ADR 0075: The round after a bookkeeping-only round thinks at low and cannot record

## Status

Accepted on 2026-10-05 for #314, grilled the same day from the Round Audits
and retained Run Traces of `main-4dc72e9` and the code on main at 2d2900e,
with every recommendation taken. Adds one rung to the Effort Epoch's
reasoning-effort rule (#166, #215, [ADR 0053](0053-the-rounds-before-the-first-run-plan-think-at-medium.md))
and decides the rule on bookkeeping rounds in the middle of a Run that
[ADR 0072](0072-an-answer-carries-its-own-checkpoints-so-no-round-is-spent-recording-before-it.md)
left to be read again. #321 (the measurement) is built; #314 (the rung and
the withdrawn tools) is not, and no capture has been run.

Implementation note, #321. The Run Trace is version 14: an `llm_round`
names the reason for its rung in `rungReason`, one of `tier`, `run_plan`,
`finalization`, `subagent` and `override`. The Effort Epoch answers the
first four with the rung, from the same tier, phase and declaration; the
client says when the experiment override outranked the request's rung, and
the record then names `override`. The Answer-ready rung adds its own name
under #314. The Round Audit reads a Finalization round from that reason on
a version-14 record and by the rung's value below it, so no committed audit
moves.

The audit marks the rounds that wrote an Answer beside the rounds and
outside the digest: `taken`, `sentBack` and `retries`, by round number. A
retry is the round an `answer_retry` record follows. A round is sent back
when an `asked_items_shape` record says the retry was spent on it, when an
`off_language_answer` record follows it, or when a `malformed_answer`
record does and the next round is the retry; an Off-language Answer the
deterministic Answer stood in for is marked sent back too, since the
application did not take it. The taken round is the Run's last, when the
Answer shown was a model's and the round completed. A round cut while it
drafted an Answer is not marked, whether its Card was published early or
closed at the cut, and an Answer Retry is marked however it resolved. An
audit written before the marks is read from its rounds: where its trace
recorded an Answer Retry, a round that completed with no call and was not
the last was sent back, and the last attempt of the round after it is the
retry. On each of the 18 attempts of `main-4dc72e9` that rule gives the
marks the records give. It cannot tell an Off-contract Reply in a reserved
round from an Answer taken, which the records can, and an abandoned attempt
of an Answer round is in neither sum.

Per Run and per population the audit sums reasoning characters, output
tokens and seconds over the bookkeeping-only rounds, which are the rounds
of kind `bookkeeping`, and over the rounds that wrote an Answer. The Fix
Ledger carries the two reasoning sums as a mean over the Runs, recounted
from the rounds for an audit written before them. On the committed
`main-4dc72e9` audits the recount gives the figures above: 21
bookkeeping-only rounds with 105,389 characters and 550.3 s, four first
Answers sent back with 24,185 and 171.9 s, four Answer Retries with 9,361
and 113.5 s, and 14 Answers taken. By population that is 7,504 characters a
Run in bookkeeping-only rounds and 4,511 in Answer rounds over the 12
initials, and 2,558 and 9,354 over the six follow-ups.

## Context

A round that only records, and a round that only answers, think at the
Effort Tier's rung. On `main-4dc72e9`, 18 Runs:

| Kind of round | Rounds | Median reasoning | Largest | Seconds |
|---|---|---|---|---|
| Acting, after round 1 | 176 | 306 characters | 15,468 | 1,631 |
| Bookkeeping-only | 21 | 3,297 | 19,225 | 550 |
| An Answer sent of the model's own accord, or an Answer Retry | 14 | 3,417 | 30,930 | 614 |
| A first Answer that was rejected, and other rounds with no call | 7 | 5,384 | 11,140 | 249 |

The reasoning of every one of the bookkeeping-only and Answer rounds was
read, rebuilt from the stream's deltas since the trace keeps 8,000
characters of each.

- **A bookkeeping-only round is mostly the model drafting its Answer and
  then sending a record.** 10 of the 15 that reasoned do so, 375.7 s of the
  550.3 s: the Asked Items list, the spoken sentence and the checkpoints
  are written out in the reasoning. In four the reasoning concludes that
  the record belongs in the Answer's `checkpoints`, and the round sends the
  call anyway. Why is not known.
- **18 of the 21 sit in a chain that ends at an Answer.** Three are records
  in the middle of a Run, followed by a read, a navigate and a collected
  Subagent Report; those reasoned at most 774 characters.
- **The Answer after a chain is reasoned out a second time**: six rounds,
  189.9 s, 16,774 characters.
- **Answering directly costs as much.** The two longest rounds of the
  capture, 138.9 s and 113.1 s, are first Answers sent straight after
  acquisition with the deciding evidence unrecorded. One deliberates over
  the Answer Checkpoint's rules, the other composes six entries with their
  excerpts. So the round that opens a chain holds the Run's one derivation
  of its verdict, which some round has to make.
- **An Answer Retry thinks at the tier's rung**: four rounds, all at `max`,
  113.5 s and 9,361 characters, sending the same Answer again.

What can be known when a round's request is sent:

| Signal | Bookkeeping-only and Answer rounds it marks | Acting rounds it marks |
|---|---|---|
| An Answer Retry is owed | 4, 113.5 s | 0 |
| The round before was bookkeeping-only | 18, 443.4 s | 3, 27.3 s |
| The round before had a rejected call | 4 | 9 |
| Every Asked Item is recorded | not computable: nothing joins a record to an Asked Item before the Answer | |

- **The 13 rounds that open a chain, 435.0 s, carry no signal**, and
  neither do the two longest Answers.
- The Bookkeeping-only Notice (#254) is owed at the end of a
  bookkeeping-only round and rides a result of the round after it, so the
  model reads it two requests later, and never when the next round is the
  Answer.
- The rung is a function of the tier, the phase and whether a Run Plan is
  declared. All four values are sent: `medium` is the Run Plan rung.
- No request sets a limit on tokens or on reasoning, and no round that is
  cut is sent again.

## Decision

- **The round after a bookkeeping-only round thinks at `low`: the
  Answer-ready rung.** A bookkeeping-only round is a round outside
  Finalization whose every call is Bookkeeping. The rung holds for that one
  round, and the round after it is back at the tier's rung.
- **That round cannot record.** `record_evidence` and `record_candidate`
  are withdrawn from its request, so the model acts or answers, and what is
  still unrecorded goes in the Answer's `checkpoints`. A chain of
  bookkeeping-only rounds is therefore one round long.
- **That round is told at once.** Its request says that the round before
  recorded only, that it may act or answer, and where an unrecorded finding
  goes. The Bookkeeping-only Notice is removed: this message does its work
  a round earlier. Each delivery is recorded in the Run Trace.
- **The rule holds whether the records were accepted or rejected.** A
  rejected record's refusal already points at the Answer's `checkpoints`,
  and with the tools withdrawn that is where it goes.
- **Every Answer Retry thinks at the Answer-ready rung**, whichever of its
  three causes sent the Answer back. The first Answer did the deciding.
- **The round that opens a chain is left as it is**, and so is an Answer
  sent straight after acquisition. No signal marks either.
- **The Run Trace records why a round got its rung**, and its version is
  raised. The Round Audit reads that, and on an older trace keeps its rule
  that a round at `low` under a higher tier rung is Finalization.

## Considered and refused

- **A ceiling on a round's reasoning, by characters, tokens or time.** At
  8,000 characters it cuts 9 bookkeeping-only and Answer rounds and 4
  acting rounds of this capture; at 12,000, 6 and 2. A cut round has
  spent about 30 s and must be sent again, which no path does today. The
  estimate is about 12 s a Run. ADR 0053 refused the same for round 1.
- **An Answer-only round after a bookkeeping-only round, every tool
  closed.** Three of the 21 Runs went on to read, navigate and collect a
  Subagent Report; they would have been made to answer early.
- **The lower rung with the record tools left open.** The follower rounds
  stay possible, so the count of bookkeeping rounds before an Answer does
  not move.
- **`medium` for the Answer-ready rung.** It keeps some reasoning in 18
  rounds to protect 3 acting rounds for one round each, and a Steering
  correction is carried by the Standing Directive at any rung (#167).
- **An Answer that arrives with record calls in the same response.** It is
  a third way to write what `checkpoints` carries, and whether the model
  would take it is unmeasured.
- **Lowering the rung on a rejected call.** It marks 9 acting rounds for 4
  it is meant for.
- **Wording that tells the model a record or an Answer needs no thought.**
  ADR 0053 found reasoning length not steerable by the prompt, and four
  rounds here decided one thing and sent another.
- **Tracking which Asked Items are recorded during a Run.** It would need
  a record to name its Asked Item, which no tool asks for.

## Consequences

- A Run that records and then answers spends two rounds on it: the round
  that derives the verdict and records, and the Answer at `low`. The
  second derivation and the follower rounds go.
- An acting round that follows a bookkeeping-only round thinks at `low`
  once and cannot record beside its action; it records the round after. On
  this capture that is 3 rounds in 18 Runs.
- The tool catalogue of one round differs from its neighbours', which the
  trace's request shape shows.
- `main-4dc72e9` counts four rejected first Answers as failed rounds, so
  its 21 Finalization-class rounds are four short of the rounds that wrote
  an Answer. #321 recounts them.
- The issue's sentence that the provider has two real settings is wrong:
  `medium` is sent on every Run and reasons between `low` and `high`.

## The capture

Three passes of #314's own, against `fix-311-312`, the capture owed to #311
and #312 and audited with #321's counters. It is not
shared with #313 and #319: #313's bar is output tokens in the Answer round,
which this moves. Whichever of the two captures runs second takes the first
as its base. Graded and audited by the model reviewer.

| Gate, pooled over three passes, per Run | Bar |
|---|---|
| Bookkeeping rounds right before the Answer | fewer than the base |
| Reasoning characters in bookkeeping-only rounds and Answer rounds, a rejected first Answer and an Answer Retry counted | fewer than the base |
| Initials verified | not fewer than the base |
| Rounds per initial Run, pooled median | not higher than the base |

Seconds by kind of round, output tokens, bookkeeping-only rounds per Run
and follow-ups verified are reported and never gated. There is no target in
seconds: [ADR 0074](0074-an-answers-card-is-published-when-its-fields-are-written-and-the-answer-tail-is-never-waited-for.md)
retired 10 s for the round's end, and the provider moves a round by 9 to
14 s on the same tokens.

The work is two commits, the round after a bookkeeping-only round and the
Answer Retry's rung. A miss on initials verified or on rounds per Run
reverts the first and keeps the second, unless the reviewer's verdicts
point at a retry. A miss on the first two gates alone is the owner's call
on the report.

## Relationships

Adds a rung beside those of [ADR 0053](0053-the-rounds-before-the-first-run-plan-think-at-medium.md)
and #215. Decides what [ADR 0072](0072-an-answer-carries-its-own-checkpoints-so-no-round-is-spent-recording-before-it.md)
deferred, and keeps its refusal of a lower rung for a round that turns out
to be bookkeeping: the rung is still chosen before the round runs, from the
round before. Leaves the Finalization bookkeeping round of [ADR 0036](0036-the-round-finalization-is-entered-during-is-never-the-bookkeeping-round.md)
and [ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md),
the list-only retry of #311 and the early Card of ADR 0074 untouched.
