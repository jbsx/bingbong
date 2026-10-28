# Input-to-output chart — 2026-10-28, base `3e795711` + #498’s joined pick

- **Source:** base `3e795711` (`main`, 28 October 2026), plus the #498 changes:
  - `src/main/music/player.ts`: `Player.picked`, `PickedSong`;
  - `src/core/command/jevReading.ts`: `Appliance.picked`, `PickedSong`, the corrections in `offeredApplianceVerbs`, `JoinedLine`, `joinedSlotOptions`, `crossesJoin`, and the two-span Slot label in `slotWords`;
  - `src/core/command/applianceCard.ts`: `pickLines`, `withPicked`, `joinedSlot`, `ApplianceView.joins`;
  - `src/main/run/commandRunner.ts`: `appliance()`'s `picked`, `ReadOptions.joins`, and the join in `settleFate`.

  The containing commit records the exact snapshot.
- **Previous chart:** base `a1962302` + #497’s ad first: [`../2026-10-28-a1962302-ad-first/chart.html`](../2026-10-28-a1962302-ad-first/chart.html). This version is drawn on that chart. (It was first drawn on base `4ab0534b` + #499’s line just ended; #502 and then #497 landed first, and the same changes were carried onto each chart on the rebases.)

## Behavioral changes since `a1962302` + #497

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any Appliance Card or page card is read | The Player holds a pick that is still opening, or whose line was cut off before it played. | `correct` and `correct_back` are offered. Before, they were offered only while the Queue had a current song. `forget` is still offered only then. | `offeredApplianceVerbs`, `Player.picked` |
| The Appliance Card's state | The Player holds a pick that is not the Queue's song. | “Music picked: “&lt;title&gt;”, the result of a search for “&lt;words&gt;”” is the line right after the user's words. A pick that is playing, or no pick, leaves the card byte for byte as before. | `pickLines` |
| A `joins` Fate re-reads both lines as one | Always. | The joined ask carries that pick. “no, the other one” can read `correct`, which plays the search's next result and says “Playing “…” instead.”. Before, the joined words were searched verbatim (“hurt no the other one”). | `settleFate`, `withPicked` |
| The joined ask's Slot | The first line carried a Slot that is among its words. | No Slot span runs across the join. The first line's Slot is offered beside each span of the correction's words (“yellow by coldplay”, label `s1-1_3-4`). The Slot instructions add that the words are a line and its correction. A cut-off first line with no Slot (“Back to-”) keeps the Slot as before. | `joinedSlot`, `joinedSlotOptions`, `crossesJoin` |

## Views

- **Whole journey:** one note line added at the Overlap foot. It was recaptured (`overview.png`, 1440×6200) and the foot inspected; the note sits 14 px lower to keep its gap from the joins box's text. The joins detail bullet and the source line were updated.
- **Voice and decision views:** unchanged. Their captures are carried over from the previous version.
