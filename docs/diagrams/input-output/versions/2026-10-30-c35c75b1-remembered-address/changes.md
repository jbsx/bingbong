# Input-to-output chart — 2026-10-30, base `c35c75b1` + #516 (accompanying implementation changes)

- **Source:** base `c35c75b1` (`main`, 30 October 2026), plus #516: `src/main/music/ytDlp.ts`, `src/main/music/player.ts`, `src/core/music/streamMemory.ts`, `src/main/music/ytDlpUpdater.ts`.
- **Previous chart:** base `f2c21d13` + #514: [`../2026-10-30-f2c21d13-no-read-verb/chart.html`](../2026-10-30-f2c21d13-no-read-verb/chart.html), which this one replaces.

## Behavioral changes since `f2c21d13` + #514

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A song's lookup | audio road, no address remembered | `visionos` is asked first (5 s, a guess), then the default clients with what the 11 s bound has left. | `resolveAudioStream` |
| A repeat play | an address that played, within its life | No lookup and no "Finding the audio"; the stream starts on the kept address. | `streamTo`, `createStreamMemory` |
| A remembered address does not play | any | Forgotten; one fresh lookup on the road, narrated; then the watch page as before. | `forgetRefused`, `playOn`, `open` |
| A stream the element gave up on | audio road | The start ends at once, unpressed, where it took 5 s. | `startOf`, `START_SCRIPT` |
| A stream refused or cut | any | Its address is forgotten; it counts against yt-dlp only if it was looked up. | `streamRefused`, `watchStreamFaults` |

## Layout and terminology

- **The whole journey:** no box or arrow added or removed; the music box and the fallback's label carry the new wording. Recaptured: `overview.png`.
- **When you speak** and **How it chooses an action:** no drawn change; `voice.png` and `decisions.png` are retained.
