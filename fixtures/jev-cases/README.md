# The Jev corpus

Replayable Jev cases (#338): each `*.json` here is one recorded ask — the
state text and the questions with their options, exactly as Jev was sent
them — and the answer each question should get, as a Choice label
(`{"question": "target", "label": "ref-27"}`) or a label it must not be
(`{"question": "target", "not": "ref-21"}`).

- `pnpm jev:candidates` lists the logged asks a misfire or overrun signal
  pointed at.
- `pnpm jev:case <turnId> --expect target=ref-27 [target!=ref-21 …]` writes
  one here.
- `pnpm jev:replay` asks the real Jev every case again and exits non-zero on
  any failure. It needs `TYPESAFE_API_KEY` and is not part of `pnpm test`.

Asks carry page text from real browsing, so nothing lands here on its own:
a case is committed only when the owner promotes it. A change to Jev's state
text or question wording is accepted only if it passes its own case and no
other case gets worse.
