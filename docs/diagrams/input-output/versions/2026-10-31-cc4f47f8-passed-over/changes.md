# Input-to-output chart — 2026-10-31, base `cc4f47f8` + #538 (accompanying implementation changes)

- **Source:** base `cc4f47f8` (`main`, 31 October 2026), plus #538: `src/main/music/player.ts`, `src/main/run/commandRunner.ts`, `src/core/music/songLines.ts`.
- **Previous chart:** [`../2026-10-31-59183990-throw-roads/chart.html`](../2026-10-31-59183990-throw-roads/chart.html), which this one replaces.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A song ends with one queued, the queued song's lookup failing | the song that ended was on the watch page, and the pane is still on that page when the lookup fails | Its watch page opens in the pane, which is the Player's already. No `shown` event, so the Idle Screen stays up. Before, it was passed over, silently, and the screen stayed on the last song, paused. | `open` |
| That same background wait | a watch page opening instead | The Wait Card shows “The watch page instead”. The Capsule is not told, since no Command waits. | `fallBack`, `tellWait` |
| The same end | the song that ended was on the audio road, or the person took the pane during the lookup | Still passed over: the pane may hold a page of the person's own. | `open` |
| A queued song passed over, on either road | whether or not the queue goes on | One `speak` in no turn, a failure, goes to the Feed and is said: `“<title>” can't be played. Say play and its name to open its page.` Before, nothing was said. | `onPassedOver`, `passedOverLine` |
| A background open overtaken by a later line | it failed after the overtaking | Nothing said, and the later line's song is not dropped from the Queue. | `advanceInBackground` |

The sentence's second half is a labelled guess in `passedOverLine`: no measure reaches spoken wording, and the owner's next report on it settles it.

Not changed, and not drawn: a queued song whose lookup answers but whose stream will not start in the background is still held unstarted, paused on its card, with nothing said.

## Layout and terminology

- **The whole journey:** no box or arrow added or removed. The note beside the audio road's fallback says what a queued song does on each road and carries the sentence; it grows downward into empty space. The note above it said audio-only music is “off by default”, stale since `78aed4f0`: it now says on. Recaptured: `overview.png`.
- **When you speak** and **How it chooses an action:** no drawn change; `voice.png` and `decisions.png` are retained.
- The details gain one bullet and the source references gain `songLines.ts`.
