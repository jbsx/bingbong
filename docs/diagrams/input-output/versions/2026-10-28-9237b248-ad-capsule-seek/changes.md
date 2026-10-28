# Input-to-output chart — 2026-10-28, base `9237b248` + #497’s second slice (the Capsule and the card name the ad, a seek over it is held, the engine’s Skip is offered)

- **Source:** base `9237b248` (`main`, 28 October 2026), plus #497’s second slice: `src/main/run/commandRunner.ts` (`adDetail`, `withAd`, `overAd`, the play’s ad listener), `src/main/music/player.ts` (`seekOverAd`, `applyHeldSeek`, `adOverNow`, `skip` with `ad`), `src/main/music/youtubeScripts.ts` (`skippable` in `START_SCRIPT`/`WATCH_SCRIPT`, the `seek` and `skip-ad` controls), `src/core/command/mediaOp.ts` (`skip`, `mediaOpsOf`, `mediaStateOf`), `src/core/command/applianceFacts.ts` (say_playing over an ad), `src/core/music/musicWords.ts` (“skip the ad”), `src/core/browser/snapshot.ts` (`MediaFacts.ad`). The containing commit records the exact snapshot.
- **Previous chart:** base `3e795711` + #498’s joined pick: [`../2026-10-28-3e795711-joined-pick/chart.html`](../2026-10-28-3e795711-joined-pick/chart.html). This version is drawn on that chart.

## Behavioral changes since `3e795711` + #498

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A `play` runs and the Player’s Now Playing carries an ad | the play is still performing | The Capsule’s Loading detail is “an ad first, 0:05 of 2:00”, renewed as the Player counts the ad off the element, until the song plays and “Playing “…”.” is said. | the runner’s ad listener, `adDetail` |
| The Appliance Card is built | the Player counts an ad in the song’s element | The media’s facts carry `ad`: the `Playing:` line reads “an ad first playing 0:05/0:15 …”, with `skippable` while the engine’s Skip button is up; say_playing says “an ad first, 0:05 of 2:00, then “…””. | `withAd`, `mediaStateOf`, `playingValue` |
| A seek (forward, back) is chosen | the Player counts an ad | The Player reads the element once: over an ad, the seek is held and its outcome names the ad (“An ad first, 0:05 of 0:15: the song will skip forward 60 s once it plays.”). The start, or the poll mid-song, puts it on the song once the ad ends: one `seek`, by the words’ seconds or the rung’s share of the song’s own length. | `overAd`, `seekOverAd`, `applyHeldSeek` |
| The same | no ad counted | The op is the browser’s, on the element, as before; no read is added. | `overAd` |
| The card is built | the engine offers to skip the ad | `media-skip` is offered; its pick presses the engine’s Skip (“Skipped the ad.”). | `mediaOpsOf`, `overAd` |
| “skip the ad” (“skip ad”, “skip the ads”, “skip this ad”) | exact line | The Player presses the engine’s Skip if it is up; before that, “An ad first, 0:03 of 0:15: it can’t be skipped yet.”; with no ad, “No ad is playing.”. The Queue is untouched. | `readMusicLine`, `performNow` |
| A bare `skip` | the engine’s Skip button is up | The ad is skipped, not the song. Otherwise the Queue’s skip, as before. | `performNow` |

## Chart changes

- **The whole journey:** no box or arrow changes. The ad wait, the held seek and the skip are conditions inside the existing play and Media Op steps. `overview.png` was recaptured at full height (1440 × 6200) and inspected. It is pixel-identical to the previous version’s.
- **Important details:** the “A pre-roll ad (#497)” bullet now says the Capsule names the ad, and adds the card’s line, say_playing, the held seek and the skip. Its “not built yet” sentence is gone. A copy with the details and source references opened was captured and inspected; the bullet renders in place, with nothing overlapping.
- **Source references:** the provenance names this base, and a new first entry names the #497 second-slice files.
- **When you speak** and **How it chooses an action:** unchanged. `voice.png` and `decisions.png` were carried over from the previous version.

## Simplifications and what is not built

- The browser’s own collect does not read an ad: a media ref on the page card carries no `ad`, so `skip` is offered on the Appliance Card only. The fact reaches the card through the Player (`withAd`).
- Running through the whole ad (F2 arm a) is still a guess, because the gate cannot force an ad. The kiosk’s `media-start` records with `ad` settle it.
- Several seeks asked over one ad: the last one asked is the one put on the song.
