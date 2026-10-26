# Input-to-output chart — 2026-10-26, base `79ed6fa4` + the Ledger Strip (#475)

- **Source:** base `79ed6fa4` (`main`, 26 October 2026, after #473), plus the #475 implementation on branch `worktree-impl-475`, in `src/core/panel/peekCardState.ts` (the fold's Listening phase, the ear inputs, `TurnLedger`, `ledgerFace`, `railStation`, `plainAnswer`), `src/core/pipeline/runProgress.ts` (`stageEntered`, the one reading of a stage the Capsule and the band share), `src/renderer/src/usePeekCard.ts` (the ear subscriptions), `src/renderer/src/PeekCard.tsx` (the band), `src/renderer/src/overlay/OverlayPanel.tsx`, `src/renderer/src/styles.css` and `src/renderer/src/overlay.css` (the slot the pane's width at its bottom, `--panel-peek` gone). The containing commit records the exact snapshot.
- **Previous chart:** base `57c508a8` + the screen through a Hot Listen (#472), 26 October 2026: [`../2026-10-26-57c508a8-hot-listen-capsule/chart.html`](../2026-10-26-57c508a8-hot-listen-capsule/chart.html).

## Behavioral changes since `57c508a8` + #472

No transition changes: what is captured, read, fired, said and ended is the same, and the runner publishes nothing new. What the dashboard shows of a line while the Feed panel is shut changes from the moment the ear opens.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The ear opens for a line (the wake, the hotkey), or speech begins in an open Hot Listen | the Feed panel is shut | the Peek Card opens as the Ledger Strip across the pane's bottom, "Listening…" with the waveform, "say a command" (was: nothing until the `command` event) | `createPeekCardFold().onVoice`, `PeekCard` |
| A partial lands | the band is listening | the words row shows it whole; the Listening row carries it | `onPartial` |
| The Endpoint fires | — | "Transcribing…" with its seconds from the Endpoint, the last words | `onVoice` (`transcribing`) |
| The line is heard | routed to a Command | the Heard row, before the Command's rows wherever main reports it; the ear closing after it leaves the band up | `onHeard` |
| The line is heard | ignored by the pipeline, or the ear closes with nothing heard | the band closes | `onHeard`, `onVoice` |
| A line's first "Thinking" (typed or spoken) | — | the band goes live on that turn; a typed line's words are its Typed row (was: the band opened only on `command`) | `onEvent` (`status`), `beginTurn` |
| Each stage (`status`) | the band is live | the stage word in the Capsule's words — Acting by the action's own word — its object as the words row, its seconds from the event, the rail lit to its station; a skipped station stays unlit | `onEvent` (`status`), `ledgerFace`, `railStation` |
| The reading (`command`) | — | a "Read as" row with the action; a line read as no Command reads "no command" | `onEvent` (`command`) |
| A sentence (`speak`) | the run's own | the Speaking row and the words row carry it | `onEvent` (`speak`) |
| The run's `done` | not cancelled | "Done" or "Failed" in words and colour, the turn's total in grey, the Answer (its Card, said plain; else the sentence said) as the words row; then the 15 s end as before (#470) | `onEvent` (`done`), `plainAnswer` |
| A new line | speech beginning, a typed line's Thinking, the next `command` | the band restarts on the new turn | `onVoice`, `onEvent` |
| A line fired on its partial (Early Fire) | the ear reads the rest after it | the band keeps the ledger it had; the Capsule alone reports the read | `onVoice`, `onHeard` |
| The overlay slot while the band shows | every panel mode | the pane's width at its bottom, 340 px (was 640 × 124 bottom-centre); the page's bottom 340 px is under it | `.feed-slot--peek` |

Unchanged: the Peek Card's Idle Screen form (#470, the Turn Card is #474); the Toolbar Capsule (its Acting `detail` was already the stage's object on this base, `commandRunner.ts` line 1327).

## Chart changes

- **The whole journey:** the speech note beside "The page changes, an answer is shown" now says the Ledger Strip across the pane's foot shows the whole journey from the wake to 15 s after the line ends, Idle Screen failures only; kept at ten lines so it clears the Shelf note above and the arrow label below. `overview.png` recaptured at 1440 × 2450 and inspected; a 700 px capture inspected (scrolls sideways as before, the note legible).
- **When you speak:** the Hot Listen note gains "With the panel shut, the Ledger Strip opens on the wake and carries the partial, the heard line and every stage; speech beginning restarts it." `voice.png` recaptured at 1440 × 2350 and inspected.
- **Important details:** the Peek Card entry rewritten for the Ledger Strip (#475), the #470 end kept inside it.
- **Source references:** the base line updated; `peekCardState.ts` names the ledger; `PeekCard.tsx` added.
- **How it chooses an action:** unchanged; `decisions.png` retained from the previous version.
