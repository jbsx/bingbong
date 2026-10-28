# Input-to-output chart — 2026-10-28, base `df603a62` + #504’s timed-out Overlap road (the grammar’s Fate, said; the Planner aloud; one Errand at a time)

- **Source:** base `df603a62` (`main`, 28 October 2026), plus #504’s changes: `src/main/run/commandRunner.ts` (`read`’s failed Appliance Card ask over a running line, `overTimeout`; `perform`’s Errand road for such a line; `goesOnSaid`; `startErrand`’s `aloud` and its end of an earlier Errand; `endRunning` naming a line held by its Errand and ending the media its steps opened), `src/core/command/runningCommand.ts` (`fateUnread`, `newGoalLine`), `src/core/command/localMatch.ts` (`headsAVerb`). The containing commit records the exact snapshot.
- **Previous chart:** base `b778d7e2` + #502’s toggle: [`../2026-10-28-b778d7e2-audio-toggle/chart.html`](../2026-10-28-b778d7e2-audio-toggle/chart.html). This version is drawn on that chart.

## Behavioral changes since `b778d7e2` + #502

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line is read over a running one, and the Appliance Card’s host fails (timeout, 429, transport) | the line is not an exact command | Before: the page card was asked too, and a failure there made `none` with Fate `goes_on`, unsaid. Now that failed ask is the reading: no page card ask, and the Fate is the grammar’s own read. A line that opens with one of the grammar’s verb heads (open, play, search, read, navigate, go to …) is `ends`; any other line is `goes_on`. | `read`, `fateUnread`, `headsAVerb` |
| The same, Fate `ends` | always | The running line ends as any `ends` ends it (its Errand too, a play’s load stopped and paused), “Stopped …” said. A line running only through its Errand is named by its words (“Stopped “play radiohead”.”). | `settleFate`, `endRunning` |
| The same, with no action of its own | a Planner is set up | Before: a greyed “No response”, then the line handed to an Errand silently. Now it is an Errand line, as `errand <words>` is (Feed: `errand: <line>`), handed over aloud: “Taking that as a new goal: &lt;line&gt;.”, shown and said, the stop line (or the doing sentence) ahead of it as one sentence. | `perform`, `newGoalLine`, `startErrand` |
| The same, Fate `goes_on` | always | The running line’s doing sentence is said (“Still on “open bbc.com”: opening bbc.com.”), ahead of the handoff, or alone with no Planner. | `goesOnSaid` |
| The same | no Planner | “No response” as before, the stop or doing sentence said. | the Task’s none road |
| A line held by its Errand is ended (`ends` or `stop`) | a step of that Errand opened or started something (a navigate, click, `play`, media op … on any site) | Before: only a line that fired `play` itself had its load stopped and its media paused; an Errand’s own play kept playing. Now the Errand owns its media: the load stops and the pane’s media pauses, as a `play` line’s does. A step that opens nothing (scroll, type, read) leaves the media alone. | `endRunning`, `errandAct`, `LEAVES_MEDIA` |
| An Errand starts | another Errand is under way | Before: the later one ran beside the first. Now the later one ends the first as an `ends` ends it, said. | `startErrand`, `errandLive` |

An exact line over a running one whose ask fails keeps its Fate by kind (unchanged). A line with nothing running is unchanged.

## Chart changes

- **The whole journey, the Overlap foot:** a third branch from “You give another line while an earlier one is still running”, labelled “any other line, every host fails”, to a new box: “No host answers: a command word (open, play…) ends it; any other line goes on”, which feeds the Fate diamond. The Jev box was reworded to four lines and moved right to make room. The foot note gains two lines on the said lines and one Errand at a time; it and the audio road section below were moved down (the view is 90 units taller). `overview.png` was recaptured at full height (1440 × 7400) and the Overlap foot, the audio road section and the page’s bottom inspected.
- **Important details:** the Overlap bullet says what a failed host does over a running line. A details-open copy was captured and the bullet inspected.
- **When you speak** and **How it chooses an action:** unchanged; `voice.png` and `decisions.png` carried over.

## Simplifications

- A line with a verb head only after its first words (“no, play the other one”) goes on: the head is read at the start only (the orchestrator’s ruling 1).
- The harness switch `BINGBONG_OVERLAP_SLOW_HOST=1` that measures this road is a test’s, not the app’s, and is not drawn.
