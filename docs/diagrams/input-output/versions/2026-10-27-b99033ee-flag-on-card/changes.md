# Changes — 2026-10-27, base `b99033ee` + the Flag on the action card (#478)

Source: base `b99033ee` (gitlab main after #477) + the accompanying #478 changes. Previous chart: base `4806a870` + the one ask (#477), 26 October 2026.

## Behaviour

- **Added: a road from Jev to the Flag.** While there is a Task to flag, the first action card offers the Flag (`flag`), never the Where Ask, its screenshot ask or a later hop. Jev picking it keeps the previous Task exactly as the grammar line does — its records and a shot under `logs/flags/`, “Flagged.” said — with the Slot's words as the hint. The page is untouched and the action in flight is not fired at; a reading still under way for an earlier line is dropped, as for any line read.
- **Unchanged:** the exact heads (“mark this as a failure”, “flag that”, “that was wrong”) are still read before anything else with no Jev call.

## Layout

- Decision view: the action card box names “the Flag”; the green outcome beside it reads “… or flag the last Task”, its arrow label “Jev picks a fact, a panel or view op, or the Flag”; the “settings” label moved down 17 units to clear the taller box. The intro names the Flag among the card's choices.
- Details: the Flag item says how a Flag in other words reaches it.
- The whole journey and When you speak are unchanged: their Flag arrow is the exact line, still true. `overview.png` and `voice.png` are retained from the previous version; `decisions.png` was recaptured and inspected.
