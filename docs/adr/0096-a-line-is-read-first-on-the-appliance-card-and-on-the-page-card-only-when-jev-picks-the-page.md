# ADR 0096: A line is read first on the Appliance Card, and on the page card only when Jev picks the page

## Status

Amended on 2026-10-28 by ADR 0097 (#489): while a line runs, its Appliance
Card carries the running Command and asks its Fate.

Accepted 2026-10-27 by the owner ("land the ADR drafts"), on the
orchestrator's rulings and close of #485 (built a2297959..ec8e7823).
Proposed 2026-10-27, from the orchestrator's rulings on the issue. It
amends ADR 0076, 0079, 0082, 0089 and 0091 (each carries its amendment).

## Context

77 % of the owner's spoken commands on the kiosk are about what plays or
about the app itself: 69 of the 90 spoken hop-0 lines that were not
`none`. Each was read on the whole page's card. That card's p50 is 7.8k
tokens and holds 146 page-ref options on a YouTube watch page. Every one
of those lines first waited for the page's collect, which it never read.
The line broke in one of two ways:

- **Lured:** Dislike over "Flag it as failure", the browser's `back` over
  "Go back to home page", the promo's play-N over "Play Tum Se Tum Tak".
- **Swallowed:** `none`, because the appliance op the line meant was not
  on the card, or was drowned among the page's refs.

Jev failed with the whole class in front of it three times:

- #478: every Flag-on-card arm lost `cli-3-mvph9ink`.
- #458: "home page" read `back` on all 12 arms.
- #422: the update lines read `none` over YouTube.

AGENTS.md ("Jev decides") then allows a paid strategy: a question split
in two.

## Decision

- **Exact lines first.** An exact line (the Local Match) fires on its
  words before any collect. ADR 0089's label test runs against the page
  in hand: the settled speech-start collect, else the controller's last
  snapshot while the pane is on its address. It never waits, and with no
  page in hand the line fires.
- **Everything else, the Appliance Card first.** Every other line is read
  first on the Appliance Card: one ask at the Endpoint and at each Step's
  hop 0, with no page collect. It carries everything in the appliance
  that bears on the line, by kind:
  - The media element the appliance has playing or started (the Player's
    `#movie_player video`, else the page's own), with every Media Op its
    kind allows. These are reached by kind, never by a ref, and the volume
    and speed lines carry each rung's resulting level.
  - The Appliance Verbs and the facts.
  - The app's ops, with the settings ask.
  - `resume` on a blank pane.
  - The Flag while there is a Task to flag, Help, the Timer's set and off,
    and `stop`.
  - `page` and `none`.
  - `where` rides beside `play`, and `steps` rides at hop 0.
- **A pick on the Appliance Card** fires and ends as its op ends. There is
  no page collect, no later hop, and never an Errand. Only a sure pick
  fires; an unsure one goes on to the page card (the #485 review,
  6d3e3e4b).
- **`page` or `none`** goes on to today's page card, unchanged. It is a
  superset, so nothing the gate passed before is lost.
- **Host failure.** If the Appliance Card's host fails, an Instant line
  fires the Local Match's best guess, and any other line goes on to the
  page card.
- **Switches.**
  - `BINGBONG_APPLIANCE_CARD=off` is today's road.
  - `BINGBONG_APPLIANCE_ASKS=parallel` asks both cards at the Endpoint and
    drops the page card's answer when the Appliance pick fires. This is
    T1's arm P, behind the switch, and costs one more paid call per
    non-exact line on a paid host.

## Measured

- **T1 (sequential or parallel), on the speed replay** (the stt:gate's
  105 labelled dumps played at real time, the real VAD, Mammoth live):
  Felt Reaction p50 / p95 by Tier.

  | Arm | Instant | Quick | Task |
  |---|---|---|---|
  | S (three passes) | 739 ms / 2.27 s | 981 ms / 1.91 s | 959 ms / 2.32 s |
  | P (one pass, narrow) | 926 ms / 2.27 s | 987 ms / 2.86 s | 1.58 / 2.68 s |

  P is not better, so S ships, and P stays behind
  `BINGBONG_APPLIANCE_ASKS=parallel`.
- **T2 (navigate and web search on the card), on the gate:** 121/163
  Appliance cases, +9 −9. Lines meant for the site's own search box read
  as a web search. Arm A, with no web verb on the card, ships.
- **T3 (wording and placement), on the gate** (Mammoth ∩ Elephant, 163
  Appliance cases; arm A scores 121):

  | Arm | Through | Gained | Lost |
  |---|---|---|---|
  | W1 | 122 | 4 | 3 |
  | W2 | 125 | 5 | 1 |
  | W3 | 123 | 3 | 1 |
  | W4 | 122 | 2 | 1 |
  | **W7 (ships)** | 122 | 1 | 0 |

  - Every arm that changed the instruction, the page line or the Flag line
    lost `cli-3-mvh3d39l` ('search highs and lows pomme' read as
    `say_weather`, a Mammoth near-tie).
  - W7 is arm A's text plus two changes: the media lines say the media is
    the one already on, and the volume and speed lines carry each up/down
    rung's level.
  - W2 scored most but lost `search highs and lows pomme`; W7 stands
    because nothing that passed before is lost (AGENTS.md, Ties are
    measured). W2's gains stay open as card-wording cases.
- **At close:** the whole gate lost nothing (208/242, equal to base), and
  the appliance lines Jev reads meet Quick (963 ms / 2.68 s). The kiosk
  read is #439's spoken session, a confirmation read later.

## Guess

- **The home-page pair** ("Go back to home page.") is a pick, never an
  ask: asking first is ruled out (CONTEXT.md, Misfire), and the recovery
  by the next Command is Instant. The orchestrator ruled that the
  `show_dashboard` line on the Appliance Card name itself as the app's own
  home screen, so Jev can tell it from a site's home, and the site's home
  stays a page ref. c9fa29f1 rewords it on the Appliance Card alone: "show
  the app's own home screen, the browser, leaving Settings or the Weight
  page — not a website's home page"; its narrow check (the six Appliance
  cases that reach it, Mammoth and Elephant) lost nothing and gained
  nothing, 3/6 through before and after. This is a guess; the next
  home-page line in the ledger settles it.
- The volume step sizes in `mediaOp.ts` stay the marked guess; the owner
  sets them.

## Consequences

- Appliance lines no longer wait for the page, and no page ref lures them.
- A noise line pays one more call: Appliance `none`, then the page card's
  `none`, then the Where Ask. Calls per utterance are reported.
- A line about the page pays one more small call (sequential) before
  today's road.
- The Errand is reached only from the page card.
- Eight lines are still misread at close (`Or failure.`, `go back to the
  browser`, the home-page pair, the promo play ×3, `Feeling good.`); they
  return to the ledger open and unclaimed, each a card-wording case for
  the next report. `play the latest mkbhd video` over the Idle Screen is a
  play-and-show behaviour with no ask, left open too.
