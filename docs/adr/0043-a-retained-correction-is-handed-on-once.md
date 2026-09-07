# ADR 0043: A retained correction is handed on once

## Status

Accepted on 2026-09-07, to be implemented in #218. Amends the second boundary
ADR 0039 recorded for #211 — what discharges a retained correction — and
replaces its numeric bound. Retention itself, the Inspection Reference, and
the refusal to interpret an utterance at admission are unchanged.

## Context

Two full-corpus captures at `313fba1` decayed within one Session until every
Run crossed its deadline with no tool call made. The round traces put the
cause in the Retained Correction block, not in the provider: prompt size grew
from 9.4k to 12.7k tokens across six Runs while round-1 thinking time grew
from 4 s to 118 s, then hit the client's 120 s request timeout on every Run
after. The model's reasoning opens each Run by working through the block's
obligation — record what the words decided about a Candidate, or ask — for
words that are plain new tasks and decide nothing about any Candidate.

Two properties of #211 as implemented compound into a ratchet:

- A Run was shown its own command as an unresolved correction. ADR 0039 says a
  Run resolves the words it was admitted with by answering, and the
  eligibility gate already reads inherited words only; the prompt block did
  not. Every continuation Run paid that deliberation and the ceremony it
  invites, so opening a URL took eight rounds.
- Only a model-written Answer resolves a Run's own words, and only a Candidate
  decision citing them resolves inherited ones. A Direct Action that crossed
  its 45 s deadline left its command as debt for the next Run, which was
  slower for carrying it, and failed too. The list grew to the bound of five,
  and from there no Run declared a plan inside its deadline.

ADR 0039 chose that bound so that "not that one; keep looking" followed by
"keep going" would both wait: two utterances about one Candidate are a
rejection and a nudge, not a nudge. The captures show the price of letting a
debt outlive more than one Run: each item costs reasoning at every later
admission, and a command-shaped item can never be discharged by the only
means the block offers.

## Decision

- The block a Run reads carries only the corrections it inherited. Its own
  command is what it is there to answer. This is the defect half; ADR 0039
  already says it.
- A correction left by a Run that never answered is handed on exactly once, to
  the next Run admitted. That Run grounds it into a decision or objective the
  Session retains, asks the user about it, or lets it lapse when it ends —
  answered, failed, or cancelled. It is never handed on a second time.
- The store therefore holds at most one own and one inherited correction at
  any admission. The bound is the rule, not a constant; the numeric cap and
  its "five consecutive failures" rationale are removed.
- Lapsing discharges the obligation, not the evidence. The User Observation
  that grounded the words stays in Session Evidence; the Candidate the words
  named becomes presentable and settleable again.

## Considered options

- Keep the bound of five and rely on the inherited-only fix plus the model
  asking. In ten decayed Runs the model never asked, and ask_user is closed
  once the deadline passes; the ratchet survives one failure.
- Scope corrections to the objective the Run Plan declares, so a failed Run
  that at least declared a plan retires the previous task's words. Whether a
  new plan is a replacement or a continuation is the interpretation ADR 0039
  keeps out of the application, and the #206 replacement guards exist to stop
  exactly that being decided silently.

## Consequences

The protection #211 was built for — the user's words surviving a first request
that fails before any tool ran — holds for the single failure it named. Two
consecutive fallback Answers now lose the older utterance; that is a fault
the user has already heard twice, and the Journal's stop records still say
what happened. The "both wait" case ADR 0039 named is given up on purpose.

A cut round is no longer mistakable for an empty completion: the round record
names why it ended and how much reasoning streamed, so #214's per-round
latency can exclude rounds the deadline or the request timeout ended.
Deadlines, rungs, and timeouts are untouched here; #214's baseline is taken
again after this lands, and #215–#217 read that.
