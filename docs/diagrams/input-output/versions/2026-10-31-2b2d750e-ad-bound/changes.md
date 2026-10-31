# Input-to-output chart — 2026-10-31, base `2b2d750e` + #549 (accompanying implementation changes)

- **Source:** base `2b2d750e` (`main`, 31 October 2026), plus #549: `src/main/music/player.ts`, `src/core/perf/appTelemetry.ts`.
- **Previous chart:** [`../2026-10-31-b0a73b1b-refused-stream/chart.html`](../2026-10-31-b0a73b1b-refused-stream/chart.html), which this one replaces. Its details said a line runs through the whole ad, with no limit: that no longer holds.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A start reading an ad whose time moves | the ads have held it 120 s, across a pod | The line ends, not a failure: “An ad first, 2:00 of 5:00, then “…”.” Before, it had no upper bound and no answer. | `startOf`, `AD_START_MS`, `playSongOn` |
| The song after that line | any | It stays current and unpaused, and Now Playing goes on counting the ad. It plays when the ad ends. | `leftOnAd` |
| The ad ends, the song left paused | the person did not pause it | The poll presses it. A press that does not take holds it paused on the card, and `resume` presses it. | `pressLeftOnAd`, `holdUnstarted` |
| A queued song opening on such an ad | in the background | Neither held nor passed over: the same road. | `playQueued` |
| A stuck ad, its time still | any | Unchanged, now held by a test: pressed, reopened, “opened but didn't start”, within seconds. | `startOf` |

The Answer's words are the Appliance Card's own (`say_playing`), no new vocabulary.

## Layout and terminology

- No box or arrow added or removed in any view. The change is a bullet in the details and the source note, neither in a capture, so `overview.png`, `voice.png` and `decisions.png` are retained. The main view and the details, opened, were captured and inspected.
- The source note now names its true base; the previous version's still said `cc4f47f8` + #538.

## Deliberate simplifications

- The drawn note beside a sure pick still says a play ends “Playing …” or “… opened but didn’t start”: the third ending is an ad past 2 minutes, so it stays in the details.
- The 120 s is per start, so a song whose first start was reopened may wait a second bound; a line still ends. Not drawn.
- An ad that sticks after its line has ended stays counted on Now Playing until it moves or the next line comes. Not drawn.

## Unresolved

- 120 s is a guess (#549 ruling 1); the kiosk's `media-start` records with `ad` settle it.
