# Input-to-output chart — 2026-10-31, base `857c3eb7` + #550 (accompanying implementation changes)

- **Source:** base `857c3eb7` (`main`, 31 October 2026), plus #550: `src/main/music/player.ts`, `src/main/music/youtubeScripts.ts`, `src/main/music/attachPlayer.ts`.
- **Previous chart:** [`../2026-10-31-2b2d750e-ad-bound/chart.html`](../2026-10-31-2b2d750e-ad-bound/chart.html), which this one replaces. Its details said a song not playing by 2.5 s is pressed and, 2.5 s on, reopened: on the watch page that no longer holds for one still loading.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A watch-page start reading an element unpaused, not errored, `readyState` 2 or under, its time not moving | under 45 s since its last sign of life: the landing, an ad's read, its own time moving, a wall cleared | No press and no reopen: it is still loading. Before, pressed at 2.5 s, reopened at 5 s, then “… opened but didn’t start.” | `startOf`, `LOADING_START_MS` |
| The same | at 45 s | The page is opened again, unpressed, with the same bound. A second 45 s ends in “… opened but didn’t start.” | `startOf`, `playOn` |
| A start reading time that moved no faster than twice the clock | any `readyState`, on either road | It is playing. The whole move counts toward the 1.5 s, so one slow read can prove the start, and a rebuffer keeps what it played. Before, it needed `readyState` above 2 and two reads. A faster jump, a seek or a start offset, proves nothing at `readyState` 2 or under. | `startOf` |
| A paused element, or one that errored | any | Unchanged: 2.5 s, a press, 2.5 s, a reopen. A paused element a press takes and that then reads unpaused with no data is still loading, by the first row. | `startOf` |
| A stream on the audio road | any | No load's wait: no player to boot. Time that moved counts as above. A fallback's watch page takes the new bound. | `startOf`, `playOn` |
| A song given up on | its time then moves past where it stood | The poll writes a `media-late` span, the ms since the give-up. A press or restart that started it writes none. | `heardLate`, `givenUp` |

`media-start`'s element also carries `networkState`, `hasSrc` and `buffered`.

## Layout and terminology

- No box or arrow added or removed in any view. The change is a sentence in the details and the source note, neither in a capture, so `overview.png`, `voice.png` and `decisions.png` are retained. The main view with its details opened was captured and inspected.

## Deliberate simplifications

- The drawn note beside a sure pick still says a play ends “Playing …” or “… opened but didn’t start”: both still hold. The bound and the reopen stay in the details.

## Unresolved

- 45 s is a guess, about twice the worst kiosk read of 25 s. The kiosk's `media-start` and `media-late` records settle it.
- The second try takes the same 45 s, a guess: a song that never starts ends its line at about 90 s, where it took about 10 s. No run reached a real stall on the second page, and only a kiosk record would settle it.
