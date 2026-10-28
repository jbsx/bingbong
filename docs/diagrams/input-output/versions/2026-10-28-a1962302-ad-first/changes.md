# Input-to-output chart — 2026-10-28, base `a1962302` + #497’s accompanying implementation changes (a pre-roll ad is not the song’s start)

- **Source:** base `a1962302` (`main`, 28 October 2026), plus #497’s first slice: `src/main/music/youtubeScripts.ts` (`START_SCRIPT`, `StartRead.ad`, `StartRead.duration`), `src/main/music/player.ts` (`startOf`, `showAd`, `readWatch`, `nowPlaying`, `PlayerStart.ad`), `src/main/music/attachPlayer.ts` (the `media-start-ad` span), `src/core/music/nowPlaying.ts` (`NowPlaying.ad`, `AD_FIRST`, `adWait`, `nowPlayingView`) and `src/renderer/src/NowPlayingCard.tsx` (the view’s title). The containing commit records the exact snapshot.
- **Previous chart:** base `9bf8b3b5` + #502’s audio road: [`../2026-10-28-9bf8b3b5-audio-road/chart.html`](../2026-10-28-9bf8b3b5-audio-road/chart.html). This version is drawn on that chart.

## Behavioral changes since `9bf8b3b5` + #502

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A song just opened is read for its start (every 250 ms) | the engine says an ad plays in the element (`ad-showing` on `#movie_player`) | The read is not a start, and its time does not count toward the 1.5 s. While the ad’s time moves, the start’s bound holds: no press and no reopen. The line stays running. | `startOf`, `START_SCRIPT` |
| The same | the ad has ended (a read with no ad) | A fresh self-start bound begins, and the start is decided on the song’s own time. Then “Playing “…”.” is said and the line ends `done`, as before. | `startOf` |
| The same | the ad stands still (paused or stalled) | The bound runs as for any element that is not playing. A press plays the ad and the bound still applies, so a stuck ad never holds the line forever. | `startOf` |
| An ad plays in the song’s element (during the start, or later at the poll) | — | Now Playing carries `ad`: its seconds and length, read off the element. The Idle Screen’s card says “Starting”, its title line reads “An ad first”, and the bar and times are the ad’s (0:05 / 2:00). The song’s title shows only once the song plays. | `showAd`, `readWatch`, `nowPlayingView` |
| A line given while the ad plays | — | It meets the play still running, so the Overlap reads it (a Fate of ends, joins, waits or goes on). Before this change the play had already ended, saying “Playing”. | `startOf` (the outcome waits on the start) |
| A start is recorded | an ad held it | `media-start` carries `ad`: the ms the ad held the start, or null. An ad-held start is also a `media-start-ad` span, so it has its own row in `pnpm perf:report`. | `PlayerStart.ad`, `attachPlayer` |

## Chart changes

- **The whole journey:** no box or arrow changes, as with #488’s start wait. The ad wait is one more condition inside the existing “the Player reads the element until it plays” step. `overview.png` was recaptured at full height (1440 × 6200) and inspected. It is pixel-identical to the previous version’s, with nothing clipped.
- **Important details:** a new “A pre-roll ad (#497)” bullet after the #488 start bullet. A copy with the details opened was captured and inspected; the bullet renders in place, with nothing overlapping.
- **Source references:** the provenance now names this base and the #497 files.
- **When you speak** and **How it chooses an action:** unchanged. `voice.png` and `decisions.png` were carried over from the previous version.

## Simplifications and what is not built

- The Capsule’s Acting detail does not name the ad yet: it stays on Loading (youtube.com) with its seconds counting, as #488 charted. The rulings’ “an ad first” in the Capsule and the Appliance Card’s `Playing:` line are the second slice of #497. Their files (`src/main/run`, `src/core/command`) were outside this change’s scope (fork note 4108066401).
- A seek that lands in an ad (`turn-mvrzkyzj-2`) is unchanged: the Media Op still fires on the ad’s element.
- Running through the whole ad (F2 arm a) is a guess, because the gate cannot force an ad. The kiosk’s `media-start` records with `ad` settle it.
