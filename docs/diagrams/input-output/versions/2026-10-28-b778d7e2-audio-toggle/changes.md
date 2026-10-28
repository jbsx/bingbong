# Input-to-output chart — 2026-10-28, base `b778d7e2` + #502’s toggle (audio-only music in Settings, the lookup narrated, the road on `media-start`)

- **Source:** base `b778d7e2` (`main`, 28 October 2026), plus #502’s owner-asked changes: `src/core/settings/settings.ts` (`audioOnlyMusic`, off by default), `src/core/settings/settingKinds.ts` (its spoken name, “audio-only music”), `src/renderer/src/SettingsPage.tsx` (the checkbox under Browsing, the yt-dlp finding beside it), `src/main/music/player.ts` (`AudioRoad.on`, `roadOn`, `onWait`, the start’s `road`, `lookup`, `fallback`), `src/main/run/commandRunner.ts` (the play’s wait listener), `src/main/index.ts` (the surface always wired, the setting read per song), `src/core/music/audioRoad.ts` (the env names only the yt-dlp), `src/main/hostChecks.ts` (`checkYtDlp`), `src/core/perf/appTelemetry.ts` (songs by road). The containing commit records the exact snapshot.
- **Previous chart:** base `9237b248` + #497’s second slice: [`../2026-10-28-9237b248-ad-capsule-seek/chart.html`](../2026-10-28-9237b248-ad-capsule-seek/chart.html). This version is drawn on that chart.

## Behavioral changes since `9237b248` + #497

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The audio road is taken | before: `BINGBONG_AUDIO_ROAD` set at boot | Now: the `audioOnlyMusic` setting is on (Settings › Browsing, “Audio-only music”, or by voice as an app setting), read at each song. Off by default. The env only names which yt-dlp runs. | `roadOn`, `AudioRoad.on` |
| The setting is turned off | a song plays on the road | That song plays on, its verbs still reaching its element; the next song opens on the watch page (a guess). | `roadFor`, `leaveRoad` |
| A `play` (music) looks its stream up | a Command waits on it | The Capsule’s Loading says “finding the audio for “&lt;song&gt;”” with the lookup’s own seconds, until “Playing “…”.” | `onWait` `lookup`, the runner’s wait listener |
| The lookup fails or times out, or the stream won’t start | a Command waits on it | The Capsule says “the watch page for “&lt;song&gt;” instead”, its seconds going on; the Answer is “Playing “…” on its watch page.” | `fallBack`, `onWait` `fallback`, `onItsWatchPage` |
| The same | in the background (a queued song) | No wait is told: no Command waits on it. | `waitFor` |
| A song starts, or gives up starting | always | `media-start` carries `road`, `lookup` (ms, null on the page) and `fallback`; `pnpm perf:report` prints a “songs by road” line. | `decided`, `songsReport` |
| The app boots | the road’s yt-dlp is not found | A host finding, shown beside the toggle while it is on (not under This computer); a fault line only while the setting is on. | `checkYtDlp` |

## Chart changes

- **The whole journey:** the audio road section’s switch note now names the Settings toggle, read at each song. The music node says the Capsule names the lookup; the fallback’s note says what the Capsule and the Answer say. No box or arrow added. `overview.png` was recaptured at full height (1440 × 6200) and the section inspected; the note and the music node were moved down to clear the note above and the branch label.
- **How it chooses an action:** footnote ³ reads “While audio-only music is on” instead of the env. `decisions.png` was recaptured at full height (1440 × 5560) and inspected.
- **Important details:** the audio road bullet names the toggle, the narrated lookup and the `media-start` fields. A details-open copy was captured and the bullet and the source references inspected.
- **When you speak:** unchanged; `voice.png` carried over.

## Simplifications and what is not built

- The setting applies from the next song; a song already on the road is never moved off it by the toggle.
- A lookup longer than the Loading stage’s stuck bound (7.2 s) shows the generic “page still loading” beside its detail. The kiosk lookup’s p50 is 4.6 s; the `media-start` `lookup` field will show how often it passes the bound.
