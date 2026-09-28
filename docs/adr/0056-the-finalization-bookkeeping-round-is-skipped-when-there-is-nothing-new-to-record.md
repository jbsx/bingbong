# ADR 0056: The Finalization bookkeeping round is skipped when there is nothing new to record

## Status

Accepted on 2026-09-15 for #256, grilled from the Round Audit of the Run
Plan rung capture (#252, `fix-252-1..3`). Amends ADR 0036's "the round is
optional": optional for the model, and now skipped by the application when
nothing new has been acquired since the last accepted Evidence Checkpoint.
ADR 0038's shares and ADR 0035's Report Grace stand; a collected Subagent
Report keeps the round, which is the grace's reason.

Amended on 2026-09-15 by ADR 0057 (#256): the skip stands; a kept round's
share is now measured from its first token. The fix-253-256 capture cut four
kept rounds at ten seconds, two of them mid-thought, while four others
completed in five to eight seconds with one or two checkpoints, and the
premise above that most stopped Runs have checkpointed everything did not
hold: 8 of 11 entries kept the round.

Note (2026-09-28, #292): the round stays and the texts change. Grilled the
same day with every recommendation taken. Not yet built.

- **The round stays.** Over every trace on disk that records the entry, 104
  Finalization entries in 16 families, 57 kept the round and 47 skipped it.
  Of the 57, 35 completed with calls, 41 of their 48 checkpoints accepted;
  20 were cut by the allowance with nothing recorded, 228 s; 2 completed
  with no call. In `fix-291`, 3 were kept, all 3 completed, and 3
  checkpoints were accepted. The Answer's own `checkpoints`
  ([ADR 0072](0072-an-answer-carries-its-own-checkpoints-so-no-round-is-spent-recording-before-it.md))
  do not yet replace it: of the three reserved Answers the model wrote in
  `fix-291`, one used the field, and none of its 7 entries was accepted.
- **A skipped round's texts name the Answer's `checkpoints`**, where the
  Decision says the memory patch and evidence ids. `evidence_ids` cites
  identities that already exist, so it never could hold a finding that was
  not recorded. The sentence is `What you found and have not recorded goes
  in its "checkpoints": [] when everything is already recorded.` and it
  comes last, after the demand to state honestly what was completed.
- **The Answer-only text is one text.** After a kept round it said nothing
  of findings, so a round cut by the allowance left them with no place
  named. It now ends on the same sentence, and the wording for a skipped
  round is no longer a second constant.
- **A kept round asks for at most two Evidence Checkpoints "in this
  round"**, and an injected Subagent Report for "at most two checkpoints in
  this round" where it said "in all". One Run read the limit as the
  Session's: it had two checkpoints, recorded nothing, and answered.
- The sentence lives with the Finalization texts, not with #291's phrases,
  so a revert of #291's commit leaves it standing. Every text keeps the
  opening the Round Audit marks a Finalization round by.
- The Subagent's Finalize Instruction is its own and is unchanged. Both
  tools' line, `Not for a Run that is ready to answer`, is unchanged: a Run
  that was stopped is not one that chose to answer.
- Closed on tests that pin each text. A capture has 3 or 4 Finalization
  Runs, too few to gate; the entries a reserved Answer offered, accepted
  and dropped are reported.

## Context

In fix-252, 10 of 18 Runs — every Run that did not end `objective_met` —
show a Finalization bookkeeping round ending with the `allowance` outcome:
the 10 s bookkeeping share elapsed with nothing returned, then the reserved
Answer ran. About 5.5 s per Run of pure waiting, spent on the Runs that are
already the slowest. At the Finalization rung the model starts a long
excerpt bundle it cannot finish in 10 s at the provider's 63 tokens per
second. The #215 measurement on the release corpus never reproduced a spent
bookkeeping share; the live corpus does, on more than half its Runs. In the
`objective_met` Runs the model answers directly and no such round occurs.

ADR 0036 gave every Finalization entry a bookkeeping round so that findings
acquired just before the stop, and a rescued Subagent's findings delivered
by the Report Grace, could become Session Evidence. Most stopped Runs have
already checkpointed everything they acquired: the round is offered, the
model tries to fill it, and the share runs out.

## Decision

**The application skips the bookkeeping Tool Round when there is nothing
new to record.** The epoch goes straight to the reserved Answer when nothing
was acquired with Progress and no Subagent Report was collected since the
last accepted Evidence Checkpoint. Progress is the no-progress rail's: the
settled state moved, a requested state change, or an accepted checkpoint,
the last of which is the reference point; a Run that never checkpointed
measures from its start. A Subagent Report collected during the Report Grace
keeps the round.

**The Finalize Instruction stops offering a round that will not come.** When
the round is skipped, every carrier of the instruction says the Answer is
next and that unrecorded findings belong in the Answer's memory patch and
evidence ids. When the round is kept, the instruction asks for at most two
checkpoints — the findings that matter most — so the round fits its share.

**The unspent share flows to the reserved Answer**, as the Finalization
Allowance already says of every earlier share. The trace records the skip
as a reason on the Finalization entry, and the audit counts skipped
bookkeeping rounds beside `allowance` rounds.

## Considered options

- **Skip the round for every pipeline-caused stop.** Rejected: it drops the
  grounding the Answer's evidence ids need on the Runs where a page was read
  after the last checkpoint.
- **Raise the 10 s share.** Rejected: it moves the cut-off, a 30 s
  multi-excerpt round still does not fit, and the time comes out of the
  Answer's.
- **A thinking-off rung for the round.** Rejected: it exists only on the
  vision client (#215).

## Consequences

- A Run whose last Progress was an accepted checkpoint reaches its Answer
  about 10 s sooner and with 10 s more of Allowance; a Run that read a page
  after its last checkpoint keeps the round it may need.
- The Finalization glossary entry no longer says the bookkeeping round is
  always the first Tool Round to begin in Finalization: it is, when it
  happens.
- The measurement (#256) gates on Finalization rounds ending `allowance` (10
  in fix-252) at zero and reports Finalization seconds per Run and
  deterministic Answers, so a skip that starves an Answer of grounding is
  visible.

## Implementation notes

- The Run's first page-state read counts as something to record, although
  it is not Progress for the Approach accounting (#126 keeps the baseline
  read out of the no-progress count): it is the first material the Run
  holds, and a Run that read one page and never checkpointed keeps its
  round. A Run that never read anything skips it.
- A Collection call counts only when it collected a Subagent Report.
  `agent_results` also answers `ok` with a listing of agents still running,
  with "no uncollected subagent reports" and with "no subagents have been
  spawned yet"; the rail reads the reply for a completed entry's header.
