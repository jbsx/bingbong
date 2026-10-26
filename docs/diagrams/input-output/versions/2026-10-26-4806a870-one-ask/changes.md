# Input-to-output chart — 2026-10-26, base `4806a870` + the one ask (#477)

- **Source:** base `4806a870` (`main`, 26 October 2026, after #467's Errand loop and #474's Turn Card), plus the #477 implementation on branch `worktree-impl-477` (rebased over #467), in `src/main/run/commandRunner.ts`, `src/core/decision/fallbackChain.ts`, `src/core/decision/decisionRouting.ts`, `src/main/decision/createDecisionModel.ts`, `src/core/command/cliGrammar.ts`, `src/main/browser/drawMarks.ts` and the record shapes. The containing commit records the exact snapshot.
- **Previous chart:** base `02389cbc` + the Errand (#467), 26 October 2026: [`../2026-10-26-02389cbc-errand/chart.html`](../2026-10-26-02389cbc-errand/chart.html). This version is drawn on that chart, so the Errand's road stays as #467 drew it.

## Behavioral changes since `02389cbc` + #467

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A partial transcript arrives while you speak | the words are an exact command line (the Local Match: `scroll down`, `go back`, a key, a numbered ref), under the holds Early Fire had (`firesEarly`, `headsAnotherVerb`, the Flag, Player, dismiss and Site Question holds) | the Command fires before the Endpoint, as before | `readPartial`, `localMatch` |
| A partial transcript arrives while you speak | the words are anything else — free words, a Slot, a line only Jev would read | nothing fires and **no model is asked**; the line waits for its Endpoint, where it is read once over the page prepared at speech start. Before, the partial was one Jev call with a "complete command?" Noul, and fired when it cleared 0.7 | `readPartial` (the Jev branch removed), `prepare` |
| Jev is asked (any ask: hop 0, a hop, the Where Ask, the Mark Ask, a setting, a consent decline, the Shelf, a Site Question) | the host refuses (429 or another status), lets the attempt time out, the request fails to carry, or the answer is malformed — anything but your abort — and `BINGBONG_DECISION_FALLBACKS` names a host after it | the same ask goes at once, unchanged, to the next Fallback Host; every attempt but the last is bounded at 2,250 ms, the last at `BINGBONG_DECISION_TIMEOUT_MS`; the record and the asks log name every attempt and the host that answered | `withFallbacks`, `createRoutedDecisionModel`, `resolveFallbacks` |
| Jev is asked | every host failed (or none is named and the one host failed) | "No response" with its reason, as before; nothing on screen or aloud names a host, and the wait stays "Thinking" with its seconds throughout | `withFallbacks`, `spokenFailure` |
| A line reaches the grammar | it fails as given but is a grammar line without the ear's trailing punctuation and with its head in lower case (`Help.`, `Back.`, `click 7.`) | it is the grammar's line; a line that parsed as given keeps its reading (`type 5 hello.`) | `parseCliCommand` |
| The Mark Ask captures the pane | the capture's long edge is over 1,568 px (the owner's 2,560×1,440 display) | the image is scaled to 1,568 px on its long edge, the marks with it, before it is sent; before, the host answered 400 and the line ended unavailable | `drawMarks`, `fitImageToLongEdge`, `DECISION_IMAGE_LONG_EDGE_PX` |

## Chart changes

- **When you speak:** the early branch's label reads "a live partial is an exact command line (Local Match)" in place of "an eligible complete command"; the early box says the command is executed early and no model is asked about a partial; the intro says the app acts early only on an exact command line. `voice.png` recaptured and inspected.
- **How it chooses an action:** the note under "No response" gains the Fallback Hosts: an ask a host refuses, times out or faults goes at once, unchanged, to the next host the env names, and "No response" comes only when every host failed; the footnote on the heard names no longer lists "an early partial"; the intro notes that a spoken line's trailing full stop never stops an exact command. `decisions.png` recaptured and inspected.
- **The whole journey:** no box or arrow changes (the fallback is inside "Jev looks at your words" and the Early Fire inside the voice view). `overview.png` recaptured and inspected; it is unchanged in content.
- **Important details:** a #477 bullet names the one ask, the Fallback Hosts, the 2,250 ms bound, the quiet screen, the grammar's second parse and the image long edge. The source references add `fallbackChain.ts`, `decisionRouting.ts` and `cliGrammar.ts`.
- A narrow (700 px) capture of the whole journey was inspected: the chart scrolls sideways and its labels stay readable.

## Deliberate simplifications

- The Fallback Hosts are a note, not a box: a host is no stage or object the person can act on (`docs/agents/ui.md`, the Narrated wait), and the chart's boxes are what the person sees. The 2,250 ms attempt bound and the "every ask starts at the live host" guess live in the details and ADR 0076's amendment.
- `partialCalls`, `partialAsks` and `earlyFire.noul` are no longer written; `pnpm perf:report` still reads them from older logs. Not drawn.
