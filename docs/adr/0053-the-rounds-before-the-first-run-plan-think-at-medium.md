# ADR 0053: The rounds before a Run's first Run Plan think at medium

## Status

Accepted on 2026-09-15 for #252 and implemented the same day. Changes one
rung in the Effort Epoch's reasoning-effort rule (#166, #215) and widens the
rung type by the one value the provider defines and the tier map never used.
Amends nothing in the Run Plan, the prompt, the budgets or the deadlines.

## Context

Every audited round in the second Baseline (#247, `baseline2-1..3`) and the
Asked Item capture (#250, `fix-250-1..3`) records its latency, prompt and
completion tokens, reasoning characters and rung: 691 orchestrator rounds
over 36 Runs. Read together:

- Output tokens are the clock. Latency fits 3 s plus 13.5 s per thousand
  completion tokens (R² 0.99 on baseline2, about 72 tokens per second);
  prompt tokens have R² 0.01. Context size does not move a round's time, so
  trimming the prompt or the context is not a speed lever.
- Round 1 is the biggest single cost of a Run. It runs at `high` because no
  tier is declared yet, and reasons for 17–32k characters before its first
  action: a median of 62 s in baseline2 and 85 s in fix-250, 32% of all LLM
  seconds in both corpora, and 21 of the 24 rounds over a minute. The +16 s
  median Run that #250 recorded is mostly this round deliberating about 7k
  more characters to declare its Asked Items.
- The rounds after it barely reason. An Investigation's `max` rounds have a
  median of about 200 reasoning characters and 4.7 s; the per-tier rung is
  aimed at rounds that do not use it. The #166 measurement that moved the
  cheap tiers off `low` — a Steering replan declared against the original
  objective, Lookups wandering to budget exhaustion — was about those later
  rounds, not the opening one.

The z.ai probe of 2026-09-08 measured `medium` at five to six times fewer
reasoning characters than `high` on glm-5.3, with `high`, `max` and the
provider default indistinguishable. `medium` had never run in production.

## Decision

The rounds a Run works before its first Run Plan is declared think at
`medium`: `RUN_PLAN_REASONING_EFFORT`, read through the epoch's
`reasoningEffort` like every other rung. From the first accepted
`report_run_plan` on, rounds think at the tier's rung as before — Direct
Action and Lookup at `high`, an Investigation at `max`.

A Steering replan never returns to the Run Plan rung: the fresh Run Plan
after a directive thinks at the tier's rung whether or not a Run Plan had
been declared before the user spoke. An epoch constructed at a tier — which
only tests do — counts as declared. Finalization (`low`, #215) and Browse
Subagents (`low`) are unchanged; the `BINGBONG_REASONING_EFFORT` experiment
override keeps its precedence over every rung, and now accepts `medium`.

Nothing else changes: no prompt line, no budget, no deadline. The llm_round
trace already records each round's rung, so the Round Audit's per-round
`effort` reads `medium` on every round before the declaration and the
capture is checkable.

## Considered options

- **`low` for the opening round.** Rejected: thinking off, on the round that
  chooses the tier, the Asked Items and the first source, and the rung #166
  measured wandering at.
- **`medium` for every working round.** Rejected: it exposes the rare hard
  mid-run decision for no gain, since those rounds barely think at any rung.
- **A completion-token cap on round 1.** Rejected: it truncates mid-thought
  and yields a round with no tool call, which the rails count as a failed
  round.
- **A prompt line asking for a brief Run Plan.** Rejected: the advisory route, and
  reasoning length is not reliably prompt-steerable on this model.
- **Trimming the prompt or the context.** Rejected on the numbers: prompt
  tokens do not move latency.

## Consequences

- A Run that never declares a Run Plan thinks at `medium` throughout. The
  prompt requires the Run Plan in the first useful round and the runtime
  owes one Notice for a missing one, so this is the two-round Direct Action
  that answers before anyone asks for a tier — which is what the cheap
  tiers wanted anyway. The Lookup fallback Run Plan a malformed report earns
  declares nothing to the epoch either, so that Run runs below Lookup's
  `high` for as long as it stays undeclared.
- An automatic Tier Escalation at the deadline before any declaration does
  not end the Run Plan rung; only a declaration or a Steering replan does. A
  Run that has worked 120 s without declaring has already been told once
  and is one accepted report away from the tier's rung.
- The experiment override keeps its precedence over every rung and now
  accepts `medium`, so a whole-corpus pass at the new rung is one variable
  away.
- The measurement (#252) gates on the round-1 median (≤ 40 s from 62 s and
  85 s), the pooled median Run (≤ 229 s from 253 s and 269 s), initials
  verified (≥ 4 of 12), answer-omitted verdicts on initials (≤ 3), and
  stopped-early plus never-escalated verdicts (≤ 1). Speed bought with
  correctness is the trade this rung must not make; a missed gate is
  reported with the numbers and the owner decides between a recapture and a
  revert.
- What this does not touch: the bookkeeping-only rounds (18% of LLM time,
  every one a solo checkpoint call), the wasted rounds (about 16%), and the
  Answer round (10%). Those are the next levers, in that order.
