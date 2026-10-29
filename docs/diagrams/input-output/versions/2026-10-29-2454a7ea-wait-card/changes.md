# Input-to-output chart — 2026-10-29, base `2454a7ea` + #507’s Wait Card

- **Source:** base `2454a7ea` (`main`, 29 October 2026), plus #507’s change: `src/core/music/songWait.ts` (`SongWait`, `songWaitParts`), `src/main/music/player.ts` (`onSongWait`, the `served` wait), `src/core/pipeline/runProgress.ts` (`runProgressParts`), `src/renderer/src/WaitCard.tsx`, `src/main/attachPopupView.ts` and `src/main/index.ts` (the `song_wait` event). The containing commit records the exact snapshot.
- **Previous chart:** base `c1ec6124` + #511’s pending play on the joined card: [`../2026-10-29-c1ec6124-pending-play/chart.html`](../2026-10-29-c1ec6124-pending-play/chart.html). This version is drawn on that chart.

## Behavioral changes since `c1ec6124` + #511

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A music `play` on the audio road looks up its sound | audio-only music on | Before: the Capsule’s Loading said “finding the audio for “…”” with the lookup’s seconds. Now: a Wait Card pops up on whatever surface is up (its own view over the pane’s top; the Idle Screen’s foot; over Settings) with the video’s thumbnail, title and channel, and says “Finding the audio, Ns” counting up; the Capsule says “<song>” and the same words on the same clock. | `SongWait` `lookup`, `onSongWait`, `WaitCard` |
| A `play <words>` the Player has not remembered searches first | audio-only music on, not a video | The card and the Capsule are up as the Command fires (Receipt 35 ms on an 800 ms search in the e2e), named by the words searched with no picture, “Finding the audio, Ns”; the pick then fills in its thumbnail, title and channel on the same clock. A search that finds nothing ends the wait. | `searchNow`, `AskedSong` |
| A stop or a later line ends the play during its wait | the lookup still running | The card closes within 250 ms, not when the lookup returns. | `ownerWatch` |
| The lookup answers with the stream’s served time | `available_at` known | Card and Capsule count down “Playing in Ns” to the served time (plus a 250 ms margin), then “Starting, Ns” until the first sound; the card closes on the first sound. | `SongWait` `served`, `songWaitParts` |
| The road falls back | lookup fails or times out, or the stream won’t start | Card and Capsule: “The watch page instead, Ns” (was “the watch page for “…” instead”); the card closes once the watch page’s song sounds. The Answer is unchanged. | `SongWait` `fallback` |
| A queued song starts | nothing of ours sounding (the last song ended) | It is a wait: the card shows. While ours sounds, no card (ruling 4). | `onSongWait` |
| Audio-only music off | — | Unchanged: no card, the watch page as before. | — |

## Layout and terminology

- **The whole journey:** the audio road’s lookup box names the Wait Card and the Capsule’s new words (380 units wide, from 360). The stream’s arrow label gains “Playing in Ns” to its served time. The fallback note says the new words for the card and the Capsule (one line longer, moved down 10 units). The note under the hidden `<audio>` opens with “The Wait Card closes on the first sound.” (moved down 20 units). The audio road’s bullet under “Important details” says the wait’s new words, surfaces and ruling 4.
- `overview.png` was recaptured at full height (1440 × 7400). The audio road’s section was inspected top and bottom: text in its boxes, labels on their arrows, the notes clear of the details. The voice and decision views are unchanged; their captures are kept.

## Simplifications

- The Wait Card’s placement (pane top, Idle Screen foot, over Settings) is in the bullet, not drawn: it is where a wait is shown, not a branch of the flow.
- The 250 ms margin past `available_at` is left to the source.
