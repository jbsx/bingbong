# Input-to-output chart — 2026-10-26, base `3a8c5d2f` + the glance surface (#436)

- **Source:** base `3a8c5d2f` (`main`, 26 October 2026, after the hearing receipt #441), plus the #436 implementation on branch `worktree-impl-436-glance-pill`, chiefly in `src/core/pipeline/lastResult.ts`, `src/core/voice/voiceHint.ts`, `src/renderer/src/useAssistant.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` and `src/renderer/src/overlay.css`. The containing commit records the exact snapshot.
- **Previous chart:** base `4af7377e` + the hearing receipt (#441), 26 October 2026: [`../2026-10-26-4af7377e-hearing/chart.html`](../2026-10-26-4af7377e-hearing/chart.html).

## Behavioral changes since `4af7377e` + #441

No transition changes: what is read, fired, said and ended is the same. What changes is the visible output once a line has ended.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A `speak` | the first of its turn since the last hop-0 `command` (a page read keeps its first part; a later hop's turn replaces it) | the Capsule's kept result | `createLastResultTracker` |
| A `site_question` | — | its line is the kept result | `createLastResultTracker` |
| A hop-0 `command` (any new line, a dropped Utterance too) | — | the kept result clears | `createLastResultTracker` |
| The Capsule's hint | the Feed panel is shut, the pill reads Ready, no stage in progress | the kept result, ahead of the wake instruction; the live words still take the slot while you speak | `voiceHint` |

The Toolbar's state word is 65 px, the Idle Screen's voice line and the Voice Prompt's LISTENING too; the type is set on four sizes. None of that changes the flow.

## Chart changes

- **The whole journey:** the speech note beside "The page changes, or an answer is shown" gains "With the panel shut, the Capsule keeps what was said until your next line." Re-captured and inspected (`overview.png`).
- **Important details:** a bullet on the last result on screen.
- **Source references:** `lastResult.ts` added; the base line updated.
- **When you speak** and **How it chooses an action:** unchanged; their captures (`voice.png`, `decisions.png`) are retained from the previous version.
