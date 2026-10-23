# Input-to-output chart — 2026-10-23, base `b2796ba1` + What the app knows (#402)

- **Source:** base `b2796ba1`, 23 October 2026 (`main`), plus the accompanying #402 implementation changes in `src/core/command/applianceFacts.ts` (new), `src/core/command/jevReading.ts`, `src/core/command/command.ts`, `src/core/command/answer.ts`, `src/main/run/commandRunner.ts`, `src/main/index.ts`, `src/main/weather/attachWeather.ts` (new), `src/core/weather/ipcChannels.ts` (new), the preload, and `src/renderer/src/useWeather.ts` / `App.tsx`. The containing commit records the exact snapshot.
- **Previous chart:** base `0f7e11e` + #399, 23 October 2026 — [`../2026-10-23-0f7e11e-task-end-speech/chart.html`](../2026-10-23-0f7e11e-task-end-speech/chart.html).

## Behavioral changes since `0f7e11e` + #399

### Added: the facts the app holds are options on the card, and one chosen is said (#402)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any ask that builds the action card but the Where Ask (first ask, the screenshot ask, later hops, partials) | a facts source is wired (with or without a Player) | the card offers `say_time`, `say_weather` and, while their feature is wired, `say_playing`, `say_timer`; each line carries the fact, room reserved under the option cap | `actionQuestion` (`factOptions`), `sayOptions`, `factsOffered`, `CommandRunner.appliance` |
| The weather option is built | always | its line names the settings city and says another place or a website is a search | `factName('weather')` |
| The song fact | the Player holds no song and the page has media | the page's media is the song playing | `withPageSong` |
| Jev's answer is a `say_*` label | any hop | a Command `{ verb: 'say', fact }`, no target, no Slot | `readCommandAnswers`, `factOfLabel` |
| A `say` Command is published | always | `keepsIdle`: the Idle Screen stays up | `verbKeepsIdle` |
| A `say` Command fires | facts wired | a fixed sentence filled from what the app holds at that moment; shown as the Answer, spoken when there is a voice; no page action | `perform` case `say` → `factAnswer`; the `command.verb === 'say'` branch in fire |
| A `say` Command fires | no facts on this surface | throws, the failure path as before | `perform` case `say` |
| The Task after `say` | Jev-read | ends `terminal`: no hop, no Verdict | `endedByReading` (`say` is not in `CONTINUING`) |
| A spoken partial reads as `say` | always | never Early Fires; waits for the Endpoint | `say` guard in the partial reading |
| The Idle Screen's weather fetch | the city is set | fetches whether or not the Idle Screen shows; every shown report (or null) goes to main over `weather:report`; main keeps the latest | `useWeather`, `registerWeatherIpc` |

`b2796ba1` itself is a docs commit (AGENTS.md "Ties are measured") and does not change the depicted flow.

## Chart changes

- **The whole journey:** a third exit from "Jev looks at your words…" — "Jev picks a fact the app holds" — to a new green box "The app says what it knows; the Idle Screen stays up", with the note "Shown, and spoken with a voice. No page action; the Task ends." The "an action is selected" exit moved left (x 770 → 710) to make room. The "“Read” also speaks page text…" note moved from the right of the feedback box to its left, clear of the new box.
- **How it chooses an action:** the card box now reads "Jev reads the action card: page actions, and the facts the app holds" (widened 300 → 330, three lines). A right-hand exit "Jev picks a fact it holds" leads to a new green box "Say the fact in a fixed sentence". The Where Ask box narrowed 310 → 290 to clear it. The bottom note adds "The facts (time, weather, song, timer, weigh-ins) are on every card. One chosen is said and shown; a spoken partial never fires it early." (view height 2010 → 2110). The intro mentions the facts.
- **When you speak:** unchanged. Its early-fire branch already reads "an eligible complete command"; `say`, like a `play` search, is simply not eligible, which the details and the decision note state.
- **Important details:** new bullet on what the app knows, including the partial rule and the weather report handed to main.
- **Source references:** revision line; `applianceFacts.ts` and `attachWeather.ts` added.

## Simplifications

- The decision view draws the fact exit from the first card only; that the same options ride the screenshot ask, later hops and partials, and not the Where Ask, is in its note.
- Which facts are offered depends on what is wired (`playing`, `timer`); the chart lists all four.
- The weather IPC is a supporting detail in "Important details", not a box.
- A `say` inside a multi-Step line ends its Task like any terminal success; the Step continuation is the existing path and is not redrawn.

## Verification

`overview.png` (1440×2200) and `decisions.png` (1440×2500) were recaptured with headless Chrome after the last layout change and inspected directly: text fits its boxes, arrowheads end at their boxes, labels sit on their own connectors, and the moved note clears every line. One defect was found and fixed during inspection: the Where Ask's "an action is selected" connector started short of the narrowed box (now starts at its edge). A 420 px narrow capture of the decision view (not kept) scrolls sideways with labels legible. A headless DOM dump of `?view=voice` shows that view's heading with its button pressed. `voice.png` is retained from `0f7e11e` + #399 (that view and the shared helpers are unchanged).

## Unresolved

None.
