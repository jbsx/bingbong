# HANDOFF — reliability orchestration, 2026-10-27 19:30 → 2026-10-28 ~14:00

Written by the orchestrator session (job f3a28b39) at the owner's request when its context grew full. The next orchestrator starts here, then the memory index (`~/.claude/projects/-home-jbsx-Projects-bingbong/memory/MEMORY.md`), then the issues.

## Goal

The owner (2026-10-27): "the current app as is feels very unreliable… #486 is a step towards making the app more robust… you are only the orchestrator… delegate to opus agents… grill and answer on my behalf… close the issues as you go… the goal is to make the app as reliable as possible." Later rulings the same night: quick narrow runs per hypothesis and the full measure only for a baseline; implementers hand over at 300k context (HANDOFF.md, fresh agent, verify first; hard stop 350k); gates run on ONE model (Mammoth); the Electron capture slot is 3 in parallel.

## Completed work (all on gitlab `main`, pushed; local `main` = gitlab `main`)

| Issue | What landed | Commits | Measure |
|---|---|---|---|
| #486 CLOSED | Sequence Cases + `pnpm overlap:gate` (24→26 black-box interruption cases, typed over IPC, spoken through the wake road, Piper stand-ins, calibration, `--keep`, walls, `--check-state`) | b3e0f4bf..deef0aa5 | first run 3/24 at 919f058f |
| #458 CLOSED | Idle Screen by voice docs reconciled with ADR 0096; "home page" line left in the ledger as #485's guess | fc98dcb0 | 6/6 narrow |
| #484 CLOSED (earlier job's implementer) | a page scroll ends on a cheap check | fc98dcb0..36c1f57a | gate 210/242 none lost |
| #488 CLOSED | the Player says Playing only when the element plays, presses once, says not done otherwise | 71b134e4, db820195 | 13-loop green |
| #491 CLOSED | gate waits out an open Errand stage; rows 6/12 reworded | db820195..b746a5c5 | rows 11, 6 green |
| #492 CLOSED | the Player's landing clears YouTube's consent sheet through the browser's own clear | 4af8cd45, 33e75cfe | reopens 4→0 |
| #493 CLOSED | the auth-popup façade routes `land` to the pane: no page collect after a play | 8082ab7d | collects 40→0 |
| #489 CLOSED | **the Overlap read**: the Appliance Card carries the running Command, Jev reads the new line's Fate (replace/correct/add-on/independent/stop/answer), every Fate said; ADR 0097 + CONTEXT Fate; corrections re-read as one (J1); a sounding outcome stays the running line | 8082ab7d..5568cde6 (+ 86d0fbd5 via #490) | run of record 17/25; jev:gate Mammoth 379→384/439, Overlap 9/9→10/10 |
| #494 CLOSED | a split line's second half is read with its fired first half as one; card: the running line right after the words (12/12 Overlap cases); gate audio rooms off the session bus | fe4b3379..f58343c9 | 8-split green on its ruled start |
| #487 CLOSED (sibling orchestrator) | "go back a page" exact line | 7cfcf201, 42876c9f | unit |
| Docs | yield `overlap` row: `missing` → `breaks` 30 → `partly` 20 (17/25, now 18/26); one-model rule; AGENTS unchanged | db5443d7, d6ea60c0 | |
| Run of record | **18/26 through at 6e0279eb** (note on #486, 2026-10-28), states refreshed, 6 new unclaimed ledger lines | d6ea60c0 | |

Kiosk: pushed by the orchestrator at 10:01 on 2026-10-28 on the owner's word: **0.1.4-local.202610281000 = main 94a8fb6d** (everything in this handoff, #490 off by default). The earlier sibling push (03:32, = 7f7cccb0) is superseded. Later pushes are `pnpm kiosk:push` from `main` when the kiosk is idle.

## In-progress work

- **#490 OPEN, ready-for-agent** (speech over the app's own voice, inside a listen). Eight Opus passes. Landed: the gate's audio room; own-voice compare by sound (27/27 own captures caught, 113/114 owner lines kept); the mixed capture told apart by level; the stop at the read; echo-tail memory; echoed stop words never abort; the abort/wake heads' warm-up 12 chunks (false fires over the app's voice 12/84 → 0/84 offline: the root cause of the unstable runs); an over-speech line reading `none` never reaches the Errand. NOT held: row 10 never green twice with the echo negative green; the time-bounded "recent" arm (ii) red ×2; so the ruled reversal is on main: `BINGBONG_OVER_SPEECH` default `off` (4e1d8fa8), the duck road kept behind the flag. Ledger lines claimed by #490: the four short-echo Commands, "Content", "Utah", the garbled long echo, turn-mvr7wxnb-2, turn-mvrpl639-v6, turn-mvrqjcvt-va. Next measure: the kiosk's `speaking-*.wav` dumps (BINGBONG_AUDIO_DUMP=1 is on there) through the offline warm-up/level probes the sixth/seventh notes describe.
- **#495 OPEN, ready-for-agent**: an ask larger than the host's limit (25,562 tokens vs 16,384 on an ad-heavy results page) is cut to the limit by kind. Not started.
- Older, untouched: #469 (ElevenLabs keep/roll back, owner), #439 (kiosk spans owed, owner), #452 (Kaggle wake queue, owner stopped), #415 (needs-info).

## Key decisions and rationale (each is a note on its issue)

- One elegant fix over patches: the Overlap read on the card (#489) is the AGENTS.md "widen the ask" shape; rows 5, 6, 10, 12, 14, 1, 11 were one class (cancel-on-arrival), not seven.
- #488/#492 split: Playing-only-when-true is a fact+mechanism; the consent sheet is a wall, cleared by the browser's own clear, never a press-again rule over a person's pause.
- F1 (5-independent-volume): arm a; "music goes on while a search runs" is a Yield row for the owner, not an issue. F2 (#490): duck, not stop-at-speech-start.
- 1-replace's `said` drops the "because" clause (no principle asks the app to say why; the judge split on it). 2-radiohead and 4-resume expect the song's title as it shows. 8-split starts on a page with history (a person says "go back" when there is a page to go back to).
- #490's "recent": arm (i) (the whole sounding text) was refused because it drops a person's "stop" whenever "Stop" appears anywhere in a 300 s read; arm (ii) time-bounded was ruled, measured red, and the pre-ruled reversal applied.
- Testing balance (owner): one case/one point/one model per hypothesis; the full measure once at baseline and end. One gate model (Mammoth) from 2026-10-28; "nothing lost" compares the Mammoth column (jev:gate 384/439 is the baseline now).
- Context guard: `--settings impl-settings.json` PostToolUse hook (`context-guard.sh`, 300k soft / 350k hard) + a standing-rules file injected once per session; headless agents cannot be messaged, so rulings travel by that file and by issue notes.

## Approaches that failed (do not retry)

- #478's "flag on card" arms (every arm lost a thumbnail case): superseded by the Appliance Card.
- #487's card widening (3 real losses on the full gate): shelved; the exact-line road landed instead.
- #490: a text-window read of a mixed capture (Parakeet merges/drops the line); cut lead 10 frames or cut-to-detection/last-loud-frame; a shorter ducked capture cap (every miss is a cap boundary inside the line); a monitor reset at the words' read (no-op); the whole-text "recent" (drops "stop"); the time-bounded "recent" at this corpus (red ×2).
- #489 J2 (Slot spans carrying the running line's words): a guess, unbuilt; lures on `ends`/`goes_on`.
- Running two overlap gates at once before 5a01fdb4 (one audio room); running jev:gate beside an overlap run on the same host (429s skew both); `pkill`/`pgrep -f` with a pattern that matches the agent's own shell (killed the seventh #490 agent).

## Next steps, in order

1. Owner: speak a day of lines on the kiosk (now on 94a8fb6d) (BINGBONG_AUDIO_DUMP=1 stays on) — this feeds #439, #469 and #490's next measure.
2. File the consent-sheet-over-a-started-song issue (#492's residue: 7 red points across 5 cases in the run of record; the Player's consent watch does not see a sheet drawn at ~0:05 over a playing song) and implement it: it is the largest red class now.
3. Rule and amend `10-stop-while-speaking`: check the exact stop sentence ("Stopped.", confirm the direct-abort road says it) instead of a meaning the judge reads from the article's own "stop" words (false greens at p2/p3 in the record).
4. File the three unowned reds as issues by scenario: a pre-roll ad taken for the song (turn-mvrvb0pl-1); a joined correction searched as one string and played the wrong song (turn-mvrvh7xx-2; #494's named gap: a join on a landed first half reads 0.46 < 0.7); a question arriving just after a play ended was shown, never said (turn-mvrw0yf2-1).
5. #495 (ask over the host limit), then #490 from the kiosk dumps.
6. Keep every implementer under the guard; one gate model; narrow per hypothesis; three Electron runs at most.

## How to verify state

```sh
git -C ~/Projects/bingbong fetch gitlab && git -C ~/Projects/bingbong log --oneline -5 gitlab/main   # d6ea60c0 is the record
pnpm test                                     # 4059+ green at 4e1d8fa8
pnpm bugs                                     # open lines, claimed by #490 / #495 / unclaimed (6 from the record)
pnpm overlap:gate --cases 9- --points 1 --models decision-models/baseten-mammoth-27b-latest   # one case, smoke
pnpm jev:overlap                              # 12/13 (overlap-8-split-landed is the named gap)
ssh jbsx@192.168.1.217 'ls -l ~/.local/bin/bingbong.AppImage'   # kiosk build date; 03:32 Oct 28 = 7f7cccb0
```
Issue notes of record: #486 (run of record 2026-10-28), #489 4104345617, #490 4105662279 (eighth pass), #494 4105276246. Memory: `reliability-orchestration-2026-10-27-evening.md`, `over-speech-490-state.md`, `overlap-read-489-built.md`, `one-gate-model.md`, `capture-slot-three.md`, `implementer-context-limit-300k.md`.
