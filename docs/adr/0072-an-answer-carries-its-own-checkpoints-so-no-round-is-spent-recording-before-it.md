# ADR 0072: An Answer carries its own checkpoints, so no round is spent recording before it

## Status

Accepted on 2026-09-28 for #288, grilled the same day from the Round Audits
of `fix-270`, `jev-off`, `jev-on`, `fix-281`, `fix-284` and `fix-283` with
every recommendation taken. Amends the Answer contract. Leaves the
Finalization bookkeeping round of [ADR 0036](0036-the-round-finalization-is-entered-during-is-never-the-bookkeeping-round.md)
and [ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md)
as it is. Built on 2026-09-28; the `fix-288-290` capture is not yet run.

Note (2026-09-28, #288): what building it settled.

- The field is `checkpoints`. An entry's kind is read from the one field
  only its tool takes: `observation` makes an Observation, `subject` or
  `candidate_id` a Candidate record. An entry with none of them is dropped
  as `malformed`, and one past the sixth as `over_cap`; both count against
  the cap, so a list cannot be padded past it.
- A creation entry carrying a `status` other than `active` is sent as the
  tool's own two calls, the creation and then the decision on the identity
  the creation returned. A decision that is refused leaves the Candidate
  created and active and the entry dropped with the decision's reason. The
  runtime never writes a reason: a decision with none is `malformed`.
- `supporting_evidence` cites identities that already exist, as a call's
  does. An Observation carried in the same Answer has none while the Answer
  is written, so a Candidate entry cannot rest on it. The prompt says so.
  Whether that leaves rounds the gate needs is read from the capture.
- Entries are recorded after the Card's `display` event and before the
  spoken line, so a Stop while it is spoken does not lose them. The
  Observations accepted are published in an `answer_evidence` event, which
  the Feed adds to that Answer's entry. They count as the Answer's evidence
  for an Assessment's support and for the freshness of `completed`.
- A dropped entry is logged as the continuity degradation
  `answer_checkpoint_dropped`, and the Run Trace, version 6, keeps one
  `answer_checkpoints` record per Answer that carried the field and one
  `evidence_checkpoint` record per graded entry, marked `origin: answer`.
- The Finalize Instruction's wording is unchanged with its bookkeeping
  round. A reserved Answer learns the field from the prompt.
- The recount from the committed audits gives the table below exactly: 103
  on initials, 13 to 20 a capture, and 91 on follow-ups, 13 to 18. It reads
  a round by the kind the reviewer's overrules left it with, which is what
  the grill counted; by the mechanical kind alone the follow-ups read 89. It
  finds 4 of the 72 initial Runs with a run longer than four where the
  Decision says 3, and none longer than six.

Note (2026-09-28, #291): what the `fix-288-290` capture showed, and what is
decided from it. Grilled the same day with every recommendation taken.
Built the same day; the `fix-291` capture is not yet run.

- The capture met the follow-ups' bar, 4 against at most 7, and missed the
  initials', 16 against at most 8. All 10 entries offered were accepted. The
  16 sit in 6 of the 9 initial Runs that offered none; the 3 that offered
  had none.
- The Runs were read from their traces. The model knows the field: in 5 of
  the 16 rounds its reasoning decides to answer and carry the records, 4
  naming the field, and the response is a call to a record tool. Those 5
  led to 6 more, 3 sending a refused checkpoint again and 3 creating or
  deciding a Candidate in a call of its own. 4 emitted no reasoning. None
  was a Finalization bookkeeping round.
- Seven Answers sent the field empty, as the prompt's example Answer showed
  it.
- **The instruction moves to the Answer contract.** The Decision's last
  point put one sentence in the prompt's `record_evidence` paragraph and
  both tool descriptions, where the model met it while reading about the
  tools. The `checkpoints` bullet of the contract now opens with it, and
  the three earlier places say only that the tools are not for a Run ready
  to answer.
- **The example Answer carries entries**: one Observation and one Candidate
  created and decided, as placeholders.
- **The `bookkeeping_only` Notice names the Answer**, where the Decision
  left it unchanged. "Alongside your next action" says nothing to a Run
  whose next action is the Answer, and one Run recorded a page a second
  time on reading it.
- **A refused checkpoint's result and a Candidate creation's result name
  the Answer** as the other place the corrected entry or the decision may
  go. A refused entry carried by the Answer is dropped and not sent back;
  the count of dropped entries shows what that costs.
- The mechanism, the cap and the grading are unchanged. An Answer that
  names an inspection Candidate still needs it recorded by a call first,
  which no wording removes.
- The capture is `fix-291`, its own, against `fix-288-290`. The initials'
  bar stays at most 8, and the initial Runs with any such round, 6 of 12,
  are reported beside it. A miss reverts #291's commit, leaves #288's, and
  files the mechanism as its own issue: a Run that has met its objective
  and sends only records could be answered without a further round.
- Building it settled two things. A malformed call graded as corrected
  quotes the refusal the corrected call would meet, and that quoted refusal
  does not name the Answer: the result names it once, at its end. And a
  refusal for want of a live Session, `no_session` or `refused`, does not
  name it at all: no corrected entry answers it, and the Answer's entry
  would meet the same refusal.

Note (2026-09-28, #292): the Finalization texts name the field. The #288
note above left the Finalize Instruction's wording unchanged, a reserved
Answer learning the field from the prompt; both reserved Answers the model
wrote in `fix-288-290` then sent it empty. A skipped bookkeeping round's
texts and the Answer-only text now say where an unrecorded finding goes.
The Finalization bookkeeping round, refused for removal under "Considered
and refused" until a capture showed its use, stays: the numbers and the
texts are in the note of the same date on
[ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md).
Why 6 of the 7 entries one reserved Answer offered in `fix-291` were
malformed cannot be read, since the Run Trace keeps no Answer JSON for an
Answer that was accepted; it is left to the reading of that capture.

Note (2026-09-28, #295): a second counter beside the gate's, for the rounds
it cannot see. No gate is restated and no capture was run.

- The gate's counter counts back from the Answer round and stops at the
  first round that is not Bookkeeping. Where the deadline cut the round
  after the recording, that cut round stands between, and the recording is
  counted as nothing. The Pi camera initial of `fix-288-290` pass 2 is one:
  rounds 20 and 21 recorded, the deadline cut round 22, and round 23 was
  the reserved Answer.
- **Bookkeeping rounds right before the cut** counts that run: the unbroken
  run of Bookkeeping rounds, by the kind the reviewer's overrules left,
  that ends at the round the active-work deadline cut, when only
  Finalization rounds follow it, or at the end of rounds that never entered
  Finalization. Rounds the deadline cut one after another are one cut.
- The issue described an attempt that ended with no Answer round. The
  attempts it meant do end with one, the reserved Answer, so the counter is
  anchored on the cut round. Of the 497 attempts in the committed audits 4
  end with no Answer round, and none of those ends on a Bookkeeping round.
- The trace does not say what the cut round would have been. The counter
  says what was spent recording as the deadline arrived.
- The gate's counter and its table are as written: 103 on initials and 91
  on follow-ups over the six captures. A round the gate's counter counts is
  left out of this one, so none is counted by both; that matters only where
  an overrule makes the cut round itself Bookkeeping, which no committed
  audit does.
- Recounted from the committed audits, none of which carries it: 10 on the
  six captures' initials, 8 of them in `fix-281` and 2 in `fix-284`, and 0
  on their follow-ups; 2 on the initials of `fix-288-290`. Over every
  audit committed on this date, 41 rounds in 15 of 331 initial Runs and 43
  in 10 of 166 follow-ups.
- It is absent on an audit written before it, so an aggregate rebuilt from
  such audits is the one committed, and the Fix Ledger recounts it from the
  rounds and the review. Reported, never gated.

Note (2026-10-05, #314): the rule on bookkeeping rounds in the middle of a
Run, refused below until this was captured, is decided by
[ADR 0075](0075-the-round-after-a-bookkeeping-only-round-thinks-at-low-and-cannot-record.md).

- On `main-4dc72e9`, 18 of 21 bookkeeping-only rounds sit in a chain that
  ends at an Answer, and 10 of the 15 that reasoned drafted the Answer
  before sending the record.
- The round after a bookkeeping-only round thinks at `low`, cannot record,
  and is told so in its own request. The Bookkeeping-only Notice is
  removed.
- The refusal of a lower rung for a round that turns out to be bookkeeping
  stands: the rung is chosen from the round before.
- The fallback this ADR named for a miss, a Run answered without a further
  round, is not taken up. No Answer exists until a model round writes it.

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
