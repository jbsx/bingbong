# HANDOFF — #495 (an ask over the host's limit is never sent whole)

## Goal
#495 (GitLab jbsx/bingbong): a card over the Card Budget is cut to the limit by kind, each cut named in the ask record, and the line is still answered. The orchestrator's rulings 1–5 are in the brief: arms A/B/C measured, a floor, the opaque ratio, one size-422 retry, nothing site-specific. Worktree `impl-495`, branch `worktree-impl-495`, on gitlab main 3ee1f127. **Nothing is pushed yet.**

## Completed work (commits, on top of 3ee1f127)
- **f7da68d6** feat(card) — arm A plus the shared mechanisms:
  - `shownAddress` (`src/core/command/jevReading.ts`): an address past 300 characters is shown as its origin, its path (if ≤ 150) and each query parameter that names a host, then `…`. It is used on ref lines, links further down, `Page:` and `Pages visited:`.
  - `fitCard(budget, page, build(page, further), stateOf(page, questions), links?)` returns `FittedCard { questions, state, cuts, over? }`. The floor: after the options further down, refs yield from the page's end (a dialog's refs and media refs never do).
  - `cardBudget.ts`: `cardChars` weighs opaque runs at `OPAQUE_CHARS_PER_TOKEN = 1.33`, plus `CardCut`, `sizeRefusalOf`, `tighterBudget` (×0.9, marked as a guess).
  - `commandRunner.ts`: `askBudgeted` replaces budgeted+askJev at the 5 sites (dismiss, command, where, mark, hop). On a size 422 it retries once as `<id>-retry` with `retryOf`. An over-budget card is never sent: it is written `unsent: true` and reads as unavailable.
  - `AskRecord` gains `cuts`, `budget`, `unsent`, `retryOf`. `plannerCommand.errandCard` is moved to the new signature.
  - Tests are in jevReading.test, cardBudget.test and commandRunner.test.
- **cff0441d** — the corpus case `fixtures/jev-cases/turn-mvruozwf-3.json`, grown by `pnpm jev:case` from live turn-mvryfhx6-1 and rebuilt by the new builder (22,502 chars, nothing further down cut). The jevCorpus test's large case is now text.
- **f51d3a7a** — the opaque threshold moved from 80 to more than 300 characters, after measuring (see decisions).
- **6467097d** — review fixes: `ADDRESS_BOUND` is exported from cardBudget.ts and shared by both; the path cut is marked as a guess.
- **d3a4572b** — ledger: `turn-mvruozwf-3` `fixedBy f7da68d6`, `case turn-mvruozwf-3`. `pnpm bugs` shows it fixed.
- Notes posted on #495: arms A/B/C with numbers (4106523999), and a "Fork for the orchestrator" on the floor's next kind (4106525966; pick (a): refs from the end).

## In-progress work
- **Same-day baseline**, the full corpus on Mammoth at 3ee1f127. It was stopped at the context limit with 266/442 verdicts in `/tmp/impl495/v-base.json` (247 pass so far). It resumes where it stopped:
  `node /tmp/impl495/replayloop.mjs /tmp/impl495/base /tmp/impl495/base/fixtures/jev-cases /tmp/impl495/v-base.json`
  - It runs `jev:replay` per chunk of 15 from the base snapshot `/tmp/impl495/base` (git archive of 3ee1f127, with .env and node_modules links), and re-asks the cases the host did not answer (429) after a 60 s back-off.
  - `jev:gate` on one model asks and judges the same way (the same `askCorpus`, one at a time), but it does not say per case that a failure was a 429. That is why replay is used.
- **Final gate not run.** The final corpus is `/tmp/impl495/final-corpus`: the worktree corpus with every address rewritten as arm A shows it. 10 cases change: cli-10-mvkulva3, cli-12-mvkumgyl, cli-3-mvinjs78(-where), cli-5-mvineu5g, turn-mvinju63-4, turn-mvjkzlmk-3, turn-mvjn0jan-9, turn-mvkuc2j6-1, turn-mvl5g89b-4. Rebuild it with `node /tmp/impl495/rewrite.mjs <worktree> <worktree>/fixtures/jev-cases /tmp/impl495/final-corpus all`.
- `pnpm test` (the full suite) has not been run. The focused suites pass: 672 tests (core/decision, jevReading, commandRunner, main/decision). `pnpm typecheck` is clean.

## Key decisions and rationale
- **Arm A won**, measured on the grown case, Mammoth ×3:

  | arm | outcome | what was cut | p50 |
  |---|---|---|---|
  | A | yes ×3 at 0.77, PASS | nothing else cut | 772 ms |
  | B (labels cut first) | yes 0.74, PASS | 96 options further down + 11 refs | 1.6 s |
  | C (fold order) | yes 0.70, FAIL | 94 options + 11 refs | 1.6 s |

  B and C act only on an over-budget card, and none of the 57 search/overlap cases is over, so on that set they equal the baseline. The B/C code has left the tree.
- **The opaque ratio was measured**: the refused ask resent with every run of 80+ characters doubled; the host counted +16,148 tokens for +22,464 chars, which is 1.39. 97% of those characters were in runs past 1,000. Weighing from 80 put 27 frozen GitHub/Cambridge cards over the budget, so the threshold is runs past 300 (the address bound). With A plus the 300 threshold, only 3 frozen cases weigh over, and they were already over raw before.
- **Live repro at 3ee1f127**: `Utah` → hop 1 on DDG ads, 38,982 chars (under the budget as text), the host counted 21,990 tokens, 422, line ended not read.
- **Live run on the fix**: `Utah` ended done in one hop. That page had no kilobyte ads, so it did not exercise the cut.
- **Tier / Felt Reaction**: a hop on a Quick/Task line; the cut adds no call; the retry adds one call only on a size 422. The chart is unchanged: no new state or output, and the retry stays inside Thinking.

## Approaches that failed
- **Chunked `jev:gate` with whole-chunk retry on "429" text**: under host contention, chunks were never clean. Use replayloop's per-case re-ask instead.
- **Opaque threshold at 80**: too aggressive (see decisions).
- **Long shell one-liners** (`cd … &&`, `$f` in sed, heredoc+python) are refused by the worktree guard. Use plain commands, absolute paths, and Edit/Write.

## Next steps, in order
1. Resume the baseline loop (command above) and let it finish. Check `pgrep -af "jev-gate|jev-replay"` for other worktrees' runs first, and wait in short polls if one is live.
2. Run the final measure the same way: `node /tmp/impl495/replayloop.mjs <worktree> /tmp/impl495/final-corpus /tmp/impl495/v-final.json`. Compare case by case with v-base.json. Nothing may be lost, apart from host noise: re-ask any differing case ×3 to tell noise from a loss.
3. Run `pnpm test` once and `pnpm typecheck`.
4. Rebase onto gitlab main, then `SSH_AUTH_SOCK=/run/user/1000/gcr/ssh git push gitlab HEAD:main`. Never force. If the push is rejected, rebase and retry; if a SHA changes, update the ledger's `fixedBy`.
5. Post the closing note on #495 and close it (note first, then `state_event=close`). The note needs:
   - the commits;
   - the arms table;
   - baseline vs final;
   - the rulings verbatim;
   - Tier + Felt Reaction;
   - the chart unchanged, and why;
   - ui.md principles: 2 (narrated wait) and 10 unchanged; no new word on screen;
   - the ledger change;
   - residue: a size 422 also walks the routing's Fallback Hosts (#477 behaviour), so a refused ask can reach more than 2 hosts. A 422 followed by a fallback 429 gets no retry. The Errand card (Planner) ignores `over`/`cuts`. The appliance and site asks are not budgeted.

## How to verify state
- `git log --oneline 3ee1f127..HEAD` should show 5 commits plus this handoff.
- `pnpm typecheck`; `npx vitest run src/core/decision src/core/command/jevReading.test.ts src/main/run/commandRunner.test.ts src/main/decision`
- `node --env-file=.env scripts/jev-replay.ts <dir holding fixtures/jev-cases/turn-mvruozwf-3.json>` should give outcome yes ≥ 0.7.
- `jq length /tmp/impl495/v-base.json` shows baseline progress.
- `node scripts/bugs.ts | grep -A3 mvruozwf` shows the ledger line fixed.
