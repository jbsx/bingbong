# The Jev corpus

Replayable Jev cases (#338): each `*.json` here is one recorded ask — the
state text and the questions with their options, exactly as Jev was sent
them — and the answer each question should get, as a Choice label
(`{"question": "action", "label": "click-27"}`), a label at a floor
(`{"question": "outcome", "label": "yes", "atLeast": 0.7}` — the runner acts
on a Verdict only when it is sure, #366), a label it must not be
(`{"question": "action", "not": "click-21"}`) or a ceiling on whatever it
chooses (`{"question": "outcome", "below": 0.7}`).

Jev reads a Command as one whole action (#370), so a case that expects a
Command names it on the action card: `action=click-12` is a click on ref 12,
`action=type-3` typing into ref 3, `action=open-2` opening result link 2,
`action=loop-7` a Media Op on ref 7, `action=skip` an Appliance Verb (#374). The cases recorded on the verb and target cards
were converted in #370: each ask's action card rebuilt by the real
`commandQuestions`, its refs and their lines the same as the target card's.

- `pnpm jev:candidates` lists the logged asks a misfire or overrun signal
  pointed at.
- `pnpm jev:case <turnId> --expect action=click-27 [outcome=yes>=0.7 action!=click-21 …]` writes
  one here.
- `pnpm jev:replay` asks the real Jev every case again and exits non-zero on
  any failure. It needs `TYPESAFE_API_KEY` and is not part of `pnpm test`.

Asks carry page text from real browsing, so nothing lands here on its own:
a case is committed only when the owner promotes it. A change to Jev's state
text or question wording is accepted only if it passes its own case and no
other case gets worse.
