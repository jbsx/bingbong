# HANDOFF — #499 (impl-499, 2026-10-28, context limit)

## Goal

#499: a question just after a line ended ("is it working", 3 s after "Playing …") is read `none` and shown muted, never said. The rulings are in the orchestrator's brief and are final:
- **F1 arm (b):** the line just ended stays on the Appliance Card for 15 s, with `say_doing` offered for it.
- **F2:** filed as its own issue.

## Completed work (with commits)

Branch `worktree-impl-499`, based on gitlab main `3ee1f127`. **Not pushed.**

`f69e0186` feat(card): the line just ended is offered as `say_doing` for 15 s, and its end is said. The commit message holds the arms table.
- `src/core/command/runningCommand.ts`: `EndedCommand`, `EndedLine`, `ENDED_WINDOW_MS` (= `PEEK_CARD_LINGER_MS`), `endedWithin`, `withEnded` (the option alone, arm Jd), and `doingAnswer(running, ended?)`.
- `src/core/command/applianceCard.ts`: `ApplianceView.ended`.
  - Offered only while nothing runs.
  - `readApplianceAnswers` accepts `say_doing` when a line has ended.
- `src/main/run/commandRunner.ts`:
  - `LineEnd` on `LiveLine`; `noteEnd` in `track()`, which reads the display, done and none events.
  - `noteEnded` runs on `retire()`, and for an Early Fire at its `done`.
  - `endedBefore`; `ReadOptions.ended`, passed at hop 0 only when nothing runs.
  - The doing fact uses the ended line and marks the doing line `asked`, so it never becomes the line just ended.
- Tests:
  - `applianceCard.test.ts`, describe "the line just ended on the Appliance Card (#499)".
  - `commandRunner.test.ts`, describe "the line just ended (#499)": a play ends, then "is it working" 3 s later publishes `speak` "Done, 3 seconds ago: Playing “Let Down (Remastered)”."
- `scripts/jev-overlap.ts`: an `ended` source and `--only <name>`.
  - New case `fixtures/jev-cases/overlap-7-is-it-working-after-end.json`, expecting `say_doing` ≥ 0.7.
  - `rebuild` leaves the other 13 Overlap cases byte-identical.
- Ledger: `turn-mvrw0yf2-1` has `claimedBy #499`. `fixedBy` waits on both halves; the p1 half is #496's consent sheet.
- Chart: `docs/diagrams/input-output/versions/2026-10-28-3ee1f127-ended-line/`, plus the `index.md` row.
  - `overview.png` recaptured, and its Overlap foot inspected.
  - The voice and decision views were carried over.
- **#500 filed** (F2, needs-triage), with the kiosk count of 83 of 181 lines read none.
- Progress note on #499: 4106754109. It predates arm Jd.

## In-progress work

None half-built. The code is final for arm Jd. What remains is the measures, the landing and the closing.

## Key decisions and rationale

- **Card shape.** The ended line is named only in the `say_doing` option, and the card's state is unchanged:
  ```
  appliance: answer a question about the user's line just before this one, whether it worked and how it ended — never a new request — Done, 3 seconds ago: Playing “…”.
  ```
  This was measured. The arms (A, B, C, E, F, H, J, Jd) are in commit `f69e0186`.
- **Lure set.** It is the measure grown to reach the fork. The frozen corpus cards carry no ended line, so the plain gate cannot see the lure.
  - Built by `/tmp/impl499/tools/lureset.ts` (corpus, `lure-raw` from `tools/lures.py` over `kiosk-logs`, out dir).
  - Jd: 138/175, equal to the baseline, none lost.
- **The ended line is not shown while a line runs.** The running line wins the card, so the Overlap cases stay unchanged.
- **Lines that never become the ended line:** a none, a line that gave way into a join, and a doing-question line.
- **The window** counts from the end of the line's sentence (`retire`), the same as the Peek Card linger.
- **ADR 0097** says `say_doing` is offered "only while a line runs". The built shape bends this. Per the owner's draft-first rule, post the amendment wording in the closing note; do not edit the ADR.

## Approaches that failed (do not retry)

- **Ended lines on the state**, whether after the words, at the foot, or as one compact line. They lured the next line's own action, e.g. `turn-mvp8ki3t-vd`, a retried "Play Tumse…", read as `media-play`. This was steady, 0/3 and 0/5.
- **Arm A wording** reached 0.44, under the runner's 0.7: the pick goes on to the page card, which has no doing fact.
- **The ", never a new request" comma wording** steadily lost `turn-mvp8ki3t-vd`. The Jd dash wording holds it 3/3. The margin is thin: `play` 0.44, against the baseline's 0.56.

## Next steps, in order

1. Run `pnpm test` once and `pnpm typecheck`.
2. Measure the jev Overlap cases: copy `fixtures/jev-cases/overlap-*.json` to a dir and run `node --env-file=.env scripts/jev-gate.ts <dir> --models decision-models/baseten-mammoth-27b-latest`.
   - 12/13 old cases must hold; `overlap-8-split-landed` is the named gap.
   - The new case must pass.
3. Run the overlap gate. Count other Electron runs first, and run it only with no jev gate live.
   ```
   pnpm overlap:gate --cases 7-is-it-working --points 1 --models decision-models/baseten-mammoth-27b-latest
   ```
   The p3 half may stay red under the consent sheet until #496 lands: say so, do not fight it.
4. Run the full chunked final gate:
   ```
   cp fixtures/jev-cases/* <new dir>
   node --env-file=.env /tmp/impl499/gatechunks.mjs <worktree> <dir> /tmp/impl499/final.tsv
   python3 /tmp/impl499/tools/compare.py /tmp/impl499/base.tsv /tmp/impl499/final.tsv
   ```
   Nothing may be lost case by case. The same-day baseline is `/tmp/impl499/base.tsv`: 386/442 at `3ee1f127`.
5. Run the code review skill.
6. Rebase onto gitlab main and push:
   ```
   SSH_AUTH_SOCK=/run/user/1000/gcr/ssh git fetch gitlab main
   git rebase FETCH_HEAD
   SSH_AUTH_SOCK=/run/user/1000/gcr/ssh git push gitlab HEAD:main
   ```
7. Ledger: `pnpm bugs:add turn-mvrw0yf2-1 --case overlap-7-is-it-working-after-end`. `fixedBy` stays unset until #496 also lands.
8. Post the closing note on #499, then close the issue. The note must carry:
   - the orchestrator's F1 and F2 rulings, verbatim from the brief;
   - the commits, the arms table, and before/after numbers, narrow and full;
   - Tier and Felt Reaction. A question is Task. Before: 8.3 s to a muted none (two asks plus a Where Ask). After: one appliance ask, then said. The change adds no call;
   - the chart version;
   - ui.md: met 2 (a spoken outcome), 5 (said, not just shown), 9 and 10 (one sentence); none bent;
   - the ledger state;
   - the drafted ADR 0097 amendment;
   - #500.

## How to verify state

- `git log --oneline -2` shows `f69e0186` on top of `3ee1f127`.
- `npx vitest run src/core/command src/main/run/commandRunner.test.ts`: 1009 pass.
- `cat /tmp/impl499/lureJd.tsv | cut -f2 | sort | uniq -c`, then `python3 /tmp/impl499/tools/compare.py /tmp/impl499/base.tsv /tmp/impl499/lureJd.tsv` shows none lost.
- `node --env-file=.env scripts/jev-replay.ts <dir holding overlap-7-is-it-working-after-end.json>` gives `say_doing` about 0.9.
