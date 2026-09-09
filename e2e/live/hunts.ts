// The live-web hunt corpus (#223/#225) — the four accepted information hunts
// and their two fixed follow-ups, exactly as the measured assistant receives
// them.
//
// WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT. This module holds prompt
// text and nothing else. The grading keys — required facts, evaluator source
// URLs, answer passages, pitfalls, uncertainties — live in ./keys.ts, which
// nothing on the capture path imports. That split is the enforcement of
// #225's separation rule: the runner cannot leak a key it never loaded, and
// `corpus.test.ts` pins the two modules apart by asserting no key material
// appears in any prompt. A single file holding both would leave that rule as
// a promise instead of a property.
//
// WHY THESE FOUR. Each names a different failure the study wants to
// distinguish, so one rehearsed question cannot define performance
// (#223 story 3): a hardware/software COMPATIBILITY check whose three
// sub-answers can be right or wrong independently; a HISTORICAL
// IDENTIFICATION whose catalogue fields are near-matched by adjacent
// numbers on the same page; a RULE APPLICABILITY question whose live policy
// contains an explicit exception that a plausible reading of the general
// rule gets wrong; and a SUPERSEDED-INFORMATION reconciliation that a
// remembered date answers incorrectly and only two official accounts answer
// correctly.
//
// NOTHING HERE PRESCRIBES A ROUTE. No prompt names a URL, a search engine, a
// page count, or a delegation shape — the assistant's discovery is the thing
// being measured, and equivalent valid sources are accepted at grading time
// (#223 story 7). The absence of `http` in every prompt is asserted, not
// merely intended.
//
// REVISIONS ARE PROVENANCED, NOT SILENT. A prompt's `text` may only change
// alongside a `version` bump and a new `revisions` entry saying what was
// re-verified. `corpus.test.ts` pins `revisions.length === version`, so
// editing a task after seeing a measured Answer — the bias #225's third
// acceptance criterion exists to prevent — cannot pass review as a
// whitespace change.

/** Why one version of a prompt or key exists. Newest last. */
export interface Revision {
  version: number
  /** ISO date (YYYY-MM-DD) the revision was made. */
  date: string
  /** What changed, and the re-verification that justified it. */
  reason: string
}

/**
 * A prompt exactly as it is typed into the Prompt Bar. This text is the whole
 * of what the measured assistant receives for its command — no preamble, no
 * key, no source list, no grading hint.
 */
export interface MeasuredPrompt {
  /** Bumped on every `text` change; `revisions` must hold exactly this many entries. */
  version: number
  text: string
  revisions: readonly Revision[]
}

export type HuntId =
  | 'compatibility-pi-camera'
  | 'historical-longitude-watch'
  | 'rule-eurostar-luggage'
  | 'superseded-voyager-interstellar'

/**
 * The kind of information hunt. Reporting groups by it and difficulty is
 * assessed per kind; nothing gates on it and the scheduler never reads it.
 */
export type HuntKind =
  | 'compatibility'
  | 'historical-identification'
  | 'rule-applicability'
  | 'superseded-information'

export interface LiveWebHunt {
  id: HuntId
  kind: HuntKind
  /** The initial command. Starts a fresh Session on a restored benchmark profile. */
  prompt: MeasuredPrompt
  /**
   * The one fixed continuation, on the two hunts that have one. It is
   * submitted in the SAME Session as `prompt`, after that Run ends, at most
   * once, and regardless of whether the initial Answer was correct (#225).
   * The other two hunts have none: #223 accepted no follow-up for them, and
   * inventing one here would add measured commands the pilot cap forbids.
   */
  followUp?: MeasuredPrompt
}

/** Researched and accepted with #223 on this date; the initial version of every prompt. */
const RESEARCHED: Revision = {
  version: 1,
  date: '2026-09-09',
  reason:
    'Initial accepted text, researched from primary sources and approved on #223. No measured Answer had been observed.',
}

/**
 * The four hunts in the order a pass runs them. The order is not load-bearing
 * — every hunt starts from a fresh Session and a restored profile, so no hunt
 * can inform another (#225) — but it is fixed so two passes are comparable.
 */
export function liveWebHunts(): readonly LiveWebHunt[] {
  return [
    // 1. COMPATIBILITY. Three answers that can each be right or wrong on
    // their own — the cable, the hardware pairing, the software stack — so a
    // confident half-answer is visibly a half-answer. The old-tutorial
    // framing is the trap: the legacy stack the user names cannot drive this
    // camera at all, and saying so requires reading current documentation
    // rather than pattern-matching the tutorial.
    {
      id: 'compatibility-pi-camera',
      kind: 'compatibility',
      prompt: {
        version: 1,
        revisions: [RESEARCHED],
        text: 'I have an original Raspberry Pi Zero v1.3, not a Zero 2, with the small CSI camera connector, and the standard visible-light Raspberry Pi Camera Module 3. I want autofocus still photographs. I have the ribbon supplied with the camera and an old tutorial using `raspistill` and the legacy camera stack. Can the hardware work together, and which cable and software assumptions must change? Give a still-capture approach for Raspberry Pi OS Bookworm, distinguishing it from the old tutorial. Treat this as a compatibility check, not installation instructions or a shopping request.',
      },
      // The enclosure constraint flips the verdict to "no" on a mechanical
      // fact that lives in different documentation from everything the
      // initial answer rested on. Continuity is the measurement: the same
      // Session must carry the original requirements forward and re-judge
      // them, not restate the initial answer or start a new question.
      followUp: {
        version: 1,
        revisions: [RESEARCHED],
        text: 'One more requirement: the camera must fit the unmodified camera lid of the official Raspberry Pi Zero Case, the one intended for Camera Module 2. I cannot alter the lid or mount the camera outside it. Does the Camera Module 3 solution still meet all my requirements? Explain what changes and what does not.',
      },
    },
    // 2. HISTORICAL IDENTIFICATION. The catalogue page carries several
    // numbers that near-match the wanted ones (a numeric URL identifier
    // beside the catalogue ID, an overall width beside the dial diameter),
    // and the linked case record contradicts its own structured date field
    // in prose. Success needs the right field, and needs the dating tension
    // preserved rather than resolved into one confident chronology.
    {
      id: 'historical-longitude-watch',
      kind: 'historical-identification',
      prompt: {
        version: 1,
        revisions: [RESEARCHED],
        text: "Identify a longitude watch in Royal Museums Greenwich's collection from these clues: work on it began in 1755, it was completed in 1759, and a successful pocket watch made by John Jefferys to Harrison's design helped point the way away from Harrison's much larger machine. Give the watch's exact catalogue ID, catalogued creator, and dial diameter, and identify the larger machine it superseded as Harrison's promising approach. Then identify the linked wooden carrying case that holds this watch together with another watch: give the case ID, the other watch's name, and which watch occupies each side. Was that carrying case an original 1759 accessory? Report the catalogue's date field and qualify the historical dating in its description rather than forcing them into one certain date.",
      },
    },
    // 3. RULE APPLICABILITY. The general rule and the explicit exception sit
    // on two different pages of the same policy, and applying only the
    // general one gives a wrong, plausible answer. The question also asks
    // for the SMALLEST fix, which a correct rule reading answers and a
    // vague one cannot. Its facts are current policy and are the one part
    // of this corpus that can legitimately change under the key — see
    // `liveFacts` in ./keys.ts.
    {
      id: 'rule-eurostar-luggage',
      kind: 'rule-applicability',
      prompt: {
        version: 1,
        revisions: [RESEARCHED],
        text: 'An adult is travelling London to Paris in Eurostar Standard. They can safely carry everything themselves: two ordinary suitcases, each 70 cm at its longest point, one small daypack, and an acoustic guitar in a case 90 cm long. Is the complete load included in the ordinary luggage allowance? Resolve whether the guitar is allowed despite its length, whether it consumes an allowance slot, and the smallest reduction in the carried items that would make the load fit. Distinguish the guitar rule from the rule for medium-sized instruments such as cellos. Use current official rules for this route. Do not book, buy, log in or contact anyone.',
      },
      // One variable changes — the fare class — and only the allowance
      // arithmetic should move with it. An assistant that re-derives the
      // guitar exception from scratch, or drops the original load, is
      // failing continuity rather than the rule.
      followUp: {
        version: 1,
        revisions: [RESEARCHED],
        text: 'Keep the original full load, London-to-Paris route and carry-it-yourself assumption. Change only the ticket: the adult is travelling in Eurostar Premier rather than Standard. Is a suitcase still required to be left behind under the published allowance?',
      },
    },
    // 4. SUPERSEDED INFORMATION. Two official accounts disagree, and the
    // disagreement is not chronological — the crossing predates both. A
    // remembered date answers this wrongly, a single modern summary answers
    // it shallowly, and only reading both releases yields the causal
    // reconciliation (a missing magnetic-field sign, then a plasma-density
    // measurement that did not need it).
    {
      id: 'superseded-voyager-interstellar',
      kind: 'superseded-information',
      prompt: {
        version: 1,
        revisions: [RESEARCHED],
        text: "NASA/JPL's June 2013 coverage says Voyager 1 had not yet reached interstellar space, while NASA's September announcement says it had already done so. Reconcile those accounts. Give both publication dates and the crossing date eventually accepted by the team. Explain the missing sign behind the earlier conclusion and the later measurement that changed it, including when the decisive observation occurred and which earlier observations were re-examined. Why was this not simply a crossing that happened between the two announcements? Use both official accounts rather than only a modern summary.",
      },
    },
  ]
}

/**
 * Every command a pilot pass may submit, in schedule order: each hunt's
 * initial prompt, each followed immediately by its own follow-up where one
 * exists. This is the pilot's whole work bound — four initials plus two
 * follow-ups, six in total — and the scheduler derives its cap from this
 * list rather than from a hand-written number that could drift from the
 * corpus.
 */
export function scheduledCommandCount(hunts: readonly LiveWebHunt[] = liveWebHunts()): number {
  return hunts.reduce((total, hunt) => total + (hunt.followUp ? 2 : 1), 0)
}
