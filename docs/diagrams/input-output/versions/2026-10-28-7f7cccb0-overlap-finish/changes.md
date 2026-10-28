# Input-to-output chart — 2026-10-28, base `7f7cccb0` + #489's last changes

- **Source:** base `7f7cccb0` (`main`, 28 October 2026), plus #489's last commits on branch `worktree-impl-489`: `2a88d530` (a joined line's ask offers no Steps), `d0c3d1ac` (the Player never presses a song's start for a Command that ended while the start was read; neither does it open the page again), `b1ff40b2` (a joined line that plays says its Answer), `d9e84eec` and `66a29c97` (a pause ends the Player's consent watch; a clear already out holds the page paused). Also drawn, already on `7f7cccb0` but after the previous chart: `ade43b56` (an ended `play` stops the pane's load and pauses it unless its ender takes the pane) and `8e42bbf4` (the doing fact names a song still opening). The behaviour is in `src/main/run/commandRunner.ts` (`settleFate`, `endRunning`, `Reacting.says`), `src/main/music/player.ts` (`startOf`, `playOn`, `pauseAll`, `holdPaused`) and `src/core/command/runningCommand.ts` (`doingAnswer`). Tests: `src/main/run/commandRunner.test.ts`, describe "an Overlap (#489)"; `src/main/music/player.test.ts`, "a song's start (#488)". The containing commit records the exact snapshot.
- **Previous chart:** base `b746a5c5` + #489, 28 October 2026: [`../2026-10-28-b746a5c5-overlap/chart.html`](../2026-10-28-b746a5c5-overlap/chart.html).

## Behavioral changes since `b746a5c5` + #489

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Fate joins | — | The joined line's one more ask offers no Steps: the joined line takes one step. Before, the ask could split it back into the running line and a Step on the bare correction, which played a second song. | `settleFate` (`split: false`) |
| Fate joins, and the joined line plays | the Player plays | Its Answer (“Playing “…”.”) is said, not only shown. A typed play's success is otherwise silent. | `Reacting.says` |
| Fate ends, the running line a `play` | its ender does not take the pane | The pane stops loading and pauses; the Player's start watch never presses the song to start, nor opens its page again, once the Command has ended. | `endRunning`, `startOf`, `playOn` |
| Any pause (an ended `play`, `stop`) | the Player is watching the song's page for a consent wall | The watch ends: no wall is cleared after it, since YouTube starts the song as its sheet leaves. A clear already out when the pause came holds the page paused for a self-start's bound (2.5 s + 1.5 s) or until the Player is asked anything. | `pauseAll`, `watchConsent`, `holdPaused` |
| “What are you doing?” | a `play` is opening a song | Says “Still opening “&lt;song&gt;”: loading youtube.com.” | `doingAnswer` |

## Views

- **Whole journey:** recaptured and inspected (`overview.png`, 1440 × 5100). Three notes at the foot changed: under *ends* (an ended play stops loading and pauses, never pressed after), under *joins* (one step; a song it plays is said), under *goes on* (“Still opening “&lt;song&gt;”.”). No box or arrow changed. The details bullet “The Overlap (#489)” carries the same, and the source references name the new base.
- **How it chooses an action:** unchanged; `decisions.png` retained from the previous version.
- **When you speak:** unchanged; `voice.png` retained.

## Simplifications and uncertainty

- Only the Player's Answer is said on a join; a joined line that lands a page says what any landing says. No other joined outcome had an Answer that went unsaid.
- No paid model call was made; drawn from source and its unit tests.
