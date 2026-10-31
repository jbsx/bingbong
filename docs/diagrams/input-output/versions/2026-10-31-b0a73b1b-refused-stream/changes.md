# Input-to-output chart — 2026-10-31, base `b0a73b1b` + #548 (accompanying implementation changes)

- **Source:** base `b0a73b1b` (`main`, 31 October 2026), plus #548: `src/main/music/player.ts`, `src/main/music/audioSurface.ts`.
- **Previous chart:** [`../2026-10-31-cc4f47f8-passed-over/chart.html`](../2026-10-31-cc4f47f8-passed-over/chart.html), which this one replaces. Its changes said a queued song whose stream will not start is “not changed, and not drawn”: that no longer holds.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A song ends with one queued, the lookup answering and the stream refused | the element reported an error, or the request was refused with a status; the song that ended was on the watch page and the pane is still there | Its watch page opens in the pane. No `shown` event, so the Idle Screen stays up, and only the Wait Card tells the wait. Before, it was held paused, unsaid, and the queue stopped. | `playOn`, `hasRefused`, `paneHolds` |
| The same refusal | the song that ended was on the audio road, or the person took the pane | Passed over, shown and said once in #538's sentence, and the queue moves on. The stream is let go, so the Appliance Card reads no dead media. | `advanceInBackground`, `letGoOfStream` |
| The same end, the element only slow | no error and no refused status by the end of its bounds | Unchanged: held paused on the card, nothing said, the queue not moved, and `resume` plays it. | `holdUnstarted` |
| A song held slow, refused afterwards | the poll reads the element's error, or the status has come; a request only cut by the network is no refusal | It takes the same road: its watch page, no longer paused, or passed over and said. Before, `resume` pressed a dead element and answered “Playing”. | `refusedSinceHeld` |
| `resume` with the last song passed over and nothing else held | on the audio road | “Nothing is playing.”, not a press on the emptied element. | `perform` |
| An element on the watch page that reported an error, in the background | after its one reopen | Passed over, by the same fact, not held. | `hasRefused` |
| A song that ended on the audio road, handed to it again | any | Its end is heard again. Before, the surface's page kept the end it had noted, so the song paused at its end and the queue behind it stalled. | `createAudioSurface.load` |

No new wording: the sentence is #538's.

## Layout and terminology

- **The whole journey:** no box or arrow added or removed. The note beside the audio road's fallback adds the refused stream and the held one, one line longer, into empty space. `overview.png` was recaptured and inspected, wide and narrow.
- **When you speak** and **How it chooses an action:** no drawn change; `voice.png` and `decisions.png` are retained.
- The details' #538 bullet gains two sentences.
