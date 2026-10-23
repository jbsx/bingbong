# Input-to-output chart — 2026-10-23, source `b1f9c34`

- **Source:** `b1f9c34`, 23 October 2026 (`main`, after #396).
- **Previous chart:** `32f7348`, 22 October 2026 — [`docs/input-output.prototype.html`](../../../../input-output.prototype.html).

## Behavioral changes since `32f7348`

### Added: the Hearing (#396, `fb8fc4a`, ADR 0077 as amended)

Before any Jev ask on a spoken line, `hearNames` (`src/core/command/nameMatch.ts`) reads the whole transcript by sound against the Page Terms and the Learned Terms. The names it sounds like go on the card: one line after the transcript, and a "sounds like" mark on the Slot span heard as the name (`heardLine`, `spanOption` in `src/core/command/jevReading.ts`).

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Words reach the runner | Local Match resolves them | Command selected, nothing heard | `read` (`local !== null` returns first) |
| Words reach the runner | no Local Match, Jev available, spoken | Names heard, then Jev reads the card | `hearingOf` → `commandQuestions(…, { heard })` |
| Words reach the runner | typed | Jev reads the card with no heard names | `hearingOf` returns `[]` when not spoken |
| Where Ask / Mark Ask / later hop / partial | spoken | Same heard names ride that ask | `readWhere`, `readMarks`, hop loop, `readPartial` |
| Jev chooses a Slot | spoken, nameable Slot | Name Match rewrites the spelling afterwards, as before | `matchName` |

Jev still makes the choice: the Hearing changes what the card says, not who decides.

### Changed: a carried name no longer blocks the Name Match (`fb8fc4a`)

A Slot that already carried one name as spelled used to skip the Name Match entirely. Now a carried name settles only its own words. The depicted step ("match the name spelling") is unchanged; this is internal.

### Not depicted: `79713c0`

A sure Verdict now ends the Task without the late pop-up wait. That is timing inside the existing "sure yes" path, so the chart doesn't change.

## Chart changes

- **How it chooses an action:** new box "If you spoke, note the names your words sound like" between "no exact local match" and "Jev reads the action card", with the note "A typed line is exact: nothing is heard." Everything below moved down 230 units (height 1770 → 2010). The footnote now says the heard names ride every Jev ask for a spoken line. The intro mentions the names.
- **The whole journey:** the Jev box reads "Jev looks at your words, any names they sound like, and the available actions".
- **When you speak:** the runner box reads "Your words enter the runner; names they sound like are noted for Jev".
- **Important details:** new bullet explaining the Hearing.
- **Source references:** added `nameMatch.ts` and `jevReading.ts`; links rewritten relative to this version directory.
- **Layout fix (pre-existing):** the "an action is selected¹" label in the decision view hid the "Jev selects" connector behind its white backing; it is now split over two lines and set right of that connector.

## Simplifications

- The Hearing is drawn once, on the first ask. Later asks (Where, Mark, hops, partials) are stated in the footnote rather than drawn.
- The heard-name cap (`HEARING_CAP`) and the sound-alike rules are not shown.

## Verification

Captured with headless Chrome and inspected directly: `overview.png`, `voice.png` and `decisions.png` (all three views refreshed, since all three changed), plus a 420 px narrow capture of the decision view (scrolls sideways, labels legible; not kept). Direct `?view=` URLs load each view; clicking each view button headlessly switches the heading and pressed state.

## Unresolved

None.
