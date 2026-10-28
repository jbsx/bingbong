# Input-to-output chart — 2026-10-28, base `9bf8b3b5` + #502’s accompanying implementation changes (the audio road)

- **Source:** base `9bf8b3b5` (`main`, 28 October 2026), part 1 of #502, which was never charted: `src/core/music/audioRoad.ts` (`audioRoadBinary`), `src/main/music/ytDlp.ts` (`resolveAudioStream`, `RESOLVE_TIMEOUT_MS`), `src/main/music/audioSurface.ts`, `src/main/music/player.ts` (`roadFor`, `open`, `openOn`, `streamTo`, `leaveRoad`, `playOn`, `showFromAudio`, `advanceInBackground`), `src/core/command/command.ts` (`opensAVideo`, `commandKeepsIdle`) and `src/main/run/commandRunner.ts` (`takesPane`). Plus the #502 changes in this worktree (unstaged): `src/core/command/jevReading.ts` (`kindQuestion`, `asksKind`, `readsVideo`, `Appliance.audioRoad`, `applianceCommand`), `src/core/command/applianceCard.ts` (`kind` on the Appliance Card), `src/core/music/queue.ts` (`Song.video`), `src/main/music/player.ts` (`searchQueued`, `playSong` reading the mark, `advanceInBackground` reading it, `onShown`), `src/main/index.ts` (`shown` published from `onShown`), `src/main/run/commandRunner.ts` (`audioRoad` on the appliance; `shown` in place of a second `command`), `src/core/pipeline/events.ts` (the `shown` event) and `src/core/idle/idleWake.ts` (`shown` wakes the dashboard). The containing commit records the exact snapshot.
- **Previous chart:** base `3ee1f127` + #499’s line just ended: [`../2026-10-28-3ee1f127-ended-line/chart.html`](../2026-10-28-3ee1f127-ended-line/chart.html). This version is drawn on that chart.

Everything below holds only while `BINGBONG_AUDIO_ROAD` is set. Unset (the default), every play is as the previous chart shows and no card asks anything new.

## Behavioral changes since `3ee1f127` + #499

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Jev reads a line on any card that offers `play` (the Appliance Card, the page card, the Where Ask, a later hop) | the audio road is wired | One more Choice rides the same call: `kind`, music or video. No extra call. | `asksKind`, `kindQuestion` |
| Jev picks `play`, `play_next` or `queue` | `kind` is `video` at 0.7 or more | The search is read as a video. | `readsVideo`, `applianceCommand` |
| The same | `music`, below 0.7, or no answer | It is read as music: an unsure reading leans music. | `readsVideo` |
| A music `play` | — | The Player’s own search pick (ADR 0076, unchanged) picks the video. yt-dlp looks up its audio stream, bounded at 11 s (a guess). A hidden window plays it in one `<audio>`. The pane is untouched and the Command keeps the Idle Screen up. | `roadFor`, `streamTo`, `resolveAudioStream`, `commandKeepsIdle` |
| A song on the audio road | any music verb, the end-of-song poll, the duck, `stop`, Now Playing, the Appliance Card’s Media Ops | They act on that `<audio>` element. | `evaluate(…, 'song')`, `leaveRoad` |
| A video `play` | — | The watch page opens in the pane, as before. Its Command does not keep the Idle Screen, so the dashboard wakes. | `opensAVideo`, `commandKeepsIdle` |
| A music `play` for a Command | the lookup fails or times out, or the stream will not start | The watch page opens instead (owner’s ruling 3). The outcome is marked `shown`, and the runner publishes `shown`, not a second `command`, which wakes the dashboard. The line still ends done. | `open`, `playOn`, `playSong`, `wakesIdleScreen` |
| A queued song opened in the background (at a song’s natural end) | its lookup fails | The song is passed over and the next one is tried. The pane is never taken. | `open(…, background)`, `advanceInBackground` |
| The same | its stream will not start | It is held paused, as on the page (#488). It is not opened as a watch page. | `playOn` |
| `show` / “show the video” | the song plays on the audio road | Its watch page opens at the second the stream had reached, and the stream stops. | `showFromAudio`, `goTo(at)` |
| A line read while another runs | it is a music `play` on the road | It does not take the pane, so its Fate by kind is not `ends`: the running line goes on. A video still takes the pane. | `takesPane` |
| `play <words> next` / `queue <words>` read as a video | — | The song is queued marked as a video. When a skip reaches it, it opens on the watch page, shown. It also opens there at once when nothing plays. | `searchQueued`, `Song.video`, `playSong` |
| A queued video opened in the background (the song before it ended) | — | It opens on the watch page, not the audio road, and the Player's `onShown` publishes `shown` with no turn: the dashboard wakes, with no Command to show it. | `advanceInBackground`, `onShown`, `wakesIdleScreen` |

## Chart changes

- **The whole journey:** a new last section, “the audio road”, with its own starting dot and a note that it applies only while the switch is set. Jev reads the play and, in the same call, music or video. A sure video goes to “The watch page opens in the pane, shown: the dashboard wakes”. Music or an unsure reading goes to “The Player picks the video; yt-dlp looks up its sound alone”, which splits in two. If the stream starts: “It plays in a hidden `<audio>`: the pane is untouched and the Idle Screen stays up”. If the lookup fails or times out, or the stream won’t start: “The watch page opens instead, shown”. The notes cover the verbs that reach the element, `show the video`, the `shown` event, a queued video, the Overlap, and the background pass-over. The Overlap foot’s note gains a line: a music play on the audio road does not take the pane. The intro names the new section. The view height went from 4620 to 5680. `overview.png` was recaptured at full height and inspected.
- **How it chooses an action:** the Appliance Card box and the page card box each gain “(music or video? beside play³)”. Footnote ³ in the foot note says when it is asked and how it is read. The page card’s two outgoing arrows start 14 units lower to clear its taller box, and the label into the Appliance Card moved up 12. The foot note moved 75 down and the view height went from 4850 to 5000. `decisions.png` was recaptured at full height and inspected.
- **When you speak:** unchanged. `voice.png` was carried over from the previous version.
- **Important details:** a new “audio road (#502)” bullet. The Overlap bullet now says that on the road a `play` takes the pane only when read as a video. The provenance and source references now name this base and the #502 files.

## How the kind reaches Jev

This was a measured tie on `pnpm jev:gate` (Mammoth, 197 cases including 11 new music and video cases). Arm (a) used two Appliance Verbs and arm (b) used the `kind` Choice. Both scored 11/11 with no case lost. Arm (b) was kept because it changes no label and is the cheaper one to reverse. The chart draws arm (b).

## Simplifications

- The section is drawn once, at the foot of the chart. The Appliance Card and page card roads above it are not redrawn. A play on either card fires as before, and the section shows where it goes next.
- `show the video`, the queued video and the background cases are notes, not boxes.
