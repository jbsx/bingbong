# ADR 0022: The Bias Lexicon grows itself

## Status

Accepted

## Context

The Bias Lexicon (#62) is a static array (`biasLexicon.ts`) a developer
extends by hand when a mishear is discovered — the glossary already promised
"plus mishears discovered in use," but nothing fulfills that at runtime.
This session decided how it happens.

The central tension: the user wants lexicon growth to be an invisible
abstraction ("hassle free… no intervention"), and also wants the lexicon
conservative ("I don't want it unnecessarily adding the wrong words").
Every human gate — confirmation cards, teach flows, voice forget — was
proposed and rejected as exactly the hassle being removed. With no human in
the loop, conservatism must live entirely in the admission policy.

The failure mode that policy must kill is self-reinforcement: a wrongly
admitted spelling gets boosted by the decode, transcribes into future
utterances, and the model reads its own guess back as confirmation — a
feedback loop with no human left to break it.

## Decision

- **The model proposes; the app disposes.** At end of message, alongside
  its Run Note, the orchestrator emits a Mishear proposal — the suspect
  transcript word and its confident repair. No extra model call. The app
  validates shape, dedupes, and keeps a persistent proposal ledger in
  `lexicon.json` (userData, alongside the settings store — not inside
  `settings.json`, whose sanitize-to-default behavior would silently erase
  a vocabulary on one corrupt write).
- **Admission is recurrence-gated, cache-style.** A first proposal is a
  miss — recorded, admitted as nothing. The term becomes a Learned Term
  only when proposed identically across two Runs, proof two independent
  contexts agreed. This starves the self-reinforcement loop rather than
  relying on the model to revise its own entries later.
- **Removals are immediate, adds never are.** The model sees the current
  Learned Terms in context and may propose removing its own bad entries;
  removal applies on first proposal. Deleting is always safe; adding
  never is.
- **Human surface is Settings-only.** The Learned Terms list is viewable
  and manually editable in the Settings panel. Not voice-reachable — no
  "what's in my vocabulary," no spoken forget. Manual deletion marks the
  term rejected: the ledger can never auto-readmit it, but a manual
  re-add always works.
- **One uniform boost.** Learned Terms bias decode identically to the
  Seed Lexicon (`DEFAULT_BIAS_BOOST`); no tiering. A wrong admission only
  flips acoustic near-ties — symmetric with the mishear it fixed — and
  Settings removal is the remedy. Tiering is the agreed fallback if
  ordinary speech starts flipping, not a pre-built knob.
- **Cap 500, LRU eviction, no decay.** The least-recently-biased term
  falls out when full. No time-based expiry in v1: a stale entry costs
  only a near-tie.

## Consequences

- The decode input becomes the union of Seed Lexicon (frozen in source)
  and Learned Terms (persisted); the per-vocab applier cache
  (`createMoonshineTranscriber.ts`) needs invalidation when the learned
  set changes, effective next Listen — mid-Session growth included.
- The lexicon persists across Sessions and restarts, like the Browser
  Profile: durable user accommodation, not model context and never a
  Setting proper.
- Two code-known costs at scale: `activeRests` walks every phrase every
  decode step — 500 terms need a word-start index; and the uniform +2
  boost over a 500-term union needs the "ordinary speech untouched" test
  (`createMoonshineTranscriber.models.test.ts`) kept green as the corpus
  grows.
- If mishears of ordinary speech ever trace to Learned Terms, the
  escalation ladder is fixed in advance: boost tiering first, then
  time-based decay — both revisable without touching this ADR's shape.
