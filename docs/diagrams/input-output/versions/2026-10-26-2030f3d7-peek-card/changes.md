# Input-to-output chart — 2026-10-26, base `2030f3d7` + the Peek Card goes (#470)

- **Source:** base `2030f3d7` (`main`, 26 October 2026, the #470 docs: ADR 0026 amended, CONTEXT **Peek Card**), plus the #470 implementation, chiefly in `src/core/panel/peekCardState.ts`, `src/core/pipeline/lastResult.ts`, `src/core/pipeline/events.ts`, `src/main/run/commandRunner.ts`, `src/renderer/src/usePeekCard.ts`, `src/renderer/src/PeekCard.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/IdleScreen.tsx` and `src/renderer/src/styles.css`. The containing commit records the exact snapshot.
- **Previous chart:** base `ac3d9cd3` + the Idle Screen by voice (#458), 26 October 2026: [`../2026-10-26-ac3d9cd3-idle-screen/chart.html`](../2026-10-26-ac3d9cd3-idle-screen/chart.html).

## Behavioral changes since `ac3d9cd3` + #458

No transition changes: what is read, fired, said and ended is the same. What the screen shows after a Command changes, and the runner publishes one new event.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A `speak` ends (spoken through, cut, or failed to sound) | — | a `spoken` event for its turn | `say` in `createCommandRunner` |
| The Peek Card's Answer | its run's `done` (not cancelled) and none of its sentences still sounding | it goes `PEEK_CARD_LINGER_MS` (15 s) after the later of `done` and the last `spoken`, a bar draining across it | `createPeekCardFold`, `LingerBar` |
| The Peek Card's Answer | a further `speak` of its run (a page read's next part) | its end is held off until that sentence's `spoken` | `createPeekCardFold` |
| The Peek Card's Answer | a tap (opens the panel), the next Command, the panel opened | it goes at once, as before | `retireAnswer`, `onEvent` |
| Over the Idle Screen | the card's Answer is a failure, or the line was read as no Command ("No response."), the Idle Prompt shut, no Weigh-in pop-up up | the card's Idle Screen form in `.idle-popup-place`: the words heard, the sentence at 65 px, the reason and the Try line | `peekCardOnIdleScreen`, `IdlePeekCard` |
| Over the Idle Screen | a success, a Stop, an Answer-less end | no card | `peekCardOnIdleScreen` |
| A tap on the Idle Screen form | — | it is dismissed; the Idle Screen stays up (the tap never reaches the window) | `IdlePeekCard` |
| The Idle Screen's Voice Prompt line, at rest or with the mic off | the last Command failed, or was read as no Command | it keeps that sentence (or "No response.") until the next hop-0 `command` | `createLastResultTracker().failure`, `VoiceLine` |

## Chart changes

- **The whole journey:** the speech note beside "The page changes, or an answer is shown" gains "The card goes 15 s after its line ends; on the Idle Screen, failures only.", and moves down 30 units so it clears the Shelf note above it. Re-captured at 1440×2400 and inspected (`overview.png`).
- **Important details:** a new entry, "The Peek Card goes (#470)".
- **Source references:** `peekCardState.ts` added; the base and previous chart named.
- **When you speak** and **How it chooses an action:** unchanged; their captures (`voice.png`, `decisions.png`) are retained from the previous version, verified there.
