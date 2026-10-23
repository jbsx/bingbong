# Input-to-output chart — 2026-10-23, base `162939dd` + the Answer Passage (#401)

- **Source:** base `162939dd` (`main`, 23 October 2026), plus the #401 implementation changes in `src/core/command/jevReading.ts`, `src/core/command/answer.ts`, `src/core/command/decisionRecord.ts` and `src/main/run/commandRunner.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `b2796ba1` + #402, 23 October 2026 — [`../2026-10-23-b2796ba1-appliance-facts/chart.html`](../2026-10-23-b2796ba1-appliance-facts/chart.html). This version is that chart with #401's edits; #402's own changes are in its notes.
- **Not charted here:** #400's searches, #403's done bar, #404's cookie strip and #405's Show Op lines, which landed on main without chart versions of their own; this version adds #401 only.

## Behavioral changes since `b2796ba1` + #402

### Added: a done Task speaks its Answer Passage (#401, ADR 0087)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Jev is asked at a hop past the first, or the Where Ask | a block of text is in view | a passage Choice (`none` and each block as `view-N`, in reading order) rides the same call beside the Verdict; the state's text in view is unchanged | `inViewBlocks`, `passageQuestion`, `hopQuestions`, `whereQuestions` |
| Task ends `done` on a sure yes | the passage pick is a block whose probability clears the Choice bar (0.7, #403) | Card: the page title over the block; the block is spoken word for word, in place of "Done." or silence | `readPassage`, `endDone`, `passageCard`, `endLineOf` |
| Task ends `done` on a sure yes | no sure pick (`none`, or under the bar) | as before: "Done." after 2+ actions, else silent | `endLineOf` |
| A Step ends `done` with a sure pick | Steps still to come | it speaks its passage; the next Step runs | `endLineOf`, `runSteps` |
| Where Ask's sure yes beside its action | a sure pick | the Task ends done, nothing fired, the block shown and spoken on hop 0's turn | `readWhere`, `endDone` |

The pick never changes whether the Task ends: only a sure yes ends it, as before. The decision record now carries the passage pick's confidence and top probabilities.

## Chart changes

- **The whole journey:** the green done box reads "This Step is finished; it says the block that answers, else “Done.” after 2+ actions" (three lines; moved down 14 so its top, and the arrow onto it, stay where they were). The output note ends "a Task’s end may say one line: the answer, read off the page."
- **How it chooses an action:** footnote ¹ adds that the Where Ask's sure "already done" Verdict says the block Jev surely chose.
- **Important details:** a new bullet on the Answer Passage; the end-line bullet now starts "Otherwise".
- **Source references:** the revision line; `jevReading.ts` names the passage Choice; `answer.ts` added.

## Simplifications

- The passage Choice rides an existing ask, so no new box or arrow is drawn for it: it is in the details.
- That a Step with Steps to come speaks its passage is in the details, not drawn.

## Verification

`overview.png` (1440×2200) and `decisions.png` (1440×2600, tall enough for #402's last footnote) were recaptured with headless Chrome and inspected directly. On an earlier capture the taller done box met the "or a sure “yes”" label; it is moved down 14. Text fits every box, arrowheads end at their boxes, and the new note lines clear every connector, #402's fact branch among them. `voice.png` is retained from `b2796ba1` + #402; that view and the shared helpers are unchanged.

## Unresolved

None.
