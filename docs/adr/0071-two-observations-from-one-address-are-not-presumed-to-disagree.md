# ADR 0071: Two Observations from one address are not presumed to disagree

## Status

Accepted on 2026-09-27 for #284, grilled the same day from the `jev-off`,
`jev-on` and `fix-281` Run Traces with every recommendation taken. Reverses
the contradiction handling of [ADR 0028](0028-checkpointed-session-evidence.md)
as #122 built it and #143 displayed it. #283 waits on it.

## Context

Since #122 an accepted Evidence Checkpoint has been compared with every
Observation the Session holds. One with the same source kind, a shared
canonical address and different text made a pair, and the pair was retained
(#143). The model read it as a Note on the tool result, told to "disclose the
disagreement in your answer or reconcile it". The user read it as a
`contradicted` chip and a group in the Evidence Browser, and as a warning on
every earlier Answer that cited the earlier Observation.

The case it was written for is one page stating one value in one Run and
another in a later Run: every test of it records `$39` and then `$59` from
one address. Two different facts from one page meet the same rule.

The traces hold 181 accepted orchestrator records. 64 were answered with the
Note, naming 120 earlier Observations: 15 of 56 with no Decision Model, 19 of
59 with it, 30 of 66 with the Selected Passage seam on. Read pair by pair
(`e2e/live/reports/contradiction-notes-judged.md`):

- **No Note marks a disagreement.** 28 name only different facts and 36 name
  a fact the record restates or widens. None states an incompatible value
  and none replaces an older value.
- **The model dismisses it and pays to do so.** 29 Notes are reasoned about
  within three rounds, always as spurious, for about 143 s over the three
  captures. One was followed by two re-reads of a page and a record whose
  text says it "reconciles the earlier conflicting note".
- **It reaches the Answer.** Three final Answers disclaim a contradiction no
  source holds.
- **It reaches the user.** By the renderer's rule, 30 of 53 final Answers
  cited an Observation a later pair named, which is the condition for the
  warning. The count is derived from the traces; no record says what was
  drawn.
- **Run-made checkpoints make pairs nobody is told about**: 24 in `fix-281`.
- **The one disagreement in the traces was between two addresses**, outside
  the rule by design, and the model's Answer settled it unprompted.

An Observation holds its text, its addresses, whether it is volatile and the
Run that made it. It names no subject.

## Decision

- **Session Evidence presumes no disagreement between Observations.** A
  checkpoint is compared with what the Session holds only to merge an exact
  duplicate. No pair is made, retained or traced.
- **No Note answers an accepted record about what it contradicts.**
- **The Evidence Browser and the Answer Evidence Summary show no
  contradiction**: the chip, the group and the warning are removed, and the
  evidence snapshot loses the field that fed them.
- **Disagreement is the model's to disclose**, as cross-source disagreement
  always was. The Investigation completion standard already asks for it. No
  prompt changes, for a Lookup or otherwise.
- **The merge rule is untouched.** It fired in none of the 181.
- **A Run Trace written before this still reads.** Its two fields are
  optional on read, so the committed Round Audits regenerate.
- **The Round Audit counts, per attempt, the accepted records answered with
  the Note**, from the result text. It is what gives the earlier captures
  their number and shows the next one's is zero.

## Considered and refused

- **The earlier Observation's excerpt is no longer in the page as read now.**
  This is the case the rule was written for, and the application can see it.
  No capture holds an instance to build or test it against, and a page read
  in part would make an excerpt look absent when the source still states it.
  It is the rule to revisit if a capture shows a page changing under a
  Session. What it would make is one Observation superseded, not two in
  conflict, which is why nothing is kept dormant for it.
- **Only an earlier Run's Observation.** 27 of the 64 Notes name one. None is
  a disagreement.
- **Only a volatile record.** One of the 64 records was declared volatile.
- **Asking the Decision Model whether two Observations disagree.** A seam,
  bars and a replay, for a case not yet seen once.
- **Rewording the Note and leaving the display.** The user would be shown a
  warning the model is no longer told about.

## Consequences

- A page that does change its value inside a Session is recorded twice and
  nothing marks it. Both Observations are held, the later carries the later
  time, and the Held Page Notice of [ADR 0051](0051-a-held-page-still-loads-and-its-outcome-names-what-the-session-holds.md)
  lists both when the page is open.
- A record that restates what is held is accepted as a new entry and is told
  nothing. That was 36 of the 64. Whether it should be merged or answered is
  #283's to measure.
- #283's capture can be read: no record beside a Run-made checkpoint is told
  it contradicts one.
- ADR 0028's Memory Compaction sentence names unresolved contradictions among
  what it preserves. No code did, and there are now none.

## The capture

Three passes on the default seams, `jev-on` as the Reference, initials and
follow-ups together unless stated. `passage` acted in the Reference and does
not here, so a missed correctness gate is read against that difference first
and settled by the owner. The rule is not restored on a miss. An Answer that
still disclaims a contradiction is filed as its own issue.

| Gate | `jev-on` | Bar |
|---|---|---|
| Accepted records answered with the Note | 19 of 59 | 0 |
| Final Answers disclaiming a contradiction no source holds, Voyager excluded | 1, and 1 refused attempt | 0 |
| Initials verified | 9 of 12 | at least 8 |
| Follow-ups verified | 5 of 6 | at least 4 |

Bookkeeping-only rounds per Run (3.00), the pooled Run median (178.6 s) and
accepted records per Run are reported and never gated. The time the Notes
cost is about 4 s a Session, inside a Run median's noise.

## Relationships

Reverses the contradiction handling of [ADR 0028](0028-checkpointed-session-evidence.md).
Leaves the Held Page Notice of [ADR 0051](0051-a-held-page-still-loads-and-its-outcome-names-what-the-session-holds.md)
listing every held Observation, with no pair among them. Unblocks the
measure of [ADR 0069](0069-a-run-makes-an-evidence-checkpoint-from-a-selected-passage-grounded-by-carrying-the-passage-in-the-result-the-model-reads.md)'s
Run-made Evidence Checkpoint under #283.
