# Input-to-output chart — 2026-10-29, base `9fe97ba0` + #508’s `resume` over a running line (read on the Overlap card)

- **Source:** base `9fe97ba0` (`main`, 29 October 2026), plus #508’s change: `src/main/run/commandRunner.ts` (`exactOf`, used by `read`, `readPageCard` and `readPartial`). The containing commit records the exact snapshot.
- **Previous chart:** base `5f3a440b` + #500’s spoken `none`: [`../2026-10-28-5f3a440b-none-said/chart.html`](../2026-10-28-5f3a440b-none-said/chart.html). This version is drawn on that chart.

## Behavioral changes since `5f3a440b` + #500

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| “resume” (or “continue”) is given while another line runs | the pane shows a real page, the Appliance Card is on | Before: the grammar’s `resume` fired on its words with no ask; as a line that takes the pane it ended the running line (“Stopped playing highs and lows by Kanye West.”) and answered “Back on <page>.”. Now: it reopens nothing, so it is no exact line: the words go to the Appliance Card with the running line on it, and Jev picks the action and its Fate. On the gate’s `4-resume-at-2200ms` Jev reads `waits` (0.75–0.84), so the song plays and the line is read again once it has. | `exactOf` |
| The same, spoken, as a partial | a line runs, a page shown | It waits for its Endpoint instead of firing early. | `readPartial` |
| The same | a blank pane (the Last Page to reopen), or nothing running | Unchanged: an exact line, no ask; on a blank pane it reopens the Last Page and takes the pane. | `resumePlan` |

## Chart changes

- **The whole journey:** the Overlap’s foot note gains one line: “resume” with a page shown reopens nothing, so over a running line it is no exact command: Jev reads it on the card (#508). `overview.png` was recaptured at full height (1440 × 7400); the Overlap section and its note were inspected, and the new line clears the audio road’s section below.
- **Important details** and the source references name the new base.
- **When you speak** and **How it chooses an action:** unchanged; `voice.png` and `decisions.png` carried over.

## Simplifications

- No new box or arrow: the line takes the existing “any other line” road to the card; the note names the one exact line that leaves the by-kind road.
