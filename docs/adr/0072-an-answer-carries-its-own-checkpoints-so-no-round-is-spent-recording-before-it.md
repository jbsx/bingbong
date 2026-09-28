# ADR 0072: An Answer carries its own checkpoints, so no round is spent recording before it

## Status

Accepted on 2026-09-28 for #288, grilled the same day from the Round Audits
of `fix-270`, `jev-off`, `jev-on`, `fix-281`, `fix-284` and `fix-283` with
every recommendation taken. Amends the Answer contract. Leaves the
Finalization bookkeeping round of [ADR 0036](0036-the-round-finalization-is-entered-during-is-never-the-bookkeeping-round.md)
and [ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md)
as it is. Nothing is built yet.

## Context

A round whose only calls are `record_evidence` or `record_candidate` costs
a budget round like any other, and at the Investigation tier it thinks at
`max`. Over the six captures, 72 initial Runs and 36 follow-ups:

- **Initials spend 2.9 such rounds a Run**, 36 s of model time, a fifth of
  the Run's. Follow-ups spend 3.0, 48 s, over a third.
- **Half of them sit in an unbroken run right before the Answer.** 103 of
  211 on initials, in 46 of 72 Runs, 19 s a Run. On follow-ups it is nearly
  all of them: 13 to 18 of each capture's 17 to 20.
- **They are in Runs the model ended itself.** 156 of the 211 are in Runs
  that finished `objective_met`, where no Finalization bookkeeping round
  exists. The model records, then answers in another round.
- **They are dear.** The median is 7 s and the ninth decile 30 s; the
  slowest run 45 to 56 s on 12 to 19 thousand characters of reasoning.
- **Nearly half record a Candidate.** Of the rounds before the Answer, 45
  of 103 on initials and 66 of 91 on follow-ups called `record_candidate`.

The Notice of #254 asks for a checkpoint alongside the next action, and the
count has stayed near three a Run since. Before the Answer there is no next
action to ride. The Answer is plain text; a response with any tool call is
a Tool Round and its text is dropped. So a finding still unrecorded when
the model is ready to answer has one way to be kept, and it is a round.

Recording is not required to answer. `evidence_ids` is optional and a claim
with no record behind it is displayed all the same. The model spends the
round to keep what it found for the Session, not to be allowed to speak.

## Decision

- **An Answer may carry Answer Checkpoints**: an optional array in the
  Answer JSON. An entry is an Observation, with the fields a
  `record_evidence` call takes, or a Candidate record, with the fields a
  `record_candidate` call takes.
- **Each entry meets the rule its tool meets.** An Observation's excerpt is
  checked against what the Run retained, exactly as a call's is. No second
  rule is written.
- **A Candidate entry may create, create and decide, or decide.** One
  created and decided in the same Answer has no identity yet, so its
  decision rides inside its creation entry. One naming an existing
  identity decides that Candidate.
- **At most six entries, of both kinds together.** Six is the longest run
  of bookkeeping rounds seen before an Answer; 3 of 72 initial Runs had one
  longer than four. An entry past the cap is dropped and logged.
- **A failed entry never fails the Answer.** It is dropped and logged as a
  degradation with the reason a call would have been refused for. It is
  not retried, and the Run's one Answer Retry is not spent on it.
- **Entries are recorded after the Answer's Card is available.** The user
  never waits on them.
- **An accepted Observation entry is that Answer's evidence.** It has no
  identity when the Answer is written, so it cannot be named in
  `evidence_ids`; it joins the Answer Evidence Summary with the identity it
  is given.
- **Both Answers may carry them**: the model's own, and the reserved
  Finalization Answer. A reserved Answer is still sent with no tool
  catalog.
- **The prompt and both tool descriptions say so**: when ready to answer,
  what is still unrecorded goes in the Answer, and no round is spent
  recording it. The `bookkeeping_only` Notice is unchanged.

## Considered and refused

- **A rule on bookkeeping rounds in the middle of a Run**, 17 s a Run. No
  rule removes a round the model chose to spend without refusing a valid
  checkpoint. It is read again once this has been captured.
- **Observations only.** It would leave about 11 of a follow-up capture's
  15 rounds, and finishing the job would take a second capture.
- **Not charging a bookkeeping round to the budget.** The budget is not
  what these Runs lack: 48 of the 72 ended `objective_met`. It would save
  no time.
- **Removing the Finalization bookkeeping round now.** Whether a Run at
  its budget still uses it once the Answer can carry its records is what
  the capture shows.
- **A lower rung for a round that turns out to be bookkeeping.** The rung
  is chosen before the round runs.
- **The Run making the records itself.** Tried as the Selected Passage
  ([ADR 0069](0069-a-run-makes-an-evidence-checkpoint-from-a-selected-passage-grounded-by-carrying-the-passage-in-the-result-the-model-reads.md))
  and removed under #283: the model recorded again.

## Consequences

- An excerpt that fails its check is lost where a call would have been
  told why and could be sent again. The Round Audit counts entries offered,
  accepted and dropped, with the reasons, so the loss is seen.
- The Answer is longer, and the Answer round with it. Its length and
  latency are reported beside the gates.
- A Session's evidence can now change after its Answer is displayed. The
  Evidence Browser shows the entries when they are recorded.
- The follow-up that finds a page held reads these Observations in the
  Held Page Notice of [ADR 0051](0051-a-held-page-still-loads-and-its-outcome-names-what-the-session-holds.md)
  as it reads any other.

## The capture

Three passes, `fix-288-290`, shared with #289 and #290 and run by whichever
lands last. `fix-284` is the Reference, the closest capture to the tree
these land on, with the difference marked. Graded and audited by the model
reviewer. A lever that misses its own gate has its commit reverted.

| Gate | Six captures | Bar |
|---|---|---|
| Bookkeeping rounds right before the Answer, initials | 13 to 20, mean 17 | at most 8 |
| The same, follow-ups | 13 to 18, mean 15 | at most 7 |
| Initials verified | 8 or 9 of 12 | at least 8 |
| Follow-ups verified | 4 to 6 of 6 | at least 4 |

Rounds per Run, the pooled Run median, and the Answer's length and latency
are reported and never gated. The Run median is not a gate because the
provider moves it: over the six captures the time a round took ranged from
10.2 to 12.9 s on the same tokens a round.

## Relationships

Amends the Answer contract of [ADR 0028](0028-checkpointed-session-evidence.md)'s
Evidence Checkpoint: the model still makes one by asking for it, and may now
ask in its Answer. Leaves [ADR 0036](0036-the-round-finalization-is-entered-during-is-never-the-bookkeeping-round.md),
[ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md)
and [ADR 0057](0057-the-bookkeeping-share-is-measured-from-the-first-token.md) untouched. Shares its capture with the note of the same date on
[ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md).
