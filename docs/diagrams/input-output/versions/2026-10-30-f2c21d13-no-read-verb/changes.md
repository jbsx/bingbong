# Input-to-output chart — 2026-10-30, base `f2c21d13` + #514's last removal (uncommitted implementation changes)

- **Source:** base `f2c21d13` (`main`, 30 October 2026), plus the removal of the `read` verb: `src/core/command/` (grammar, Local Match, Command, Answer), `src/main/run/commandRunner.ts`, `src/main/cli/runCliHarness.ts`.
- **Previous chart:** base `f3712c4e` + #514: [`../2026-10-30-f3712c4e-voice-back/chart.html`](../2026-10-30-f3712c4e-voice-back/chart.html), which this one replaces.

## Behavioral changes since `f3712c4e` + #514

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A typed `read` or `read_page` | Prompt Bar | No grammar line: read as any other words, by Jev. It was a silent page listing with a Card. | `parseCliCommand`, `localMatch` |
| A typed `read` | terminal harness | The harness prints the page's numbered refs and text itself; no Command, no event, no Feed entry. | `localCommand`, `readPage` |
| A spoken "read" | any | Unchanged in effect, read by Jev; the fence that kept it from the listing is gone with the listing. | `exactOf`, `heardExactly` |
| A Planner `read` step | an Errand | Unchanged: a part of the page's text into its memory. | `errandRead` |

## Layout and terminology

- **The whole journey:** no box or arrow changes; the Page Read note says no Command reads the page. Recaptured: `overview.png`.
- **When you speak** and **How it chooses an action:** no drawn change; `voice.png` and `decisions.png` are retained.
