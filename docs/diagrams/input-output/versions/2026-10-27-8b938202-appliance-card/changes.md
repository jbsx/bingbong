# Input-to-output chart — 2026-10-27, base `8b938202` + the Appliance Card (#485)

- **Source:** base `8b938202` (`main`, 27 October 2026), plus the #485 implementation on branch `worktree-impl-485`: commits `d8c910c5`..`4df1bbb7` (the card's wording as measured: W7, the media lines saying the media is the one already on and the volume and speed lines carrying each rung's level; no web verb on the card; only a sure pick fires there, an unsure one going on to the page card; a Flag read there writes its ask's record and is kept in a Step too). The behaviour drawn is in `src/main/run/commandRunner.ts` (`read`, `readAppliance`, `readPageCard`, `readPartial`, `pageInHand`, `lastPageInHand`, `mediaNow`), `src/core/command/applianceCard.ts` and `src/main/index.ts` (`applianceCardOf`). The containing commit records the exact snapshot.
- **Previous chart:** base `8b938202` + a wake that brings no words closes (#483), 27 October 2026: [`../2026-10-27-8b938202-false-wake/chart.html`](../2026-10-27-8b938202-false-wake/chart.html). This version was drawn on the version before it (#468) while #483 landed alongside; on the rebase its voice view, its details bullet and its source reference were taken over whole, so this version carries #483 too. `voice.png` is #483's capture (the voice view is #483's exactly).

## Behavioral changes since `da107e12` + #468

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| An exact line (the Local Match, the CLI grammar) | no control on the page in hand carries the line as its label | fires on its words. The label test reads the speech-start collect if it has settled, else the browser's last snapshot while the pane is still on its address. It never waits, and with no page in hand the line fires. Before, the line waited for the page collect. | `read`, `pageInHand`, `lastPageInHand` |
| A partial that already is the exact line (Early Fire) | same test, on the page in hand | fires early; before, it waited for the collect | `readPartial` |
| A spoken Slot (play, search or type words) that could carry a name | — | as before: waits for the speech-start collect, then the page card (Name Match) | `read` (`slotIsNameable`) |
| Any other line | a Decision Model is configured | one Jev ask of kind `appliance` on the **Appliance Card**, with no page collect. The card offers: the media element playing or started (the Player's video, else the page's own; one evaluate issued at speech start, bounded 1 s) with every Media Op its kind allows; the Player's Appliance Verbs (`where` beside play); the facts; the app's ops (panel, views including the Idle Screen, the one "settings" line and its settings ask); resume on a blank pane; the Flag while there is a Task; help; the Timer's set and off; stop; `page`; and `none`. `steps` rides at hop 0. | `readAppliance`, `applianceQuestions`, `mediaNow` |
| The Appliance Card picks an op, a verb, a fact, an app op or the Flag | — | fires and ends as its op ends: a Media Op by its own before/after read, a Player verb on the Player's line, an app op on its fixed Answer. No page collect, no later hop, never an Errand. The Flag pick keeps the last Task as the grammar's Flag does ("Flagged."). | `readApplianceAnswers`, `run` (`heard.flag`) |
| The Appliance Card picks play and its words point at the site open; or it picks an op that cannot fire (a volume to no number, a timer with no length) | — | goes on to the page card. There the play becomes the Site Scope search, a Task on the page road. | `readApplianceAnswers` (`ON_TO_PAGE`) |
| The Appliance Card splits the line into Steps | — | each Step's hop 0 is read on the Appliance Card again | `readAppliance` (`readSteps`) |
| The Appliance Card picks `page` or `none` | — | the page card, unchanged: the page collected, the Local Match over its refs, the one page-card ask; its none goes to the Where Ask and then the Mark Ask, and its not-done end goes to the Errand. The Status Capsule says "Looking at &lt;host&gt;" (status thinking, word "Looking"). | `read`, `readPageCard`, `PAGE_CARD_WORD`, `pageObject` |
| The Appliance Card's host fails | the line is an Instant line (a grammar line that a ref in hand carried as its label) | fires the Local Match's reading of it | `read` (`first.failed`) |
| The Appliance Card's host fails | any other line | goes on to the page card, whose failure is handled as before | `read` |
| `BINGBONG_APPLIANCE_CARD=off` | — | the road before #485, exactly | `applianceCardOf` |
| `BINGBONG_APPLIANCE_ASKS=parallel` (a measured arm, not the default) | — | both cards are asked at the Endpoint, and the page card's answer is dropped when the Appliance Card's pick fires | `read` (`beside`) |

## Chart changes

- **The whole journey:**
  - The intro now says that an exact command fires at once and that anything else is read first on the Appliance Card, then on the page.
  - "Jev looks at your words…" becomes "Jev reads the Appliance Card: the media, the Player, the facts, the app, the Flag; no page read".
  - A new green box, "It does what Jev picked, and the line ends there", has a note: no page read, no later hop, never an Errand; the Flag says "Flagged."; a play for this site, or an op that cannot fire, goes on to the page card.
  - A new box, "Jev reads the page card", is reached on "page" or "none", or when the Appliance Card's host fails. A note beside it gives the Capsule's "Looking at &lt;host&gt;" and the Instant-line fallback.
  - The exact command's arrow now reads "it fires on its words: no control on the page in hand carries them as a label".
  - The old green box (facts, panel, view and setting changes said) and its note are gone. Those picks now land on the Appliance Card's box. The page card still offers them; that is stated in the details, not drawn.
  - Everything from "The app performs the chosen action" down is unchanged, shifted 380 units down. `overview.png` recaptured and inspected.
- **How it chooses an action:**
  - The intro is rewritten for the two cards.
  - The Local Match's label reads "resolves it on the page in hand; no wait".
  - A new Appliance Card box lists every option. It leads to a green "Do it, and end the line: no page read, no later hop", or, on "page" or "none" or a host failure (footnote ²), to "Jev reads the page card", which takes over the old action card's arrows: Where Ask, settings ask, "Jev selects an action".
  - The old "Say the fact…" box is gone.
  - The long note gains a paragraph on the Appliance Card (its options, settings, the play for this site, Steps, and a spoken nameable Slot skipping it). Its exact-line paragraph now names the page in hand.
  - Everything below the page card is shifted 300 units down. `decisions.png` recaptured and inspected.
- **When you speak:** no change. That view never showed every line waiting for the page collect: it shows the page prepared at speech start and the Early Fire on an exact line, both still true. The speech-start media read is stated in the details only. `voice.png` carried over from the previous version.
- **Important details:** two new bullets, "The Appliance Card (#485)" (including `BINGBONG_APPLIANCE_CARD=off` and `BINGBONG_APPLIANCE_ASKS=parallel`) and "An exact line on the page in hand (#485)". The "One reading on every page" bullet now notes what #485 changed. The source references name `applianceCard.ts` and the runner's new functions.
- **Narrow screen:** checked at 600 px; the chart scrolls sideways as before.

- **After the review (5dbb3d6f):** only a sure pick fires on the Appliance Card; an unsure one goes on to the page card. The arrows now read "a sure pick: …" and "“page” or “none”, an unsure pick, or the Appliance Card’s host fails" (whole journey), "it surely picks …" and "… is unsure, or its host fails²" (decision view). Both views recaptured and inspected again after the change; the voice view retained.

## Simplifications and uncertainty

- The two env switches are in the details, not drawn as boxes.
- The page card's own fact and app-op picks are not drawn as a separate arrow.
- The whole journey shows one green outcome for every Appliance Card pick. The decision view does not separate the Flag pick from the others.
- No uncertainty is left open in the drawn transitions. This chart was drawn from source only: no paid model call was made.
