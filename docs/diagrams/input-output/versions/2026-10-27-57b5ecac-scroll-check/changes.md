# Input-to-output chart — 2026-10-27, base `57b5ecac` + a page scroll ends on a cheap check (#484)

- **Source:** base `57b5ecac` (`main`, 27 October 2026), plus the #484 implementation on branch `worktree-impl-484`. The behaviour is in `src/main/browser/createCdpBrowserController.ts` (`scroll`, `scrollRegionOn`, `showTextOn`, `pressKey`, `withRefStates`) and `src/main/browser/collectPageScript.ts` (`scrollSpotScript`, `scrollReadScript`). The containing commit records the exact snapshot.
- **Previous chart:** base `8b938202` + #485 (the Appliance Card), 27 October 2026: [`../2026-10-27-8b938202-appliance-card/chart.html`](../2026-10-27-8b938202-appliance-card/chart.html).

## Behavioral changes since `8b938202` + #485

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A page scroll (`scroll_up`, `scroll_down`, an Extent) | — | Before the wheel there is no collect, only one evaluate of the viewport, its offsets, the iframe and scroller under the centre, and whether either has room to move. After the wheel and its readiness wait there is one evaluate of the offsets. The action returns once the move is seen. Before, it collected the page again (the "new in view" delta) and returned only after that collect, which took 5.5 s on the kiosk. | `scroll`, `scrollSpotScript`, `scrollReadScript` |
| The same check finds nothing moved | there was room that way, or a frame is under the centre | the scroll is let settle (≤ 1 s) and read again. If it still has not moved, the outcome ends "end of page", and the Answer says the end, as before. | `scroll` (`scrollSettled`) |
| The same check finds nothing moved | no room that way on the page or the scroller | "end of page" at once, with no settle | `scroll` (`room`) |
| A Scroll Op on a region, a Show Op | — | ends on its own before and after reads, with no recollection | `scrollRegionOn`, `showTextOn` |
| A key press | its readiness wait saw an effect | the page's snapshot is marked stale. The next line that needs the page reads it anew. | `pressKey` |
| Any collect | the accessibility tree for the controls' states (pressed, expanded, checked) has not answered by 1 s | the page goes on without those states (`browser-ref-states` `late: true`) | `withRefStates`, `REF_STATES_GRACE_MS` |

No box or arrow changes. "The app performs the chosen action" still leads to "the action returns" and to the shown result. The Feed rendered no action result before, and renders none now, so what you see and hear is unchanged; only the wait before the line ends is shorter. The next hop of a Task, the next Errand step and the next line's reading each collected the page anyway, so none of them read the delta that is gone. The CLI harness prints the shorter outcome line.

## Layout and terminology

One bullet was added under "Important details", and a source reference to `createCdpBrowserController.ts`.

## Captures

- `overview.png` was recaptured and inspected. The diagram is unchanged.
- The new details bullet was captured with the section open, and inspected.
- `voice.png` and `decisions.png` are kept from the previous version: those views are unchanged.

## Uncertainty

The 1 s Ref States grace is a guess, marked so in code. The kiosk's `browser-ref-states` span would settle it.
