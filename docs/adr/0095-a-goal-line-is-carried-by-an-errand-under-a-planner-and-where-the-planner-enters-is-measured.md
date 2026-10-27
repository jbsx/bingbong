# ADR 0095: A Goal Line is carried by an Errand under a Planner, and where the Planner enters is measured

## Status

Accepted 2026-10-27 (#468): the arms were measured and arm C, the
hand-off, ships (numbers below). Proposed 2026-10-26, from the grill of
#464 (the owner's rulings are on the issue). Amends ADR 0076 (one more
class of exception to "no confirmation", after the Site Question of
#423) and the five-action cap's ending.

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
  enforces, with hard policy on top by kind and never by site: a click
  on a control, a type that submits into a field, or an Enter after
  typing into any field on the page, whose label carries one of *post,
  send, pay, buy, order, delete, submit, publish, reply, comment,
  subscribe* (and *unsubscribe*) as a word is `leaves` whatever the
  Planner said. Only the Site Question's exact yes lines (*yes, ok,
  okay, confirm*) fire it; any other line, or none within the Hot Listen
  window, refuses it into the Errand's memory, and an Errand the
  Planner then ends is recorded `declined`. Both numbers are guesses, marked so in code, until the
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

Measured in #468, 2026-10-26/27, on main `0829e79f` with the arms built
side by side behind an env switch that has since left the tree. The
Decision Model was Mammoth (the root `.env`, 3 s), the judge
`glm-5.3-flash` at temperature 0 with thinking off, every confirm
declined, nothing signed in, every run on a fresh profile under xvfb,
muted. The three arms ran at the same time so the shared hosts' load
fell on each alike. A run that met a 429 was run again (twice at most);
every one of them was Baseten's, the Decision Model's host. **The
Planner's host (Z.ai) returned no 429 in any run**, so arm B was not
ruled out on that count.

**Arm D** was ruled out before the build on #465's number: the daily
corpus through the chat adapter (`jev:gate --chat`), glm-5.3 200/230 at
p50 4.7 s, p95 13.7 s; glm-5.3-flash 201/230 at p50 4.6 s, p95 12.1 s,
against the 500 ms reaction target.

**Daily lines, `pnpm jev:gate`** (Mammoth ∩ Elephant, deterministic,
once). Arms B and C leave the card as it is: the base run is their
control, 206 of 239 through, 4 image cases not run. Arm A put one line
on every hop-0 first-ask card, just before `none`: "hand the words to
the planner: a goal that takes several steps in a row, or an answer
gathered from more than one place — not any one action on this card".
On the 128 cards it reaches, 115 through on both models, the same as
base: no case lost and none won. No daily case picked it. The only pick
of `errand` in the corpus was `cli-6-mvphag9z`, "Copy the recipe
ingredients and put them on the Shelf". That is goal-15's own line, and
it was already red on base. On a card at the Choice's 255-option cap,
the line takes the room of the last option taken (a right-click),
since production's `take` counts it; a first replay that did not cap
lost 4 cases to the host's 422 alone. The first wording lost nothing,
so no second was tried.

**Goal lines, `pnpm goal:gate`** (the twenty in `fixtures/goal-cases/`,
typed as spoken):

| arm | Planner | done-right | per pass | walls | seconds p50 | p95 |
|---|---|---|---|---|---|---|
| A, `errand` on the hop-0 card | glm-5.3-flash ×3 | 21/60 | 8, 6, 7 | 12 | 19.9 s | 66.8 s |
| B, hedge beside every Jev ask | glm-5.3-flash ×3 | 22/60 | 6, 8, 8 | 10 | 18.0 s | 65.9 s |
| C, after a not-done Task | glm-5.3-flash ×3 | 19/60 | 8, 4, 7 | 9 | 19.8 s | 65.1 s |
| A | glm-5.3 ×1 | 10/20 | — | 3 | 26.2 s | 48.7 s |
| B | glm-5.3 ×1 | 8/20 | — | 5 | 15.4 s | 68.1 s |
| C | glm-5.3 ×1 | 7/20 | — | 3 | 18.1 s | 53.2 s |

Over all four passes, A won 31/80, B 30/80 and C 26/80. One arm's own
passes spread by 2 to 4 out of 20, and A against C is about one pass's
spread (Welch t ≈ 1.0 on the per-pass counts). The seconds sit inside
the same noise. Before the Planner, the same twenty gave 0/20 (#465) and
the free arm 2/20 (#466).

**Reaction, `pnpm perf:report`** over the fixed daily 20 (below), three
rounds per arm on the CLI harness:

| arm | reaction, Jev-read p50 / p95 | Jev latency 3–6k p50 / p95 | 6k+ p50 / p95 |
|---|---|---|---|
| A | 2037 / 5468 ms | 735 / 1191 ms | 1672 / 2267 ms |
| B | 1929 / 5363 ms | 694 / 992 ms | 1831 / 2272 ms |
| C | 1726 / 5167 ms | 705 / 1183 ms | 1673 / 2251 ms |

21 to 23 of each arm's ~100 asks were refused by Baseten's 429 and
asked again, so the reaction rows carry host waits. Jev's own latency
by input size is the clean signal, and no arm moves it beyond the
noise. C leaves the daily path as it was, so its row is the "before".
On the goal lines Jev's latency by size was likewise the same across
arms; A asked Jev about 40 % fewer times there, since a goal line
picked `errand` at hop 0. The daily 20 are these corpus cases, each
typed on its own page: `cli-2-mvhdfjqw`, `cli-3-mvhdfrhx`,
`cli-3-mvhf99r0`, `turn-mvhzu1tp-b`, `cli-6-mvlg6ciw`,
`cli-12-mvle5ikw`, `cli-2-mvkw7388`, `cli-2-mvkw8yms`,
`cli-2-mvjmwld2`, `cli-14-mvkun2ns`, `cli-4-mvilmfeb`,
`cli-2-mvlgi99o`, `cli-19-mvlgab48`, `cli-2-mvkwbgho`,
`cli-9-mvjmzmip`, `cli-2-mvkwcigu`, `cli-5-mvlavo3s`,
`app-show-the-activity-panel-youtube`, `cli-2-mvph99ix-step1` and
`cli-4-mvjmxhw0`. No daily line routed to `errand` under arm A.

**Winner: C.** No arm is better than another beyond the noise, in
done-right or in seconds, and none regressed a daily case or the
reaction. A measured tie goes to the arm cheapest to reverse: C, then
A, then B (ruling 7). C adds nothing to the daily path: no card line
and no call. It ships on by default, and `BINGBONG_PLANNER=off` is the
one kill switch, with no Settings line (the owner excluded
voice-deafening settings in #420). The card line and the hedge left the
tree; #468's record keeps them. A is the arm to try next if a measure
with more goal lines separates the arms, since it led on both models
and costs no call.

**The #466 tie: does a capture end the Task, or go on to the
Verdict?** Measured on arm C, the five goal lines that copy (02, 11, 13, 14, 15),
glm-5.3-flash ×3, both builds side by side. **Go on** (shipped): 5/15,
p50 23.1 s, p95 40.5 s. **End**: 3/15, p50 8.1 s, p95 180 s (one run
reached the bound). End won goal-02 (3/3 against 2/3, inside the noise)
and lost goal-15 outright (0/3 against 3/3). The Task ended on the first
ingredient it copied, so it never reached the Errand that copies the
whole list. Faster, but with a case lost, so the capture goes on to the
Verdict as #466 built it. `pnpm jev:gate` cannot reach this tie: the
card does not change, and only the hop after a capture
(`turn-mvphvr8i-1`) is skipped. The daily reaction is the Endpoint to
the first effect, which comes before the Verdict, so it is unmoved by
construction.

The cap dimension was dropped: no run of #467's ended at the cap.
Thinking stayed `off` (Z.ai forces reasoning on both 5.3 models, #465's
probe).

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
