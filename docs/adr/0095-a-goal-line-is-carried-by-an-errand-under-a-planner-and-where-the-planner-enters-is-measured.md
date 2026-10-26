# ADR 0095: A Goal Line is carried by an Errand under a Planner, and where the Planner enters is measured

## Status

Proposed 2026-10-26, from the grill of #464 (the owner's rulings are on
the issue). Becomes Accepted when the arms below have been measured and
the winner is written in; the numbers go here. Amends ADR 0076 (one
more class of exception to "no confirmation", after the Site Question
of #423) and the five-action cap's ending.

## Context

The Command tier (ADR 0076) is one multiple-choice card per hop, read
by the Decision Model under the Reaction target (p50 under 500 ms),
five actions a Task, nothing confirmed, no memory past "Done so far",
no question back. It is the right shape for the daily lines on the
Yield list, and the owner wants to keep it instant.

It has no road for a Goal Line: "comment that this is great on this
video", "find me a cheaper one of these", "copy this and put it on the
Shelf". The owner's vision (2026-10-26): "handle more complex tasks
that just click this button and search that". No goal-shaped line
exists in any log; the ledger's `missing_option` lines are single
verbs. The owner supplied and confirmed twenty lines from a normal day
(`fixtures/goal-cases/`), and set the scenario's per-day count as a
guess of ~2 (yield 8, `missing`).

The Decision Model cannot be the Planner: it is a choice-with-
probabilities model behind the systemone protocol, with no free text and
no memory. AGENTS.md allows a paid strategy (a second call, a step
before the step) only after the free arm fails with the whole class on
the card. The free arm here is Capture and page reading on the Decision
Model's own card.

## Decision

- **Names.** An *Errand* is one spoken outcome carried across Tasks and
  hops with a memory; a *Goal Line* is the Utterance that starts one;
  the *Planner* is the model that drives it (CONTEXT.md). The Decision
  Model keeps the Task.
- **The free arm first.** *Capture* (`capture-N`, text or image of a
  ref to the Shelf and the clipboard) and page reading in parts go on
  the Decision Model's card by kind, every site. The goal corpus runs
  through the Task loop before any Planner; the Planner takes the
  residue.
- **The Planner** is a chat model behind an OpenAI-compatible endpoint
  (GLM-5.3 on Z.ai's Coding Plan while the project is personal; pay per
  token at distribution, the owner's ruling), routed by
  `BINGBONG_PLANNER_*` env in the #395 shape, with GLM-5.3-flash as the
  gate model (the weaker model is the bar). Its tools are the browser
  verbs by kind, the Media Ops, Capture, page reading in parts, the
  Shelf, the Appliance Verbs and the question back. Never `evaluate`.
- **The appliance's own rate limit** on Planner calls: at most 2 a
  second and 4 in flight, by env. It binds only the gate.
- **Exceptions, for an Errand only.** 30 s per Planner call (the
  Command tier keeps 800 ms); 90 s per Errand, counted aloud as a
  Narrated wait (the Task keeps its five actions); a *confirm class*:
  an action whose effect leaves the appliance (post, send, pay, delete,
  submit) is said back and waits for yes, by the Site Question road,
  refused when unsure. The Planner classifies each action; code
  enforces. Both numbers are guesses, marked so in code, until the
  `planner-step` and `errand` spans exist.
- **A Task ending `cap`, `unsure` or `unavailable`** hands its record
  to an Errand instead of saying "I couldn't finish that", on every arm.
- **The surface** follows `docs/agents/ui.md`: the Receipt within
  100 ms; each Planner step named on screen with its seconds; aloud
  only the confirm, the question back (one open at a time, it pauses
  the cap, the ear stays open for the Hot Listen window, no answer ends
  the Errand `unsure` aloud) and the outcome, the Planner's own
  sentence.

## Where the Planner enters: the arms

A tie the owner would feel, so measured, never argued. Each arm keeps
the hand-off above.

- **A. The Decision Model routes**: one more option on the hop-0 card
  (`errand`). Costs one card line; an Errand pays one reaction before
  its first step.
- **B. Hedge**: the Planner is started in parallel on every line the
  Decision Model is asked and cancelled when it settles; it takes over
  on `errand`, `none` or unsure. Costs nothing in time and a cancelled
  call per line (inside the owner's "experimenting" ruling for the
  trial; dropped if Z.ai rate-limits it).
- **C. After a not-done Task only.** Costs up to five actions and the
  Task's seconds before the Errand starts.
- **D. One tier**: the Planner for everything. Stands or falls on its
  latency on the daily lines against the Reaction target.

Grid: arm × Planner model (GLM-5.3, GLM-5.3-flash) × thinking (on,
off) × cap.

## Measures, named before building

- Daily lines: `pnpm jev:gate` on the Jev corpus, and the same corpus
  through the chat adapter for GLM-5.3 and flash (arm D's number comes
  free).
- Goal lines: the twenty in `fixtures/goal-cases/`, live under the CLI
  harness, on fixture pages for determinism and on the real sites for
  the numbers, `--repeat` for the noise; scored done-right and seconds.
  Slower and noisier than the frozen cases, and said so.
- Reaction: `pnpm perf:report` p50 and p95 on the daily lines before
  and after; no regression accepted.
- Winner: best goal seconds and done-right with no daily case lost and
  no reaction regression. A tie inside the noise goes to the arm
  cheapest to reverse.

## Numbers and winner

_Pending the gate run._

## Consequences

- Two models in the loop, each with its own timeout, bar and log; the
  Decision Model's path is unchanged in latency by construction and
  measured to prove it.
- The `goal` scenario is on the Yield list at 8 and competes there; if
  arm D's latency clears the Reaction target the scenario folds into
  the daily ones and this ADR shrinks to the names and the confirm
  class.
- ADR 0076's "none confirmed" now has two exceptions, both the same
  road: a site's own confirm (#423) and the appliance's own, for the
  confirm class.
