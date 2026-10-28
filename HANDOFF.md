# HANDOFF — #490, third implementer (context limit)

Worktree `.claude/worktrees/impl-490`, branch `worktree-impl-490`, on top of gitlab main `4ec5948b`. **Nothing of this session is pushed.** This file is committed in the WIP commit at the tip so nothing is left loose. **It must leave the tree (`git rm HANDOFF.md`, commit) before any push to main**, as #489's did.

## Goal

Close #490: speech over the app's own voice inside a listen is heard; the voice ducks at speech start, stops when #489's read makes the line for the app (any Fate but goes on with `none`), and is restored on `none`. Rows `10-move-on-while-speaking` (`turn-mvr7wxnb-2`) and `8-split-by-pause` (`turn-mvr7quqa-v1`) go green on Mammoth; `10-own-voice-not-taken` stays green. Owner rules: Mammoth only (`decision-models/baseten-mammoth-27b-latest`), never Elephant, never `--with-jev`; slot = 3 Electron runs; echo cases one at a time (one PulseAudio room); full measures once at the end.

## Completed work (local commits, unpushed)

- `43c11e36` **Step 3.** `attachVoice` passes `overSpeech: true` to the runner (`CommandRunOptions.overSpeech`). In `commandRunner.ts`, right after the first read and before `settleFate`, `forTheApp(first, submission)` stops `deps.speech` when the line has an action, or a `none` whose Fate (`fateOf`) is not `goes_on`. A `waits` stops before it waits. A `none` that goes on keeps the duck until its Task settles (attachVoice restore). 3 runner tests; 2 fail without the line.
- `4e7c5137`, `0a0901eb`, `8b6de010`, `4d59f720` **The mixed capture, by level** (`src/core/voice/overLevel.ts`, wired in `voiceSession.ts`: `hearLevel`, `cutStretch`; `UtteranceEnd.endedBy` gains `'level'`). Under the duck the echo keeps the capture open, up to 30 s. A frame ≥ 3× the echo's level (the 75th percentile of frames after a 640 ms settle) for ≥ 6 frames, then 12 quiet frames, is cut out. Only the stretch is decoded: lead 1 frame, tail 8 frames. A person who spoke first is cut from their onset. The endpointer and transcriber are reset/cancelled; the echo after it starts its own capture. Unit tests in `overLevel.test.ts` and `voiceSession.test.ts`. Every number is a guess, marked in the code with its measure.
- Uncommitted until the WIP commit: CONTEXT **Barge-in** amended to the built shape. Chart version `docs/diagrams/input-output/versions/2026-10-28-4ec5948b-over-speech-stop/`: the voice view's duck box and note changed, view height 2660→2720, voice.png recaptured and inspected (bottom and top crops), the #490 details bullet restored (lost in #489's merge), source refs, `changes.md`, `index.md` (Latest + history row).

## Measures (Mammoth, one point, rows 8/10 + echo negative)

| run | commit | 8-split | 10-move-on | 10-own-voice |
|---|---|---|---|---|
| narrow1 | 43c11e36 (step 3 only) | red: failed, dropped | red: "Move on." never transcribed (merged into a 13 s echo capture) | green |
| narrow2 | 4e7c5137 (level, lead 10, to = end) | red | red: cut read "Moval."/"One" (cut ended before "on") | green |
| narrow3 | 0a0901eb (to = detection frame) | red | red: person-first cut ran 2 s into echo, own 0.86; echo fragments → Errand loop (below) | green |
| narrow4 | 8b6de010 (tail = end frames) | red | red: cut read "Two points." (echo syllable in the 320 ms lead) | green |
| narrow5 | 4d59f720 (lead 1, tail 8) | red: dropped, dropped | red, **ear fixed**: cut 608 ms, read "**Move on.**", verdict person (0.5), but the runner read it `none` on the page card with **no Fate** | green |

Level corpus (`/tmp/impl490/lvl/sweep.ts`, the 223 `speaking-*.wav` the gate kept): 3/3 person stretches found, 1 echo stretch taken ("Johnny Greenwood…", read own after). Lead/tail on the three live "Move on." cuts (`/tmp/impl490/lvl/lead`, `/tail`): lead 0–1 frames and tail 0–8 read "Move on." all three. Lead 2–10 read "But move on.", "Wait, move on.", "Point.", "Two points.", "Take a tune."; tail 12 read "Move all".

Silence proof: `/tmp/impl490/s3/real-sinks.log`, 1,835 samples of the real sound server across narrow1–5. Only the owner's Firefox appeared.

## In progress / what remains red, and whose it is

1. **10-move-on (narrow5): the ear delivers "Move on." now; the runner doesn't act on it.** It was read on the page card, no `fate` span. So `runningBefore(submission)` was null: the Page Read (`read`, a local match that fires and speaks) is not a live line while its sentence is still sounding. Jev saw "Move on." alone and read `none`. That is #489's Overlap: a sounding Page Read should count as a running line for the Appliance Card, or "move on" has nothing to move on from. Not built; outside the voice. Raise it as a fork or on #489, measured with `jev:overlap` + this row.
2. **8-split**: at narrow1 both halves reached the runner, but "Back to" fired (back, failed) before "Page"'s read finished. "Page" then had no running line and was read alone `none`. At narrow5 both were `dropped`. The join never happens: #489's race, not the ear.
3. **Echo fragments → Errand loop (narrow3).** A short echo fragment (< 10 letters, "Producer", "Digital Limited.") is the person's by the floor rule. It is read `none`, ends `unsure`, and `handsOff` gives it to the Errand. The Errand speaks ("I didn't catch what you'd like…"), making more echo. Pre-existing since the Errand went default (#468), amplified by #490's floor. Fork, not built: (A) a line said `overSpeech` is never handed off, vs (B) leave it. Cheapest to reverse is (B); my pick would be (A) behind a measure.
4. The duck is a boolean (`speechCoordinator.duck`). An own-echo capture ending while a person's line is being read lets the duck go for that moment. Minor; noted, not built.

## Key decisions and rationale

- The stop is at the read (`forTheApp`), not in `settleFate`. One place covers every Fate and the no-running-line case, and a `waits` stops before it waits. A `goes_on` with an action stops at the read too ("any fate but goes on with none").
- The mixed capture is told apart by level, not by words, because the words do not survive the whole-capture decode (measured above). Level is a fact by kind: the duck is what makes the contrast. A false cut costs one short extra decode, which the own-voice text read then drops. A miss costs the line. So the threshold leans toward cutting.
- Every level number is a guess on one stand-in corpus (the room's Piper echo). The kiosk's `speaking-*.wav` dumps (`BINGBONG_AUDIO_DUMP=1`) settle them.

## Approaches that failed (do not retry)

- **Text-window read of the mixed capture** (the second implementer's named arm: a stretch of the transcript in no part of the app's text). Parakeet over the whole 13–30 s echo capture drops or merges the line ("282 Move On Go Live" → "Two Hundred and Eighty Two Man Go Live"). 0 of 3 kept mixed captures carry the person's words, so there is nothing for a text read to find.
- Level cut lead 10 frames (320 ms): echo syllables join the line. Cut `to` = detection frame: late detection carries seconds of echo. Cut `to` = last loud frame: loses the softer last syllable.
- Copying frames in `hearLevel` (I suspected chunk-buffer reuse): wrong. The endpointer keeps the same views and works; reverted.

## Next steps, in order

1. Verify (below). Then decide items 1 and 3 with the orchestrator (post "Fork for the orchestrator" on #490). The ear's part of row 10 is done at 4d59f720.
2. Run the narrow gate twice more at 4d59f720 to see the cut's read is stable: `bash /tmp/impl490/run.sh duck "10-" mammoth-27b-latest /tmp/impl490/s3/narrowN`.
3. Full measures once at the end: `pnpm test` (textlessRefs.chrome flaky; rerun alone); the chunked jev:gate on Mammoth (baseline 379/430, Overlap 9/9; no card code touched); the full overlap gate on Mammoth (impl-489's 4ec5948b baseline: 17/25 at points 3; red were 1-replace, 2-radiohead, 2-the-other-one, 7-what-are-you-doing, 8-split, 10-move-on, and the 2-coldplay/7-is-it-working points); `pnpm stt:gate` if it reaches the fork (the cut path is only under the duck).
4. Ledger: mark `turn-mvr7wxnb-2` fixed only when row 10 is green. Refresh the case states naming the commit.
5. `git rm HANDOFF.md`, rebase on gitlab main, push `HEAD:main` with `SSH_AUTH_SOCK=/run/user/1000/gcr/ssh` (never force, never github). Closing note with Tier/Felt Reaction (a line over the voice: before, unheard; now its Tier plus the cut, which fires 0.38 s after the line's last loud frame instead of at the 30 s echo capture's end) and the UI principles (10 the floor yields; 1 Receipt; 3 a false yield counted; bent: a dropped own capture is shown nowhere). Close only if every amended criterion holds.

## How to verify state

```sh
cd /home/jbsx/Projects/bingbong/.claude/worktrees/impl-490
git fetch gitlab && git log --oneline gitlab/main..HEAD   # this session's commits + the WIP
pnpm typecheck && pnpm vitest run src/core/voice src/main/voice src/main/run e2e/overlap
OVERLEVEL=$PWD/src/core/voice/overLevel.ts node /tmp/impl490/lvl/sweep.ts | grep "settle 20 ratio 3 p0.75"   # person 3/3, echo taken 1
grep -E "^\| [0-9]" /tmp/impl490/s3/narrow5.log
pgrep -af "overlap-gate|goal-gate|xvfb-run|pulseaudio -n"   # nothing of mine runs
```

Scripts: `/tmp/impl490/run.sh` (slot wait + narrow gate + summary), `/tmp/impl490/lvl/{sweep,measure-level,cutroom,cutdump}.ts`, `/tmp/impl490/watch-real-sinks.sh <log>` (start before a run, kill by PID after).
