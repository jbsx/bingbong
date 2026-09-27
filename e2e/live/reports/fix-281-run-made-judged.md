# Run-made Evidence Checkpoints of fix-281, judged (#281)

Every Evidence Checkpoint the Run made from a Selected Passage in `fix-281-1..3`, read from
the Run Traces (`origin: run`, all 22 accepted), with a verdict on whether the passage states
the Asked Item for the Run's Objective. Judged by the implementing session, not the model
reviewer. `right`: states it. `weak`: on the right object but does not settle the item, or
from a source the Objective ruled out. `wrong`: another object, or no statement of the item.

Initials: 21 checkpoints — 16 right, 5 weak, 0 wrong. Precision 0.76 counting weak as a miss,
1.00 counting only wrong. The follow-up checkpoint (#6) is outside the gate.

| # | Pass, hunt | Asked Item | Passage (head) | Verdict |
|---|---|---|---|---|
| 1 | 1, longitude | Harrison longitude watch catalogue ID | `ID: \| ZAA0037` | right |
| 2 | 1, longitude | catalogued creator of the watch | `Creator: \| Harrison, John` | right |
| 3 | 1, longitude | dial diameter of the watch | `Measurements: \| Dial diameter: 102 mm;…` | right |
| 4 | 1, longitude | larger machine superseded | `Marine timekeeper, H4. … the much larger H3 …` | right |
| 5 | 1, longitude | other watch sharing the case and its name | `Parts: \| H4 Carrying case for H4 and K1 (ZAA0037.1) …` | weak — K1 by designation, on the watch's Parts row |
| 6 | 1, Eurostar (follow-up) | Eurostar Premier luggage allowance | `Number of bags included \| 2 pieces … \| 3 pieces of luggage + 1 piece of hand luggage.` | right (not gated) |
| 7 | 1, Voyager | which earlier observations were re-examined | `The plasma wave science team reviewed its data … October and November 2012 …` | right |
| 8 | 2, longitude | Watch's exact catalogue ID | `ID: \| ZAA0037` | right |
| 9 | 2, longitude | Watch's catalogued creator | `Creator: \| Harrison, John` | right |
| 10 | 2, longitude | Watch's dial diameter | `Measurements: \| Dial diameter: 102 mm;…` | right |
| 11 | 2, longitude | Carrying case ID | `Parts: \| H4 Carrying case for H4 and K1 (ZAA0037.1) …` | weak — a part number on the watch's record, not the case's own entry |
| 12 | 2, longitude | Other watch in the case and its name | `Parts: \| H4 Carrying case for H4 and K1 (ZAA0037.1) …` | weak — as #5 |
| 13 | 2, longitude | Which watch occupies each side of the case | `Wooden carrying case … H4 on the left and K1 on the right …` | right |
| 14 | 2, longitude | Catalogue's date field for the case | `Date made: \| circa 1962` | right |
| 15 | 2, Eurostar | Is the guitar allowed despite its 90 cm length? | `Whilst … cello's measuring over 85cm … guitars can be carried on the overhead luggage racks …` | weak — the Musicians' Union page; the Objective asks for official Eurostar rules |
| 16 | 2, Eurostar | How does the guitar rule differ from the rule for cellos? | the same block as #15 | weak — as #15 |
| 17 | 2, Voyager | crossing date eventually accepted by the team | `… first detected on Aug. 25, 2012. The Voyager team generally accepts this date …` | right |
| 18 | 2, Voyager | which earlier observations were re-examined | as #7 | right |
| 19 | 3, longitude | Catalogued creator of the watch | `Creator: \| Harrison, John` | right |
| 20 | 3, Eurostar | Does the guitar consume an allowance slot? | `Musical instruments smaller than 85 cm long and guitars can travel with you as part of your luggage allowance …` | right |
| 21 | 3, Voyager | Publication date of the June 2013 NASA/JPL account | `June 27, 2013` (archived release 2013-209) | right |
| 22 | 3, Voyager | Publication date of the September 2013 NASA announcement | `September 12, 2013` (archived release 2013-277) | right |
