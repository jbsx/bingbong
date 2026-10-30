# Input-to-output chart — 2026-10-30, base `f3712c4e` + #514 (uncommitted implementation changes)

- **Source:** base `f3712c4e` (`main`, 30 October 2026), plus #514's change: `src/main/index.ts` and `src/main/tts/piperConfig.ts` (the voice back, no `BINGBONG_VOICE`), `src/core/tts/shownSpeech.ts` and the Line Overlay deleted. The containing commit records the exact snapshot.
- **Previous chart:** base `8d4ed130` + #513's shown lines: [`../2026-10-29-8d4ed130-shown-lines/chart.html`](../2026-10-29-8d4ed130-shown-lines/chart.html), which this one replaces.
- **Drawn on:** base `2454a7ea` + #507's Wait Card: [`../2026-10-29-2454a7ea-wait-card/chart.html`](../2026-10-29-2454a7ea-wait-card/chart.html), the last chart in which the app spoke. Only the Page Read's removal was carried over from #513's chart.

## Behavioral changes since `8d4ed130` + #513

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any road would say a line (the runner's `say`, `sayStop`, a site's question or alert, an Errand's confirm/question/end, a download, the ear's "I'm ready" or failed line) | always | Spoken by Piper through the speaking gate. No Line Overlay, no line chime. | `createSpeakingGate`, `createMainTts` |
| A line is sounding | over speech off (the default) | The capture is muted while it sounds, as before #513. | `meetSpeech` |
| A spoken "read the page", "read", "read it", "read this" | any | Stays removed from #513: no exact line, no `read` on the card. | `matchOf`, `SPOKEN_CLI_HEADS` |
| A typed `read` / `read_page` | typed | Stays a silent page listing. | `matchOf`, `cardOf` |
| A failure's line to try | an item the page lacks, an unsure end | Stays "Try "help"" (a guess from #513). | `TRY_LINES` |

## Layout and terminology

- **The whole journey:** the output note loses "Read also speaks page text"; the Overlap note names a fact, not a Page Read, as a line still saying its outcome. Recaptured: `overview.png`.
- **When you speak** and **How it chooses an action:** no drawn change against the Wait Card chart; `voice.png` and `decisions.png` are retained from it.
- **Important details:** a new bullet says the Page Read is gone; "Try "read"" became "Try "help""; the Capsule's kept sentence no longer names a page read; the Overlap detail no longer lists one. Every "said" means said, as it did before #513.

## Simplifications

- None beyond those of the Wait Card chart this one is drawn on.

## Unresolved

- None.
