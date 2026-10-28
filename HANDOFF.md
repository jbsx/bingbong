# HANDOFF — reliability orchestration, 2026-10-28 10:00 → evening

Written by the orchestrator session (job 1394b982) for the next orchestrator. Read this, then the memory index (`~/.claude/projects/-home-jbsx-Projects-bingbong/memory/MEMORY.md`, entry "Reliability orchestration 2026-10-28 afternoon"), then the issues. The previous handoff (job f3a28b39, morning of 2026-10-28) is in git history at 3ee1f127.

## Goal

The owner (2026-10-28 10:00): "the current app as is feels very unreliable… coordinate with the agents implementing the issues… you are only the orchestrator… delegate to opus agents… grill and answer on my behalf… close the issues as you go… 300k handoff / 350k stop… the goal is to make the app as reliable as possible… balance quick hypothesis tests against rigorous baselines." Standing rulings from the morning hold: one gate model (Mammoth), capture slot 3, narrow per hypothesis, full measure at baseline and end, Jev only on the owner's word.

## Headline

**Overlap run of record: 21/26 through at 6588a8b1** (note 4109613347 on #486, fixtures a2ad6f64), from 18/26 at 6e0279eb that morning and 3/24 at 919f058f when the gate was built. Nothing lost; no consent-sheet or pre-roll-ad cell is red any more; `10-stop-while-speaking` measures true now (exact "Stopped.") and is red ×3, which is #490's. `2-correct-the-other-one` p3 is green on the amended shape check (77116bc5), so the honest count is 22/26 on the kept run.

## Completed work (all on gitlab `main`, pushed; all CLOSED)

| Issue | What landed | Measure |
|---|---|---|
| #495 | An ask over the Card Budget is never sent whole: an address past 300 chars is cut to its origin + the host its query names (arm A), the fit has a floor, opaque runs weigh at the measured 1.39 chars/token, a size 422 is retried once tighter and never walks the Fallback Hosts | jev:gate 386/438 = baseline; the grown case yes 0.77 at 772 ms |
| #499 | The line just ended stays on the Appliance Card 15 s as `say_doing`; "is it working" after a play is said aloud | lure set 138/175 = baseline; jev 387/443 vs 386/442 |
| #496 | The page tells the browser when a consent wall draws over playing media (MutationObserver + CDP binding); the Player clears through the browser's own clear with no page collect (arm b); the wait after the click is clock-bound 1,500 ms; a song the wall paused is resumed once; harness `quiet()` holds while a pane read is outstanding | consent reds 7 → 0; draw→click p50 ~3.1 s → ~1.1 s; play Felt Reaction unchanged |
| #497 | The Media Engine's `ad-showing` fact: a pre-roll ad is not the song's start; the line waits through it narrated ("An ad first, 0:05 / 2:00"); a seek over an ad is held; Skip offered as the media op `skip`; `media-start` records `ad` | gate nothing lost; play p50 1391 → 1416 ms (noise) |
| #498 | A held pick rides the joined card with `correct`/`correct_back` (arm A tied C at 18/19); a joined Slot offers no span across the join (arm c, 2/2); `picked?()` on the Player | jev 387/443 identical; 392/448 with new cases |
| #501 | Every ask is built to the Card Budget by kind (Errand, appliance, site, settings, Shelf) with #495's floor, cut record and retry | jev 417/469 unchanged; goal:gate nothing lost |
| lint | main lint-clean at bcc34a39 | pnpm test 4192 green |
| record | 2-correct-the-other-one's `said` checked on its shape, never judged (77116bc5); #504 and #505 filed from the record's reds | |

## In-progress work (live when this was written)

- **#505** (a seek while the song starts leaves it paused): implementer in worktree impl-505. Rulings on the issue: the Player arm first (same shape as #496's resume), one poll interval, `back`/`restart` share the rule.
- **#504** (a timed-out reading over a running play goes to the Planner silently): implementer in worktree impl-504. Rulings: default Fate `replace` for a grammar verb head else `add-on`, fired on the Local Match's best guess and said; Planner handoff aloud; a harness switch forces the timeout; the 3 s in `.env` stays.
- **#502/#503** (the audio road, yt-dlp) are the OWNER'S OWN session (worktrees impl-502-*): do not touch.

## Open for the owner

- **#500**: a line read `none` is shown muted and never said; Reliability rule 5 says said. 83 of 181 kiosk lines read `none`, so what is said and how short is the owner's call before it is built.
- **#490**: speech over the app's voice, off by default; next measure is the kiosk's `speaking-*.wav` dumps after a day of spoken lines (none since the 10:01 push at the time of writing).
- **Kiosk**: runs 0.1.4-local.202610281000 (= 94a8fb6d, the morning). Everything above is NOT on the kiosk; `pnpm kiosk:push` from main on the owner's word when the kiosk is idle.
- #469, #439, #452, #415 unchanged.

## Key decisions (each a note on its issue)

- Implementers: `claude -p --model opus --permission-mode auto --settings <job>/tmp/impl-settings.json -w impl-N` (the skip-permissions flag is refused by the classifier); a second/third pass runs from inside the worktree with the brief + HANDOFF-N.md. Every issue took 2–3 passes of ~300k; the handoffs resumed cleanly.
- Jev replays may run beside overlap gates; ONE jev gate at a time (`flock /tmp/bingbong-jev-gate.lock`). A replay that yields to every overlap gate starves with three implementers (12:45 ruling).
- The 4 `-mark` image cases never answer on a text model: excluded from every baseline/final comparison.
- Per-issue handoffs are `HANDOFF-N.md`; the root `HANDOFF.md` is the orchestrator's (removed once by a wrong brief line, restored a1962302).
- ADR/CONTEXT amendments are DRAFTED in closing notes, never edited (owner's draft-first rule): #496 (CONTEXT consent entry), #497 (ADR 0080 + CONTEXT Player), #498/#499 (ADR 0097 `say_doing` beyond a running line, the joined pick), #501 (ADR 0088). The owner lands them.

## Approaches that failed (do not retry)

- #496 F4 at 5,000 ms (a tie with 1.5 s, every collect behind a staying sheet waited 5 s). The harness alone (F3) fixed none of the consent class.
- #499: the ended line on the card's state (lured the next line's own action 0/5); arm A wording 0.44.
- #498: joined-Slot arms a and b (0/2); arm c won.
- #495: an opaque threshold at 80 chars (27 accepted cards went over); chunked jev:gate with whole-chunk retry on 429 text.
- `until ! pgrep -f "<pattern>"` self-matches its own zsh (killed twice for #498); bracket a character.

## Next steps, in order

1. Finish #505 and #504 (live); rerun the overlap set once at their landing commit and post it on #486 as the next run of record.
2. Owner: `pnpm kiosk:push` from main, then a day of spoken lines with `BINGBONG_AUDIO_DUMP=1` (feeds #490, #439, #469, #497's F2 guess via `media-start.ad`).
3. Owner: rule #500 (the spoken `none`), land the drafted ADR/CONTEXT wordings.
4. #490 from the kiosk dumps.

## How to verify state

```sh
git -C ~/Projects/bingbong fetch gitlab && git -C ~/Projects/bingbong log --oneline -5 gitlab/main
pnpm test && pnpm lint && pnpm typecheck
pnpm bugs                                      # open lines: #490's, #504, #505, the unclaimed record lines
pnpm overlap:gate --cases 2-correct-by-coldplay --points 1 --models decision-models/baseten-mammoth-27b-latest   # consent clear, one case
pnpm jev:overlap                               # 13/14 (overlap-8-split-landed is the named gap)
ssh jbsx@192.168.1.217 'ls -l ~/.local/bin/bingbong.AppImage'   # 10:01 Oct 28 = 94a8fb6d
```
