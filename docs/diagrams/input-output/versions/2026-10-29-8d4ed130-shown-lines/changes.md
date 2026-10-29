# Input-to-output chart — 2026-10-29, base `8d4ed130` + #513 (uncommitted implementation changes)

- **Source:** base `8d4ed130` (`main`, 29 October 2026), plus #513’s uncommitted implementation changes in the worktree `impl-513-no-tts`: `src/main/tts/piperConfig.ts` (`voice`, `BINGBONG_VOICE=on`), `src/core/tts/shownSpeech.ts` (`createShownSpeech`), `src/main/index.ts` (the speaking gate or the shown speech; the `line` event; the line chimes through aplay), `src/core/pipeline/events.ts` (`{ type: 'line', text, failure }`), `src/core/tts/chime.ts` (`createLineChimeWav`: done rising, failed falling), `src/core/tts/lineOverlay.ts` and `src/renderer/src/LineOverlay.tsx` (the Line Overlay, 15 s, its surface), `src/main/run/commandRunner.ts` (`speakPageRead` removed; `matchOf`: `read` typed only), `src/core/command/localMatch.ts`, `cliGrammar.ts` (`SPOKEN_CLI_HEADS`), `jevReading.ts`, `command.ts` (`read` grammar-only), `tryLine.ts` and `answer.ts` (“Try “help”” for “Try “read””), `src/main/voice/attachVoice.ts` (the ear’s failed line marked a failure). The containing commit records the exact snapshot.
- **Previous chart:** base `2454a7ea` + #507’s Wait Card: [`../2026-10-29-2454a7ea-wait-card/chart.html`](../2026-10-29-2454a7ea-wait-card/chart.html). This version is drawn on that chart.

## Behavioral changes since `2454a7ea` + #507

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any road would say a line (the runner’s `say`, `sayStop`, a site’s question or alert, an Errand’s confirm/question/end, a download, the ear’s “I’m ready” or failed line) | voice off (default) | Published as `line` and shown on the Line Overlay for 15 s or until the next line, with the `done` chime, or `failed` when the line tells a failure. Nothing is spoken. | `createShownSpeech`, `lineAfter`, `LINE_OVERLAY_MS`, `createLineChimeWav` |
| The same | `BINGBONG_VOICE=on` | Spoken by Piper through the speaking gate, as before. | `resolvePiperConfig().voice`, `createSpeakingGate` |
| A line is out | voice off | Nothing is “speaking” (`isSpeaking()` always false): no capture muted, nothing ducks under speech, the over-speech path never arises, the mic hears you whenever a listen is open. | `createShownSpeech` `isSpeaking` |
| A Command whose output was a line | voice off | Its Reaction closes when the line is shown (`onFirstSound` called at once); the line holds nothing running in the Overlap. | `createShownSpeech` `speak` |
| A spoken “read the page”, “read”, “read it”, “read this” | any | Removed: no Local Match phrase; a spoken line heard as `read` is no exact line; Jev’s card (and the Planner’s, built from it) no longer offers `read`. The Planner’s own `read` step (a part of the page’s text into its memory) is unchanged. | `VERB_PHRASES`, `matchOf`, `GRAMMAR_ONLY_VERBS`, `JEV_VERBS`, `errandVerbs` |
| A typed CLI `read` / `read_page` | typed | The page listed silently as a Card (the e2e’s ref listing); nothing spoken. | `matchOf`, `SPOKEN_CLI_HEADS` |
| A failure’s line to try | was “Try “read”” | Now “Try “help””. | `TRY_LINES`, `noResponseReason` |

## Layout and terminology

- **The whole journey:** the intro gains the #513 sentence. Box wording from “said/says/aloud” to “shown/shows/on screen”: the Flag (“Flagged.” shown), the attached file (“The file is set; it shows “Attached …””), the Step’s end (“it shows the section”), the Errand’s done (“It shows the Planner’s own sentence”), confirm (“It asks on screen”), question (“question on screen”), its quiet step (“Answer shown, no chime”), its end (“It ends, showing …”). The note beside the Task check loses “Read also speaks page text” and says the Line Overlay and its chimes instead. Other notes (the site question, `none`, the alert, a copy, an update, the action limit, the Errand loop, the Overlap’s “Stopped …” and its foot note) say shown in place of said; the foot note says no line is held running by its sentence unless the voice is on. No box, arrow or branch was added or removed.
- **When you speak:** the intro says the app does not speak and the mic is never muted for it. The cold-start failure note and the “I’m ready” note say shown with a chime. The Hot Listen note: “after Tasks settle (and speech, voice on)”. The over-speech section keeps its boxes and arrows, with a new note at its left: only with `BINGBONG_VOICE=on`; with the voice off none of it happens.
- **How it chooses an action:** “Refuse it; show …”, “Change it, and show the new value” (node 200 units wide, from 190), “Set it on the field; show …”, “Show “No file …””, and the alert, the facts, the settings and footnote ¹ say shown.
- **Important details:** a new first-but-one bullet says every “said” below means shown and chimed by default; two new bullets, “Shown, not spoken” and “The Page Read is gone”; the Task-end, last-result, Overlap and over-speech bullets amended. Source references list the #513 files.
- **Captures:** all three views were affected and recaptured: `overview.png` (1440 × 7400), `voice.png` (1440 × 3200) and `decisions.png` (1440 × 5560), each inspected in sections after the last change; a 600-wide voice view was checked for sideways scroll. The first captures showed “field; “Attached …” shown” overflowing its box and the voice view’s failure note running into the hotkey connector; both were reworded and recaptured.

## Simplifications

- The Line Overlay is not drawn as a box: every road that said a line now shows one, so it is said once (the main view’s note and intros, the details) instead of an edge from every box.
- “Says” is kept where it is the Capsule or a screen saying something (“The Capsule says “Thinking…””); “said/aloud” about the app’s voice was changed.
- The over-speech section stays as drawn, marked as the voice-on exception, rather than deleted: the switch reverses it.

## Unresolved

- The Peek Card / Ledger Strip keeps its “Speaking” station; from source (`turnCard.ts`, the `speak` event the runner still publishes) it is lit briefly by the shown line. Not seen on screen.
- Whether the Hot Listen’s silence clock waits on anything at a shown line: `isSpeaking()` is false and `waitIdle()` resolves at once, so read as no wait; not run.
