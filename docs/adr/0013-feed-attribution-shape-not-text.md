# ADR 0013: Feed attribution by shape and orb, not text handles

## Status

Accepted

## Context

The Feed labeled display-less assistant entries with a literal "bing bong"
text handle (and typed commands with "you") — chat-app vocabulary in a
voice-first assistant, inconsistently applied because Card-carrying Answers
went unlabeled. A restart could also render a recorded Spoken Rendering beside
its recorded Card because live suppression knew the turn id while hydration did
not.

## Decision

- **One attribution device.** Entry shape (user bubbles right-aligned,
  assistant entries as railed Cards) plus the Status Capsule orb marks every
  assistant Feed Entry. The assistant name stays in screen-reader text. No
  visual text handles or user glyphs.
- **One Answer, one Feed Entry.** When an Answer has no Card, its Spoken
  Rendering appears italic and unquoted in the same Card frame. Code-owned
  announcements with a known Card (for example, download notices) stop
  emitting a feed `speak` event; TTS still speaks them directly.
- **Streams show state, not protocol.** While an Answer forms, its entry shows
  the orb with an animated ellipsis. Raw protocol deltas never render. The
  indicator resolves when the model starts acting, another event lands, the
  final Card arrives, or the Run ends.
- **Hydration uses recorded run correlation.** Hydration reuses the live
  `displayedTurns` suppression rather than positional pairing. Entries already
  carry their run id, and runs correlate 1:1 to turns (#28), so the hydration
  serving boundary stamps each entry's turn id from its run at read time. No
  schema change is needed; history recording remains untouched (#49). Legacy
  runs without turn ids hydrate unsuppressed as before.

## Consequences

- Live and hydrated views enforce the same Answer suppression, including
  startup races where either rendering arrives first.
- Confirmation prompts and other display-less Answers remain visible as
  Spoken Renderings.
- The Feed no longer exposes raw model-response JSON while an Answer streams.
