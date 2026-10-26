# Input-to-output chart — 2026-10-26, base `b7a6586c` + the Turn Card (#474)

- **Source:** base `b7a6586c` (`main`, 26 October 2026, after #471), plus the #474 implementation on branch `worktree-turn-card-474`, in `src/core/idle/turnCard.ts` (the fold), `src/renderer/src/useTurnCard.ts`, `src/renderer/src/TurnCard.tsx`, `src/renderer/src/IdleScreen.tsx` (the Status Capsule's idle form removed), `src/renderer/src/App.tsx`, `src/renderer/src/IdlePrompt.tsx`, `src/renderer/src/PeekCard.tsx` and `src/core/panel/peekCardState.ts` (the Peek Card's Idle Screen form removed). The containing commit records the exact snapshot.
- **Previous chart:** base `57c508a8` + the screen through a Hot Listen (#472), 26 October 2026: [`../2026-10-26-57c508a8-hot-listen-capsule/chart.html`](../2026-10-26-57c508a8-hot-listen-capsule/chart.html).

## Behavioral changes since `57c508a8` + #472

No transition changes: what is captured, read, fired and ended is the same, and the Idle Screen still goes down only on a Command that touches the pane. What changes is what the Idle Screen shows of a line while it runs.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The ear opens for an Utterance (the wake, the hotkey) | the Idle Screen is up | the Turn Card opens, centred on a scrim: “Listening…” with the waveform, the live words whole in its words row (was the Voice Line's 240 px box) | `createTurnCardFold` (`onVoice`), `TurnCard` |
| The transcript lands (`heard`) | the card is up | a Heard row and the words row carry it; a `heard` that trails the line's first stage is slotted in before it | `onHeard` |
| A stage is published (`status`), a sentence spoken (`speak`) | the card is up | the rail lights the station, the stage row says the Capsule's word with the stage's own seconds and its wait named past its bound, the words row its detail; a history row per step (was the Status Capsule floating at the top, its detail ellipsized) | `onEvent`, `turnLive`, `turnStation` |
| The line is read (`command`) | the card is up | a Read as row (the action; “no Command” for a dropped line); a hop-0 `command` for another line restarts the card, keeping that line's ear rows | `onEvent` (`command`) |
| The line ends (`done`) | the card is up | Done, Failed (a failure Answer counts, whatever the outcome says), Stopped or No response, the Answer in the words row; the card goes 15 s after the later of `done` and the last `spoken` (`PEEK_CARD_LINGER_MS`); a tap closes it (was the Peek Card's Idle Screen form, failures only) | `onEvent` (`done`), `expire`, `dismiss` |
| Speech starts after a line has ended | the Hot Listen is open | the next line's card; an open ear that has heard nothing yields to the running line or its end, the waveform saying it is open (#472) | `onVoice`, `turnLive` |
| The ear closes on nothing | the card is up with nothing heard | the card goes after a 1 s grace (a guess, marked) | `onVoice`, `BLIP_GRACE_MS` |
| A typed Idle Prompt line | the Idle Screen is up | the card opens on its first event; the Prompt sits at the foot of the screen, its scrim stood down | `adopt`, `IdlePrompt` (`aside`) |

## Chart changes

- **The whole journey:** the note beside Jev now ends “the Idle Screen’s Turn Card too”; the output note ends “on the Idle Screen the Turn Card does.” `overview.png` recaptured at 1440 × 2200 and inspected; a 700 px capture inspected (scrolls sideways as before, both notes legible).
- **Important details:** the Peek Card bullet points to the Turn Card for the Idle Screen; the stages bullet names the Turn Card; a #474 bullet.
- **Source references:** `turnCard.ts`, `useTurnCard.ts` and `TurnCard.tsx` added; `peekCardState.ts` no longer names an Idle Screen form; the base line updated.
- **When you speak** and **How it chooses an action:** unchanged; `voice.png` retained from the previous version, `decisions.png` recaptured and inspected (unchanged).
