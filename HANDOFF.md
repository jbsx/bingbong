# HANDOFF — #489 (Overlap: the running Command on the Appliance Card, its Fate)

Context guard fired at 300k on 2026-10-28. Worktree `.claude/worktrees/impl-489`, branch `worktree-impl-489`, based on gitlab main `db5443d7`. **Nothing pushed.**

## Goal

#489: a line given while another runs is read against it. The Appliance Card carries the running Command and asks its Fate (ends / joins / waits / goes on). Every outcome is said. Read the issue body, its grill note 4103422937 and the orchestrator's rulings note 4103441871 (F1 arm a). The implementer brief in the session that spawned this worktree also binds.

## Completed work (with commits)

- `22b504aa` feat(runner): the build.
  - `src/core/command/runningCommand.ts` (new): `RunningCommand`, `runningLines` (T1 arm A wording), `fateQuestion`, `withRunning` (inserts the `say_doing` option before `page`, and `fate` right after `action`, T2 arm Q-after), `readFate` (unsure or missing → `goes_on`), `doingAnswer`, `stoppedLine`.
  - `applianceCard.ts`: `ApplianceView.running`; `applianceState` appends the running lines; `applianceQuestions` → `withRunning`; `fateOfAnswers`; maps `say_doing` → `{verb:'say', fact:'doing'}` only while running.
  - `applianceFacts.ts`: `doing` fact. It is kept out of `FACTS`/`SAY_LABELS`, so the Seed Lexicon is unchanged.
  - `commandRunner.ts`:
    - `floor`/`isEnded()` replaces "arrival supersedes". `submitted` keeps only partial staleness.
    - The `live` map of lines (`LiveLine`), with stage tracking via a `publish` wrapper (`track`).
    - `inFlight` is a Map per generation.
    - `endRunning()`; `stopSaid` is the stop line, said ahead of the ender's next `say()` or alone in its `finally`.
    - `takesPane`/`actsOnMedia`/`fateOf` (Q8 by kind); `settleFate()` acts on the Fate before `runStep`.
    - joins re-reads `"<running words>, <new words>"` (J1). waits awaits `running.over`, then re-reads.
    - joins/waits skip the page card (`unread`).
    - The Early Fire follows Q8 (waits → no early fire).
    - `stop` and abort say "Stopped." via `sayStop` (not counted as sounding).
    - `BINGBONG_APPLIANCE_CARD=off` keeps today's road: arrival sets `floor`.
  - Tests:
    - `commandRunner.test.ts` "an Overlap (#489)": 12 tests covering every fate, unsure/host-fail, Early Fire and the idle card.
    - `applianceCard.test.ts`: 4 tests, including the idle card byte for byte.
    - `errandRunner.test.ts`: Escape now says "Stopped.".
- Uncommitted at handoff (committed with this file as WIP):
  - `scripts/jev-overlap.ts` + `pnpm jev:overlap` (grow / rebuild).
  - 9 Overlap Jev cases, `fixtures/jev-cases/overlap-*.json`, grown from the kept runs (`.claude/worktrees/impl-486/logs/overlap/full-919f058f`) and the kiosk logs (`kiosk-logs/kiosk`, for `turn-mvphyqdu-vl`).
  - The applianceCard test cast fix.

`pnpm test` was green at 22b504aa (3949 passed). `pnpm typecheck` is green now.

## In-progress work

- Nothing is half-built in code.
- No measure has run yet. `BINGBONG_GATE_MODELS` is not in the worktree `.env` or the shell. Find how the main checkout sets it (the #486 runs used `decision-models/baseten-mammoth-27b-latest` and `decision-models/baseten-elephant-9b-latest`), or pass `--models`.

## Key decisions and rationale

- With the card off, legacy supersede. ADR 0096 says card-off "is today's road", and no card means no Fate is asked. It also keeps ~350 legacy tests valid.
- A Command that takes the pane (navigate/search/back/forward/reload/resume/`play` now) ends the running line, even on a Jev `goes_on` (only joins/waits keep their own road). That is Q8's one-pane mechanism extended to Jev-read lines. Name it in the closing note.
- The stop line is "Stopped <Acting word+detail>." (e.g. "Stopped playing let down by radiohead."). The object is the Acting stage, per Q11.
- The doing sentence is "Still on “<words>”: <stage lowercased>."
- No Jev case for exact lines (pause, stop, never mind, scroll down, volume down, the timer): they have no ask, and the overlap gate guards them.
  - Row 5's claimed turn `turn-mvr6z84m-2` is the search itself, with nothing running at its ask, so it has no case.
  - 4-skip's case uses the skip line's own ask, `turn-mvr6whm8-2` (the issue's `turn-mvr6weo3-1` is line 1).

## Approaches that failed

- Compound shell commands with `git`/heredocs/`$var` in sed are refused by the worktree guard. Use separate plain commands and python edits, or /tmp/impl489/gl.sh for GitLab REST (`/tmp/impl489/gl.sh issues/489/notes --data-urlencode body@file`).
- In jev-overlap, a hop 0 `done` is not the line's end. Every non-own turn before the ask belongs to line 1.

## Next steps, in order

1. Verify: `pnpm typecheck`, `pnpm test`, `git log --oneline -3`.
2. Find the gate models. Narrow baseline on the Overlap cases, Elephant first then Mammoth: `pnpm jev:gate fixtures/jev-cases --models …`. Or copy `overlap-*.json` to a tmp dir and gate that dir, to keep it narrow.
3. Measure T1 and T2.
   - T1 arm B: alternative wording in `runningLines`.
   - T2 arm Q-before: `fate` before `action` in `withRunning`.
   - For each arm, run `pnpm jev:overlap rebuild`, then the narrow gate. Keep the most through with nothing lost; inside the noise (`--repeat 3`), keep the shorter text.
   - Post one note per tie. The losing arm leaves the tree.
4. T3 (J1 vs J2) needs #488 to land first. Inside the noise J1 wins and is built. If J2 is unbuilt, say so with the reason.
5. Narrow overlap:gate (wait for the slot: `pgrep -af "overlap-gate|goal-gate|jev-gate|jev:gate"`, polling every 30 s), using the issue's narrow command. Then the full overlap:gate on both models with `--points 3 --seed 1 --keep`, and the full `pnpm jev:gate`: base page 210/242, Appliance 122/163, nothing lost.
6. F1: amend `fixtures/overlap-cases/5-independent-volume.json` expect (URL + both lines done). Add the Yield entry "search or open while music plays, and the music goes on" (`missing`, undated) to `docs/agents/yield.md`.
7. Draft the ADR (0097, or amendments to 0076/0096) and the CONTEXT.md **Fate** entry plus the Overlap sentence ("…is read as its Fate"). Post them on #489. They land only on the owner's word, so #489 stays OPEN until then.
8. Version the input-to-output chart (docs/agents/input-output-chart.md), capturing and inspecting the views.
9. Ledger: `pnpm bugs:add <turn> --fixed <sha> --case overlap-…` per claimed line. Refresh each case's `state` with the commit.
10. Rebase onto gitlab main (#487, #488, #491 may land). Then `SSH_AUTH_SOCK=/run/user/1000/gcr/ssh git push gitlab HEAD:main`. Post the closing note: Tier + Felt Reaction per fate, ui.md principles, chart version.

## How to verify state

- `git log --oneline gitlab/main..HEAD`
- `pnpm typecheck && pnpm test`
- `npx vitest run src/main/run/commandRunner.test.ts -t "an Overlap"`
- `ls fixtures/jev-cases/overlap-*`
- `node scripts/jev-overlap.ts rebuild` (should change nothing)
