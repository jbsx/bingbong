# ADR 0037: Keeping at a Blocker ends the Run

## Status

Accepted. Extends ADR 0010 (the same-wall Blocker gate) with a stop, and
corrects one sentence of its Consequences. The Finalization Cause it
reaches is ADR 0027's; the per-round counting rule is #197's, and the
"one round, one reason" rule the refusals obey is #201's.

## Context

ADR 0010 made Blocker detection mechanical and gave the run a same-wall
gate: once a marker arms it, browser calls targeting that host — other
than `read_page`, `look` and `ask_user` — are refused *before execution*,
with an escalation naming the two real options (ask the user, or go to a
genuinely different site). That stopped the run from burning eighty
*executions* on a wall, which was the failure of runs 46/47.

It did not stop the run. A refused call costs nothing to execute but still
costs the model round that proposed it, and the no-progress rails treat
failures as neutral by design (a pre-execution refusal is not an action
that stopped paying) — so a run that takes neither option grinds down to
`budget_exhausted` or `deadline_reached`. Those are the causes that say
least: the trace, the report, and the user's Answer all end on a spent
limit, when what actually happened is that the run stood at a wall only
the user can clear. Meanwhile `blocker` sat in `FINALIZATION_CAUSES` with
nothing reaching it — no rail entered it, `finalizeRun` dropped it as a
model proposal, and the code said so in a comment.

Two other shapes were considered.

- **Retire the cause.** Cheap: `WorkerStop` derives from
  `FinalizationCause` and the pinned #130 baseline tree's imports are
  type-only. Rejected because it deletes the vocabulary for the thing that
  actually happens and leaves the grinding cost untouched.
- **Let the model propose `blocker`, and let `finalizeRun` keep it while
  the gate is armed.** Rejected: it duplicates Run Resolution `blocked` —
  the model's semantic claim, which already exists — and a model that
  would honestly name the wall is a model that would already have called
  `ask_user`. It fixes nothing about the run that will not.

## Decision

- **The Blocker gate trips Finalization for `blocker`** on the second Tool
  Round, within one armed episode, in which a same-wall browser call is
  refused. It is the gate that attests it, not the model.
- **Refusals count once per round** (#197). The calls of one round are all
  made before the model can read any of their results, so four same-wall
  calls in one round are one mistake made four times. The gate takes
  `beginRound()` from the executor, exactly as the no-progress rail does.
  `read_page`, `look` and `ask_user` are never refused, so they never
  count: a model that re-reads the wall, looks at it, or asks the user is
  never tripped, and neither is one that moves site.
- **Reset is arm-scoped.** A successful different-host interaction disarms
  the gate and clears the count — the model demonstrably moved on, and ADR
  0010 already lets it come back, because the user may have signed in
  meanwhile. A re-arm on a *different* wall starts at zero; a marker
  re-arming the wall the gate already holds does not, or alternating
  `read_page` with a refused `click` would buy unlimited rounds at one
  wall. A Steering replan clears the count and keeps the arm: a corrected
  objective earns fresh patience, and the wall is still there.
  Mirror-hopping between hosts of one wall never trips — hosts compare
  exactly by ADR 0010 — and the work budget bounds that.
- **The tripping refusal is the wall refusal with the Finalize Instruction
  in place of the escalation**, under the `Not executed — ` prefix so the
  eval's runtime-refusal scan (`e2e/eval/acceptance.ts`) reads it as the
  stop it is. The escalation sentence and the "any successful interaction
  with a different host lifts the refusal" clause both go with it: neither
  is true once the run is finalizing. The nudging first refusal keeps the
  gate's own wording and stays out of that scan, because it is still
  recoverable by design. Siblings after the trip are refused by the
  existing closed-tool check, as after a `no_progress` trip, and carry the
  same instruction — one round, one reason (#201). No new Notice kind: the
  refusal is an error string, not a Notice riding a result.
- **The cause carries the wall.** `enterFinalization('blocker', { host,
  signal })`, and the detail rides the Effort Phase from there into every
  sentence: the Run's Finalize Instruction, the worker's Finalization
  notice and bounded report, and the deterministic Answer's spoken and
  displayed halves. The model-facing sentences reuse the gate's own
  "what helps is …" phrase; the user hears a separate, imperative one —
  "complete the challenge on `www.reddit.com` in the browser tab and ask
  again" — on #201's rule that rewording an instruction must never move
  the user's sentence. A `blocker` that somehow arrived without a wall
  names none: a host-less sentence about a wall is the invention this
  decision exists to remove.
- **Both roles.** A Browse Subagent shares the executor and trips the same
  way, with its own Finalize Instruction (a report, never an answer). Its
  ASK_USER relay still stops for `user_unavailable`; `blocker` is only ever
  the grinding stop.
- **Finalization is unchanged in shape.** `ask_user` stays closed under
  `blocker`, the run ends, and the spoken Answer says what to do. The Run
  Resolution stays the model's own claim — `needs_user` for a Challenge,
  `blocked` for a Network Block, read naturally but not enforced.
  `parseFinalizationCause` still accepts `blocker` syntactically and
  `finalizeRun` still drops it: a model proposing it changes nothing.
- **`FAILURE_SCREENSHOT_RAIL_CAUSES` gains `blocker`** (#191). A wall stop
  is the case where the screenshot *is* the diagnosis.

## Consequences

- ADR 0010's "worst case one wasted same-wall interaction, not forty" was
  understated by one word: the worst case was one wasted *execution* and a
  whole budget of wasted rounds. It is now one wasted execution and at most
  two refused rounds per armed episode.
- The eval keeps `blocker-challenge-page`'s `answeredWithoutRawLimit`
  assertion as its gate. A well-behaved model asks or moves and never trips
  this rail, so `blocker` on the tape is a failure signal, not the expected
  cause — but it is now a meaningful column in `finalizationCause` and in
  `WorkerStop`, where a walled run used to be indistinguishable from one
  that merely ran out of budget. The pinned #130 baseline tree is untouched.
- A wall the classifier cannot attribute (`UNKNOWN_BLOCKER_HOST`) never
  arms the gate and therefore never trips it, unchanged from ADR 0010.
