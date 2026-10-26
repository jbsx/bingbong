# Input-to-output chart — 2026-10-26, base `9db2d2ba` + the narrated wait (#438)

- **Source:** base `9db2d2ba` (`main`, 26 October 2026, after the glance surface #436), plus the #438 implementation on branch `worktree-impl-438-wait-and-feed`, chiefly in `src/core/pipeline/stageWords.ts`, `src/core/pipeline/runProgress.ts`, `src/core/feed/feedProjection.ts`, `src/core/command/tryLine.ts`, `src/core/command/answer.ts`, `src/main/run/commandRunner.ts`, `src/renderer/src/AssistantPanel.tsx`, `src/renderer/src/ActivityFeed.tsx`, `src/renderer/src/overlay/VoicePrompt.tsx` and the two stylesheets. The containing commit records the exact snapshot.
- **Previous chart:** base `3a8c5d2f` + the glance surface (#436), 26 October 2026: [`../2026-10-26-3a8c5d2f-glance/chart.html`](../2026-10-26-3a8c5d2f-glance/chart.html).

## Behavioral changes since `3a8c5d2f` + #436

No transition changes: what is read, fired and ended is the same. What is shown and said changes.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A hop's `acting` status | any Command | carries the action's own word ("Opening", "Searching", "Clicking", "Playing"; "Acting" for a verb with none) and its object in the person's words (host, terms, label), not the action line | `actingWords` |
| The Capsule's pill | a stage is the state shown | the stage's word with "…" ("Opening…", "Loading…"); the hint is the object and the seconds | `StatusPill`, `stageWord`, `runProgressParts` |
| A `loading` status | the same hop's action named an object | Loading is on that object in the hint and the Feed | `createRunProgressTracker`, `stageLine` |
| The Feed's Run Detail | every status | "Thinking", "Opening example.com", "Loading example.com", "Speaking", "Stopped", not "Understanding" / "Working on the page" | `stageLine` |
| A failure's Answer | a line exists that would have worked | shown as the line, a blank line, `Try “<line>”.`; said as the line then the Try sentence | `nextLine`, `withNextLine`, `answerFailure` |
| "No response" | any | its reason in the person's words, never naming Jev, and `Try “help”.` or `Try “read”.` | `noResponseAnswer` |
| A Command's Feed entry | — | no time of its own; its result's time is the one time | `FeedLine` |

## Chart changes

- **The whole journey:** the red "No response" box adds "a line to try instead"; the speech note says failures show and say a line to try; the "Repeat" note names the action's word ("Opening…") and its object. Re-captured and inspected (`overview.png`).
- **How it chooses an action:** the red "No response" box adds "a “Try” line". Re-captured and inspected (`decisions.png`).
- **Important details:** a bullet on the narrated wait and the next line.
- **Source references:** `stageWords.ts` and `tryLine.ts` added; the base line updated.
- **When you speak:** unchanged; its capture (`voice.png`) is retained from the previous version.
