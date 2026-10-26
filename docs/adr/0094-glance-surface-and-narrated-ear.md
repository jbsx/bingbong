# ADR 0094: The screen says from the chair whether the ear will hear, and the ear's waits count their seconds

## Status

Accepted 2026-10-26. The orchestrator ruled on the owner's behalf on
#436, #441, #442, #445 and #447, under `docs/agents/ui.md` (principles 1,
2, 5, 7, 9). Built on main 3a8c5d2f..a6966e43. Amends ADR 0012
(the slim Toolbar; "Ready" as the resting word), ADR 0019 (the first
partial at 1 s), ADR 0078 (its two reading distances) and ADR 0093
(`ready`).

## Context

The owner glances from 2 m to see whether the app will hear, and what
it did. On 4af7377e the pill was 26 px, the result was gone once the
panel shut, and the Idle Screen had 17 type sizes. 120 of 239
Utterances ended before the first partial at 1 s. After a kiosk boot,
for about 1.7 s nothing could be heard and for about 6 s a line waited
on the transcriber, while the screen said "Say “Bing Bong”".

## Decision

- **The status pill is 65 px, in a 104 px Toolbar**: the stage word
  (Opening…, Loading…), then the host or terms it is on and its seconds.
- **The last spoken sentence stays** in the hint with the panel shut,
  until the next Receipt. 40 px is a guess: 65 px holds fifteen
  characters.
- **Four type sizes: 16/24/40/65 px** (`--type-s/m/l/xl`). Clock,
  temperature, weight, usage and chart numerals are data
  (`data-display`) and exempt. A card that overflows drops its secondary
  lines to 16 px, never its numerals. In the panel only, a state word
  wider than the panel steps to 40 px (#447; wrapping broke the word).
- **The ear's phases are on screen**, in CONTEXT.md's words, never a
  model's name:
  - **Starting**: "loading the ear" and its seconds, orb grey, never
    "Say “Bing Bong”" or "Ready". `ready` now waits for `vad-loaded`,
    meaning speaking now is heard. Screen only: "I'm ready" is said
    only if a wake came in during the load. A line taken before the
    transcriber is in is held: Starting, its words, its seconds.
  - **Hearing**: from the VAD frame that confirms speech, "…" under
    Listening; the partial's words replace it. The first partial comes
    at 0.5 s of speech.
  - **Transcribing**: the last partial in quotes, or "your words", and
    the seconds since the Endpoint.
  - **A failed load ends the wait**: "Ear did not start — type, or
    restart", no count, a `voice.ear.load` fault record. Shown, and said
    only where "I'm ready" would have been. A later good load clears it.
- **Every failure names a Try line**, fixed in code (`TRY_LINES`) per
  failure and Command kind. A unit test feeds every line from that table
  through the Local Match on four pages; each must come back as a
  Command of its verb (#445).
- **"Still …" fires at each stage's own p95**: thinking and acting
  1711 ms, loading 7192 ms: dev-PC numbers, marked guesses in
  `runProgress.ts` until #439's kiosk baseline dates them from the new
  `stage-<status>` spans.

## Measures

- `stateShots`: sizes, the kept result, the ear's waits and failure.
  9/9 on the fake mic.
- `hearingReceipt` e2e: speech confirmed to painted "…". Dev 10.5 ms
  (Idle) and 18.5 ms (Prompt); constrained 10.9–20.9 ms. Bar 100 ms.
- `voiceChain` e2e, first partial, 3 runs per arm, constrained:
  `turnScoreMs` p95 172–196 at 0.5 s against 164–283 at 1 s; `vadLag`
  max 412–516 against 479–582. Inside the noise; 0.5 s kept, at about
  2.5 points of a core while speaking.
- Perf spans `speech-to-hearing` and `endpoint-to-words` in `perf:report`.
- On the kiosk `ready` moves about +1.46 s (p50), and `stt-loaded`
  with it, about 10.0 → 11.5 s.

## Consequences

- **The final decodes at the pause (#443).** The Endpoint's audio is
  known when the turn check is asked, so the transcriber starts it then.
  In voiceChain the median run's gap fell 474 → 433 ms p50 (p95 736 →
  671), with identical words on 42/42 dumps. An unfinished verdict costs
  one spare decode.
- Principle 5's 65 px is bent for the panel and the kept result;
  principle 2's spoken bound, for the ear's screen-only waits.
- Owed on the kiosk (#439): the receipt, the partial's CPU, the bounds.
