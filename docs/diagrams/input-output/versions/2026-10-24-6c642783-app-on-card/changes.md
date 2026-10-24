# Input-to-output chart — 2026-10-24, base `6c642783` + the app itself on the card (#420)

- **Source:** base `6c642783` (`main`, 24 October 2026, the #420 grill's ADR 0091), plus the #420 implementation changes, uncommitted on branch `worktree-implement-420-app-on-card`: `src/core/command/appOp.ts` (new), `src/core/settings/settingKinds.ts` (new), `src/core/settings/sections.ts` (new), `src/core/app/ipcChannels.ts` (new), `src/main/app/attachAppControl.ts` (new), `src/core/command/jevReading.ts`, `src/core/command/command.ts`, `src/core/command/answer.ts`, `src/core/command/mediaOp.ts`, `src/core/panel/feedPanelState.ts`, `src/main/panel/createFeedPanelOverlay.ts`, `src/main/run/commandRunner.ts`, `src/main/index.ts`, the preload, and `src/renderer/src/App.tsx` / `SettingsPage.tsx`. The containing commit records the exact snapshot.
- **Previous chart:** base `20f843b5` + #417, 24 October 2026 — [`../2026-10-24-20f843b5-sheet-leaves/chart.html`](../2026-10-24-20f843b5-sheet-leaves/chart.html).

## Behavioral changes since `20f843b5` + #417

### Added: the app itself is on the card, and one op chosen changes it (#420, ADR 0091)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any ask that builds the action card but the Where Ask (first ask, screenshot ask, later hops, partials) | an app control is wired | the card offers the panel's ops (`panel_open`, `panel_close`, `panel_overlay`, `panel_docked`, `panel_width`), the views (`show_dashboard`, `show_weight`, `show_settings`, `show_settings_<section>`), each line carrying the state now, and ONE `settings` line, a fixed line naming the settings; room reserved under the option cap | `actionQuestion` (`appOps`), `appCardOptions`, `SETTINGS_LINE`, `CommandRunner.appliance` |
| The card offers an app amount (the panel's width) | always | the Amount question rides the ask, as beside a media ref's ops | `actionQuestion` (`amounts`), `takesAmount`, `amountQuestion` |
| Jev's answer is a panel or view label | any hop | a Command `{ verb: 'app', app }`, the Amount rung (`to` by default) for the width | `readCommandAnswers`, `appOpOf`, `appCommand` |
| Jev's answer is `settings` | hop 0, the line not split into Steps | a second ask, kind `setting`, over the same state (the words alone when that state plus its card would pass the Card Budget): every setting's ops by kind with the state now (switch on/off, one op per choice or voice value, an amount, a place or time Slot), the Slot, the Amount, and `none` | `read` → `readSetting`, `isSettingsLine`, `settingQuestions`, `settingOptions` |
| The settings ask answers an op | always | a Command `{ verb: 'app', app }` with its Amount rung or words; fires as one app op | `readSettingAnswers`, `appCommand` |
| The settings ask answers `none`, or does not answer | always | no Command; never sent to the Where Ask (the card's pick stands); No response | `readSetting`, `readSettingAnswers` |
| Jev's answer is `settings` | a later hop | no Command | hop reading (`isSettingsLine(hopCommand) ? UNREAD`) |
| An `app` Command is published | a panel or view op, on a pane with a page | the dashboard wakes | `commandKeepsIdle` |
| The same | a setting op, or a panel op on a blank pane | the Idle Screen stays up | `commandKeepsIdle`, `verbKeepsIdle` |
| The same | a view op on a blank pane | `commandKeepsIdle` says idle, but the dashboard shows a non-dashboard view whatever the idle flag, so the view shows over the Idle Screen (showing `dashboard` there stays under it) | `App.tsx` (`showIdle` needs `view === 'dashboard'`) |
| An `app` Command fires | a panel, view or settings change | the panel fold changes, the view is sent to the dashboard (`APP_VIEW_IPC.show`), or `settingsStore.update`; a fixed Answer names the new value ("It already was." when nothing moved), shown and spoken with a voice; no page action | `perform` case `app`, `AppControl.apply`, `appAnswer`; the `say`/`app` branch in fire |
| The same | a place setting (the weather city) | the geocoder's first match is taken, then saved; the Answer names it | `AppControl.findPlace`, `placeSettings`, `placeName` |
| The same | the words carry no value, or the geocoder finds no place, or no app is wired | throws: the failure line, as before | `perform` case `app` |
| The Task after `app` | Jev-read | ends `terminal`: one hop, no Verdict | `endedByReading` (`app` is not in `CONTINUING`) |
| A spoken partial reads as `app` | always | never Early Fires; waits for the Endpoint | `app` guard in the partial reading |

### Changed: `open <bare word>` the app names is Jev's (#420, ADR 0089)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| `open <word>` | the bare word is settings, weight, dashboard, panel or feed, and an app control is wired | never a Known Address: goes to Jev ("open settings" no longer opens settings.com) | `knownAddress` in `createCommandRunner`, `appWords` |

### Changed: ADR 0021 amended

A Command whose words ask for the panel may open it (`FeedPanelState.open`, `setOpen`); before, only a human act opened it. Drawn as part of the app-op path; stated in Important details.

`6c642783` itself is a docs commit (ADR 0091) and does not change the depicted flow.

## Chart changes

- **The whole journey:** the fact exit from "Jev looks at your words…" now reads "Jev picks a fact, or a change to the app", and its green box reads "The app says what it knows, or changes its panel, view or a setting and says the new value" (widened 240 → 260, four lines). Its note: "Shown and spoken; no page action; the Task ends. A setting is chosen on a second ask and keeps the Idle Screen up; a panel or view wakes it." The settings ask is not drawn here; it is the decision view's follow-up.
- **How it chooses an action:** the card box reads "page actions, the facts, the panel, the views and one “settings” line" (four lines). Its right-hand exit "Jev picks a fact, a panel or view op" leads to "Say the fact, or change the panel or view; say so". A new exit from the card's bottom right, "Jev picks “settings”", leads to a new box "Ask Jev which setting, and to what: every setting's ops, state now". From it, "a setting op is picked" goes to a new green box "Change it, and say the new value", and "none, or no answer" goes to "Show “No response”". To make room, the Where Ask and screenshot boxes moved left (x 840 → 760) and their connectors with them; the No response box moved down 20. The bottom note describes the panel, views and one settings line, the second ask, and the later-hop rule, and the One Reading line adds "or a word the app itself names (“open settings”, “open panel”)". The intro names the app's panel, views and settings. View height 2400 → 2560.
- **When you speak:** unchanged; an `app` op, like `say`, is simply not an eligible early command.
- **Important details:** a new bullet for #420 (panel and views on the card, the one settings line and the measured reason, the settings ask and its Card Budget fallback, none and later hops, the change, the Answer, the Idle Screen rule including a view op over the Idle Screen on a blank pane, failure, partials, ADR 0021 amended); the #408 bullet names the five bare words that are Jev's.
- **Source references:** the revision line; `appOp.ts` (`appCardOptions`, `settingOptions`), `settingKinds.ts` and `attachAppControl.ts` added; the jevReading line names the settings ask.

## Simplifications

- In the whole journey, an app op shares the fact's box and exit: both are a terminal, page-free Answer shown and spoken, ending the Task. The settings ask is in its note, and drawn only in the decision view.
- The blank-pane Idle Screen rule (a view op shows over it, a panel op stays under it) is stated only in Important details.
- The settings ask's Card Budget fallback (the words alone) is in Important details, not a box.
- The geocoder lookup for a spoken city is a detail, not a box.

## Captures

- Revised the same day after the gate measured the card-budget tie: the settings moved off the card onto their own ask. `overview.png` (1440×2200) and `decisions.png` (1440×3150) were recaptured after that revision with headless Chrome after the last layout change and inspected directly: text fits its boxes, arrowheads end at their boxes, labels sit on their own connectors, the widened note clears the stop connector; the new settings column clears the Where Ask and screenshot boxes, and the bottom note clears the footnote. A 420 px narrow capture of the main view (not kept) scrolls sideways, legible. A headless DOM dump of `?view=voice` shows that view's heading with its button pressed.
- `voice.png` retained from `20f843b5` + #417: that view did not change.

## Unresolved

None.
