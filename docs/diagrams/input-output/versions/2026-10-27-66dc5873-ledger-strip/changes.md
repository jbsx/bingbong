# Input-to-output chart — 2026-10-27, base `66dc5873` + the Ledger Strip (#475)

- **Source:** base `66dc5873` (`main`, 27 October 2026, after #477's one ask and #476's dialog prose), plus the #475 implementation on branch `worktree-impl-475`, in `src/renderer/src/PeekCard.tsx`, `src/renderer/src/usePeekCard.ts`, `src/renderer/src/TurnCard.tsx`, `src/core/idle/turnCard.ts`, `src/core/panel/peekCardState.ts`, `src/core/pipeline/runProgress.ts` and `src/renderer/src/styles.css`. The containing commit records the exact snapshot.
- **Previous chart:** base `4806a870` + the one ask (#477), 26 October 2026: [`../2026-10-26-4806a870-one-ask/chart.html`](../2026-10-26-4806a870-one-ask/chart.html). This version is drawn on that chart.

## Behavioral changes since `4806a870` + #477

No transition changes: what is run, said and chosen is as before. What is shown with the Feed panel shut changes.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The ear opens for an Utterance (the wake, the hotkey) | the Feed panel is shut and the Idle Screen is not up | the Ledger Strip opens across the pane's foot (the pane's width, 340 px): "Listening…" with the waveform and the live partial, never cut. Before, the Peek Card opened only on the `command` event | `createTurnCardFold`, `usePeekCard` |
| A typed line starts | the panel is shut | the band opens on its "Thinking…" with the line in the words row and a Heard row | `createTurnCardFold` |
| The Endpoint, then `heard` | — | "Transcribing…" with the last words and its seconds, then the heard line in the words row and the history; the heard line stands before the Command's rows wherever main reports it | `turnWords`, `turnHistory` |
| Each stage (`thinking`, `acting` with its word, `loading`, `speaking`) | — | the rail lit at that station, a skipped one unlit; the stage word at 65 px in the Capsule's own words with its seconds from the event's own timestamp; the object in the words row; a history row. A stage reads as the Capsule reads it (`stageEntered`): an action's object rides into its own hop's Loading only | `turnStation`, `stageEntered` |
| The `command` event | — | a "Read as" row with the reading; the action's row carries its word and object, never the raw line | `turnHistory` |
| `done` | — | "Done", "Failed", "Stopped" or "No response" in words, the turn's whole time in grey, the Answer said plain in the words row (two lines, an ellipsis past them) | `plainAnswer`, `turnLive` |
| 15 s after the later of `done` and the last `spoken` | nothing restarted it | the band goes, the edge tab back; a tap opens the panel, opening the panel or the next line ends it sooner (#470's rule, unchanged) | `PEEK_CARD_LINGER_MS`, `lingerDelayMs` |
| The ear closes on nothing | — | the band closes | `createTurnCardFold` |

## Chart changes

- **The whole journey:** the note beside "The page changes…" now says the Ledger Strip across the pane's foot shows the whole journey from the wake to 15 s after the line ends, and the Idle Screen's is the Turn Card; it keeps its ten lines. `overview.png` recaptured and inspected.
- **When you speak:** the Hot Listen note gains the Ledger Strip opening on the wake and carrying the partial, the heard line and every stage, speech beginning restarting it; the view grows from 1,840 to 2,000 px and the note moves to y = 1,850 to fit, as #472's chart did. `voice.png` recaptured and inspected.
- **How it chooses an action:** unchanged in content; `decisions.png` recaptured.
- **Important details:** the #470 Peek Card bullet becomes the Ledger Strip's (#475). The source references gain `turnCard.ts` and `PeekCard.tsx`; `peekCardState.ts` is now the 15 s end and the overlay slot's one element only.
- A narrow (700 px) capture of the whole journey was inspected: the chart scrolls sideways and its labels stay readable.

## Deliberate simplifications

- The band is a note, not a box: it reports the line and changes no transition.
- The Capsule's Acting hint was already the action's object (#438), so the Capsule is not redrawn.
