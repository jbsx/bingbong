# Handoff (context limit): #498, impl-498

## Goal
#498: a joined correction ("play hurt" + "no, the other one") was searched as one string ("hurt no the other one") and played the wrong song. The fix has two parts:
- **F1 (arm A):** the joined card carries the held pick and offers `correct`/`correct_back` while a pick is held.
- **F2:** the joined Slot is read as the correction's own words.

The brief (the orchestrator's) holds every rule. `HANDOFF.md` is the orchestrator's file: never touch it.

## Completed work (branch `worktree-impl-498`, on top of gitlab main `4ab0534b`, NOT yet pushed)
- `20930af6`: arm A built.
  - `Player.picked?()` is one additive port method in `src/main/music/player.ts`. The fork for it is note 4107328918.
  - `Appliance.picked` and `PickedSong`; `offeredApplianceVerbs` offers correct/correct_back while a pick is held; `JoinedLine`, `joinedSlotOptions`, and the two-span Slot label `s<a>-<b>_<c>-<d>` in `slotWords` (all `jevReading.ts`).
  - `pickLines` and `withPicked` (`applianceCard.ts`).
  - The runner: `appliance()`'s picked, `ReadOptions.joins`, and the join in `settleFate` passing `{ words, slot: running.fired?.slot }`.
  - `scripts/jev-overlap.ts` has a `joined` source kind. Five cases were grown from the kept run (copied to `/tmp/impl498-evidence`):
    - `overlap-2-correct-the-other-one-joined-p1`, `-p2`, `-p3` (expect `correct`). p1's pick is inferred from timing, as its source comment says.
    - `overlap-2-correct-by-coldplay-joined` and `overlap-2-correct-by-radiohead-joined` (expect `play` plus the slot `s1-1_3-4` / `s1-2_4-5`).
- `aa298517`: the winner after measuring. Arms and numbers are in the commit message and in note 4107856298.
  - F1 is a tie, A 18/19 = C 18/19, so A was built. The only red in each is `overlap-8-split-landed` (0.46), the named gap.
  - F2 arm c was built: no span across the join, the first line's Slot beside each span of the correction, and one sentence in the slot instructions (2/2; arms a and b were 0/2). It applies only when the first line's Slot is found among its words.
- `066a5c14`: chart version `docs/diagrams/input-output/versions/2026-10-28-4ab0534b-joined-pick/`. The Overlap foot was recaptured and inspected; the index row was added.
- `85137124`: review fixes.
  - The pick rides only on a card with a running play opening it, or on the joined read. A pick whose line a `stop` ended stays off later cards.
  - `PickHeld` was dropped for `PickedSong`.
  - The joined Slot sits under the 255-option cap.
- The ledger line `turn-mvrvh7xx-2` was claimed for #498, with case `overlap-2-correct-the-other-one-joined-p2`; it records that the consent-sheet half is #496's. `fixedBy` is not set.
- `pnpm test` passed (4080) at `20930af6`. After `85137124`, the related files pass (1121) and `pnpm typecheck` is clean.

## In-progress work (killed at the context limit, by PID)
- **The full chunked gate**: the baseline on `/tmp/impl498/base-corpus` (the corpus at `4ab0534b`) reached 80/443, then the final on `/tmp/impl498/final-corpus`. Both are lost; rerun them. Partial raw output is in `/tmp/impl498/base.tsv.raw`.
- **The overlap gate**: `pnpm overlap:gate --cases 2-correct-the-other-one --points 3 --models decision-models/baseten-mammoth-27b-latest --keep logs/overlap/impl498`. It was calibrated, then kept meeting 429s. It never finished.

## Key decisions
- A held pick = `pick` non-null, and either it is the Queue's current song, or it never played and no other song is current. This is the same set `correct` acts on.
- The pick line reads `Music picked: "<title>", the result of a search for "<words>"`. "Not playing yet" was dropped: at p2 and p3 the element was already playing while the Queue had no current song.
- `+` is the corpus's summed-label syntax, so the two-span label uses `_`.

## Approaches that failed
- F2 arm a (two-span options added beside the full spans): Mammoth chose the verbatim join (0.71 and 0.86).
- F2 arm b (the spans across the join removed): Mammoth chose the two-span verbatim form (0.46 and 0.81).

## Next steps, in order
1. Verify the state (below), then re-grow nothing: the five cases are committed. The case JSON is unchanged by `85137124`; confirm with `node scripts/jev-overlap.ts rebuild` and an empty diff.
2. Rerun the full chunked gate: `node --env-file=.env /tmp/impl498/gatechunks.mjs $PWD /tmp/impl498/base-corpus /tmp/impl498/base.tsv`, then the same with `/tmp/impl498/final-corpus` and `final.tsv`.
   - One jev gate at a time on the host: `gatechunks.mjs` takes `flock /tmp/bingbong-jev-gate.lock` for each chunk.
   - Compare the two case by case. Re-ask any case that differs ×3. Count on the 438 shared cases; the 4 image cases never answer on a text model.
   - Expect the final to be the baseline + 5 new passes.
3. Run the overlap gate above. Before it, count the Electron runs with `pgrep -af "overlap-gat[e]|goal-gat[e]|xvfb-ru[n]"` and run only while fewer than 3 are up. The consent half may stay red until #496 lands.
4. `pnpm test` once, and `pnpm typecheck`.
5. `git fetch gitlab`, rebase onto gitlab main, keeping #495's `fitCard`/address-cut changes in `jevReading.ts`. Rerun `jev:overlap rebuild` if #495 changed the card. Then `SSH_AUTH_SOCK=/run/user/1000/gcr/ssh git push gitlab HEAD:main`.
6. Write the closing note (contents per the brief), then close. Points it must carry:
   - Tier Quick. Felt Reaction before: ~2.7 s to a wrong song. After: the same single ask, and `correct` skips the YouTube search.
   - ui.md: the said sentence "Playing “…” instead."
   - A drafted CONTEXT/ADR 0097 amendment: the joined line's ask carries the held pick and the joined Slot.
   - The open review points:
     - "yellow no by coldplay" is still offered as a two-span option (Jev chose the correction's words 2/2);
     - `picked()` is null while a new pick opens over a different current song, the same as `correct`'s refusal;
     - p1's pick is inferred.

## How to verify state
- `git log --oneline gitlab/main..HEAD` lists the 4 commits plus this handoff.
- `pnpm typecheck`; `npx vitest run src/core/command src/main/run/commandRunner.test.ts src/main/music`.
- `cat /tmp/impl498/ovA.tsv` shows the arm A overlap measure: 18/19.
- `jq . fixtures/failed-lines/turn-mvrvh7xx-2.json`.
