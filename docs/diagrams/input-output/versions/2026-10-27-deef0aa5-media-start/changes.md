# Input-to-output chart — 2026-10-27, base `deef0aa5` + a song plays before it says Playing (#488)

- **Source:** base `deef0aa5` (`main`, 27 October 2026), plus the #488 implementation in worktree `impl-488` (staged and unstaged). The behaviour is in `src/main/music/player.ts` (`startOf`, `playOn`, `holdUnstarted`, `openPick`, `advanceInBackground`), `src/main/music/youtubeScripts.ts` (`START_SCRIPT`, the `play` op keeping a refusal) and `src/main/music/attachPlayer.ts` (the `media-start` span). The containing commit records the exact snapshot.
- **Previous chart:** base `36c1f57a` + #422 (update by voice), 27 October 2026: [`../2026-10-27-36c1f57a-update/chart.html`](../2026-10-27-36c1f57a-update/chart.html).

## Behavioral changes since `36c1f57a` + #422

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A `play`'s watch page landed (also a queued song the Queue opens in the background) | — | The Player reads the media element every 250 ms. It counts as started when it is not paused, not ended, `readyState` > 2, and its time has moved 1.5 s. It no longer says "Playing" just because the page landed. | `startOf`, `START_SCRIPT` |
| The same | not playing by 2.5 s | It presses the element's own play once (one evaluate, by kind) and reads for another 2.5 s. | `startOf` (`control({ op: 'play' })`) |
| The same | still not playing after the press | The watch page is opened again once in full (navigate, landing, level), then read and pressed once more the same way. | `playOn` |
| The same | it plays | The Answer is "Playing “…”." and the Command ends `done`, as before. | `openPick` |
| The same | it never plays | The Command ends not done with "“&lt;title&gt;” opened but didn't start.", shown and said with no Try line (`play` has none). The Queue keeps the song, paused, so "play"/"resume" presses it, and its Remembered Song is kept. | `holdUnstarted`, `PlayerOutcome.unstarted`, `nextLine` |
| A queued song opened in the background | it never plays | The song is held paused. There is no Answer. | `advanceInBackground` |
| Every try | — | A `media-start` perf span (started, pressed, reopened, the refusal, the element, ms, background). | `attachPlayer` `onStart` |
| During the wait | a later Command | It supersedes the wait, which answers nothing. | `current()` checks in `startOf` / `playOn` |
| During the wait | custody withholds the page | The start is unread and is taken as playing (as before #488). | `startOf` |

While it waits, the Capsule stays on the runner's existing Loading stage (youtube.com, its seconds counting). No new stage was added.

## Views

- **Whole journey:** recaptured and inspected. No box or arrow changed: a Player verb is still a sure pick on the Appliance Card, and `play <words>` is still an exact command that the app performs. The note under "It does what Jev picked, and the line ends there" now says that a play says "Playing …" only once the song plays, and otherwise "… opened but didn't start." The note's update clause is shortened to "says what it found", and the restart is kept in the #422 details bullet. The note is one line longer and moved 6 units down; it clears the "no usable action" connector. A new details bullet (#488) gives the bounds, the press, the reopen, the held song, the Loading stage and the `media-start` span. A source reference was added.
- **When you speak:** unchanged; its capture is kept.
- **How it chooses an action:** unchanged; its capture is kept.

## Simplifications

The new failure is not drawn as its own red box. It is one of the Player's Answers and ends the line, like the update's "Couldn't check for updates." (#422). The existing red stop on the action road covers an exact `play` line that fails.
