# HANDOFF-497 — #497 second pass, stopped at the context limit (2026-10-28 ~14:35 UTC)

## Goal
Finish #497 per the second-pass brief: (1) a seek over an ad held for the song; (2) the engine's Skip offered as a Media Op plus "skip the ad"; (3) after #498, the Capsule's "an ad first, 0:05 of 2:00", the card's `Playing:` line and say_playing carrying the ad, one jev case, the full chunked Mammoth jev:gate vs a same-day baseline; (4) pnpm test, typecheck, overlap gate 4-skip-ahead --points 1; (5) push; (6) closing note and close.

## Completed work (all on gitlab main, pushed 9237b248..303c8070, earlier 3e795711)
- `3e795711` (rebased form of 2556f440): the Player's `seekOverAd` holds a seek over an ad and `applyHeldSeek` puts it on the song (at the start, or the poll mid-song), one `seek` op by the words' seconds or the rung's share of the SONG's length. The engine's `skippable` fact is read in START/WATCH_SCRIPT, `skip-ad` presses YouTube's Skip button, MusicAction `{kind:'skip', ad:true}` lines are "skip the ad", "skip ad", "skip the ads", "skip this ad", and a bare `skip` skips the ad while the button is up. The Media Op is named `skip` (labels must match `^[a-z]+-N$`, so `skip-ad-7` won't parse; no new lexicon head). It is offered by `mediaOpsOf` only when `facts.ad.skippable`. `MediaFacts.ad?: {skippable}` is in core/browser/snapshot.ts. The scripted engine adds `skippableAtS`, `adsSkipped`, seek and skip-ad, and a new page drops the old ad marker.
- `58687c7f`: `mediaStateOf` says `an ad first … skippable`. say_playing's value is "an ad first, 0:05 of 2:00, then "…"" and its Answer is "An ad first, 0:05 of 2:00, then “…”.".
- `f8bdab4b`: two jev cases, `turn-mvrzkyzj-2-ad-appliance` (media-forward + amount words, from the kept ask with the ad lines added) and `turn-mvrzkyzj-2-skip-ad-appliance` (scripted, "get past this ad", expects media-skip). Mammoth passed each 3/3.
- `15b18388`: the runner.
  - `adDetail` with the play's onChange listener: the Loading detail "an ad first, 0:05 of 2:00".
  - `withAd` merges the Player's ad into the Appliance Card's media facts.
  - `overAd`: a Media Op over a counted ad goes to the Player (held seek, or skip). With no ad counted there is no read added. The gate is `nowPlaying().ad`.
- `303c8070`: chart version `2026-10-28-9237b248-ad-capsule-seek`. No box changes. The overview was recaptured and is pixel-identical to the previous version's. A details-open copy was inspected. index.md and changes.md were updated.
- Measures done:
  - `pnpm test`: 4164 passed, 10 skipped, exit 0.
  - typecheck clean.
  - The new runner tests (5) and Player tests (11) are green.

## In-progress work
- **Baseline jev:gate** at the start corpus: `/tmp/impl497/base-corpus` (462 cases = the corpus at 90709d37, unchanged to 9237b248, minus the 4 image `-mark` cases). Script: `/tmp/impl497/gatechunks.mjs`. 240/462 verdicts are saved in `/tmp/impl497/base.txt.json`, and there were no 429s. I stopped it at the context limit. To resume (it reuses the saved verdicts):
  `cd <worktree> && nohup node /tmp/impl497/gatechunks.mjs "$PWD" /tmp/impl497/base-corpus /tmp/impl497/base.txt > /tmp/impl497/base.log 2>&1 &`
- **Overlap gate** for 4-skip-ahead-while-loading, --points 1, Mammoth: started, then killed at the context limit (exit 144), so there is no result. Rerun it.

## Key decisions
- The Media Op is named `skip`, not `skip-ad` (the label grammar won't parse a hyphenated op; `skip` adds no lexicon head). Cheap to reverse.
- The seek gate in the runner is the Player's in-memory `nowPlaying().ad`. That keeps the Instant tier: no read is added when no ad is counted. The cost is that a mid-roll is seen at most about 1 s late (the poll).
- The ad wait rides the existing Loading stage as its detail. The stage word is unchanged.
- The Playing line's ad text sits in `mediaStateOf`, so `applianceCard.ts` is untouched. `jevReading.ts` is untouched.
- The last seek asked over an ad wins: there is one held seek.
- The final gate should reuse base verdicts for byte-identical cases (the owner's Baseten rule, memory share-baseten-with-siblings). The final corpus = current fixtures/jev-cases minus the 4 image cases. #498's corpus changes and my 2 new cases are what get asked.

## Approaches that failed
- impl-498's `/tmp/impl498/base.tsv` can't be reused: the corpus moved under it (#495's card cut).
- Hand-editing slot spans for a new transcript: build them with `slotQuestion` instead. Run `npx vite-node` on a temp script under `scripts/` (plain node can't resolve the extensionless imports).

## Next steps, in order
1. Resume the baseline (command above) until 462/462.
2. Final: copy `fixtures/jev-cases/*.json` minus `cli-{2-mviqlhwx,4-mviqm3mc,6-mviqmpbk,8-mvisvw90}-mark.json` into `/tmp/impl497/final-corpus`. Then run `node /tmp/impl497/gatechunks.mjs "$PWD" /tmp/impl497/final-corpus /tmp/impl497/final.txt /tmp/impl497/base-corpus /tmp/impl497/base.txt.json`.
   - Compare case by case. Re-ask any differing case ×3. Nothing may be lost.
3. Overlap gate. Count `pgrep -af "overlap-gat[e]|goal-gat[e]|xvfb-ru[n]"` first and wait only while 3 or more are up. Then:
   `pnpm overlap:gate --cases 4-skip-ahead-while-loading --points 1 --models decision-models/baseten-mammoth-27b-latest --keep logs/overlap/impl497-final`
4. Ledger: `fixtures/failed-lines/turn-mvrzkyzj-2.json` add `"fixedBy": "15b18388"` and `"case": "src/main/music/player.test.ts (a seek that lands inside an ad); src/main/run/commandRunner.test.ts (an ad before the song, on the runner); jev turn-mvrzkyzj-2-ad-appliance"`. Commit and push.
5. Closing note on #497, then close it. The note needs:
   - the rulings verbatim (brief + note 4108252488);
   - the measures above;
   - Tier and Felt Reaction:
     - play: Quick, unchanged, no stage added (first pass: p50 1416 ms);
     - seek: Instant, with no read added when no ad is counted, and one evaluate replacing the browser's over an ad;
   - the chart version;
   - ui.md: principle 2 is now MET on the Capsule (the first pass's bend is resolved); principles 1 and 9 too ("An ad first" everywhere);
   - the ledger lines turn-mvrvb0pl-1 (fixed 66942951) and turn-mvrzkyzj-2;
   - the F2 guess: the kiosk's media-start `ad` records settle it, and reversing to (b) is one line in startOf;
   - the CONTEXT/ADR 0080 wording drafted, not edited:
     - ADR 0080 amendment: "An ad its Media Engine states is a fact of the media ref: its line says 'an ad first' before the ad's time, a seek asked over it is held and put on the song once the ad ends, and while the engine offers to skip it the ref offers `skip`, the engine's own button; nothing skips an ad unasked."
     - CONTEXT Player: add "A seek over an ad waits for the song; 'skip the ad' presses the engine's Skip."

## How to verify state
- `git log --oneline gitlab/main | head`: 303c8070 should be at or near the top.
- `pnpm typecheck`
- `npx vitest run src/main/music src/main/run src/core`
- `python3 -c "import json;print(len(json.load(open('/tmp/impl497/base.txt.json'))))"`
