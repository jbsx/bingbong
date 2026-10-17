# ADR 0077: A name is matched after recognition against the page, and a name that worked is learned

## Status

Accepted on 2026-10-17 for the `kachow` branch, from the owner's reading
of the first replay of their own voice (#324's AC8 dumps, 31 Utterances)
and the plan they set out as #325. Built the same day.

## Context

The useful vocabulary of a spoken browser is mostly on screen: link
titles, channel names, the suggestions under a search box, the page's
title. Moonshine hears none of it. In the 2026-10-17 replay "Linus Tech
Tips" came out as "line of factors", "line of tactics", "liner stack
tips", "Linus Tech dips" and "line stack tips" before it came out right,
and "Elon Musk's" as "your masks" and "a non-asks". The user retried the
same name five ways; every retry was a Misfire the branch counts and a
Reaction spent on nothing.

The Bias Lexicon (ADR 0022) already biases the greedy decode toward a
phrase list, but its list is the app's own words and whatever Learned
Terms a Run proposed. On this branch nothing proposes: the orchestrator
that did is gone. The decode's bias was static, and the reading took the
transcript's spelling as the Slot verbatim (ADR 0076: a Slot is chosen
from the Utterance's own words, never composed).

Probed on the owner's 31 dumps before building: with the names a page
would show added as bias phrases at a lift of 1.5 beside the Seed
Lexicon, Moonshine Small changed 5 transcripts of 31, every one toward
the name ("Elon Musk's profile" right, "Linus Tech tips" right twice,
two more within one edit of it) and none away from anything. At the Seed
Lexicon's own lift of 2 the result was the same; without the Seed Lexicon
beside them a lift of 2 broke one "Go back." into "You go back." (the
word-start piece of "YouTube"). Moonshine Base gained less and lost more
("linus tech tips" → "lioness tech tips"), and its p95 over the same
dumps was 161 ms to Small's 178 ms with worse transcripts on six of them:
Small stays the tier.

## Decision

Three things, each a Misfire-reducer that asks the user nothing:

1. **Page Terms bias the decode, for the one Utterance spoken over the
   page.** The page the runner collects at speech start (#324) is read
   for its names — every run of capitalised, all-caps or numbered words
   in the title, the refs' labels and the viewport text, at most four
   words each, ranked by how often the page shows them, the top 64 — and
   those are a bias set of their own beside the Bias Lexicon, lifted by
   1.5 to the lexicon's 2. They are replaced at the next speech start.
   Nothing restricts what can be said.

2. **A name is matched after recognition.** A spoken Slot that is search
   terms or text to type is keyed by sound — a Metaphone-style key over
   its words, run together so a moved word boundary costs nothing — and
   compared with the Page Terms, then the Learned Terms. The nearest
   candidate within one edit per four key characters, over the whole
   Slot or a span of it within a word of the candidate's length, is the
   spelling the Command carries. What was heard stays on the decision
   record (`slotHeard`, `slotFrom`). An address and a key are never
   rewritten; a Slot that already carries a candidate as spelled is left
   alone; a typed line is never matched, it is exact. The Name Match
   amends ADR 0076's "never composed": the Slot is still the user's own
   words, in the page's spelling.

3. **A name that worked is learned.** A Name Match the page witnessed is
   admitted to the Learned Terms at once: the page's spelling is the
   proof the recurrence gate of ADR 0022 stood in for. A chain of retries
   — spoken Slots within a minute of each other that sound alike, with
   any recoveries between — that ends with the user moving on (a click, a
   scroll, a read, forward) proposes its last Slot through that gate,
   admitted only when a later session ends on the same spelling. A term
   the user deleted in Settings stays out of both doors. Every spoken
   transcript touches the Learned Terms it carries, so the cap evicts the
   stale ones.

## Considered options

- **A bigger or better recogniser.** Out: the Hardware Floor and the
  owner's "speed over accuracy". Base was tried on the same dumps above.
- **Give Jev the candidates and let it pick.** Deferred: the Name Match is
  deterministic and runs on the Local Match path too, where Jev is never
  asked; adding candidates to the Slot Choice would change the request
  shape AC3 pins for nothing the sound key does not already settle. The
  door stays open for names the sound key cannot reach.
- **Confirm a rewritten Slot.** Rejected by ADR 0076: a question is a
  round-trip; a wrong Name Match is a Misfire, recovered and counted.
- **Bias Page Terms at the lexicon's lift.** Same wins on Small in the
  probe, more exposure to a common word-start piece; the lesser lift
  keeps the app's own vocabulary ahead of the page's.

## Consequences

- The reading of a spoken search or type waits for the page collected at
  speech start even when the Command needs no refs; that page is
  normally in hand by the Endpoint, so the Reaction pays nothing. A
  typed line keeps the page-free shortcut.
- The bias applier's trie over the vocab is built once per vocab and
  reused; only the phrase tries rebuild per Utterance.
- `pnpm perf:report` counts the Name Matches by source on its decisions
  line; `pnpm stt:replay` biases toward the Seed Lexicon as the app does
  and takes `BINGBONG_STT_BIAS` to stand in for a page's names.
- The Learned Terms grow without an orchestrator: the Settings list is
  where the user sees what the app learned and removes what it should not
  have.
- Glossary: Page Terms, Name Match; Mishear and Learned Term reworded for
  the new proposer. ADR 0022's "the model proposes" is now "the page or a
  settled retry proposes" on this branch.
