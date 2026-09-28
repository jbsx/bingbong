// The checks a Grading Key requires and its command never asks for (#287).
//
// A key may require a fact the command's text does not ask: the Eurostar
// command asks for "the smallest reduction", and its key also requires two
// facts beside it. Neither the key nor the product changes for that — a key
// is not revised after its Answers have been read, and an assistant that
// lists what nobody asked is tuned to the corpus. What this list feeds is a
// second reading beside the verified count: "verified, or failing only on
// unasked facts". It is reported, never gated.
//
// WHY IT IS NOT IN `keys.ts`. A key's digest is over its content, and every
// Grade is bound to that digest: a mark inside the key would make every
// existing Grade stale.
//
// WHAT JOINS IT. A check joins only on the evidence the first two joined on:
// the command's text does not ask for it. A check the Answers often miss is
// not one; neither is a check that is hard to reach.
//
// IT HOLDS CHECK IDS AND A REASON EACH, NEVER CHECK WORDING, and it imports
// nothing. It still names checks, so nothing on the capture path may load
// it; `corpus.test.ts` walks the import graph for that and pins every id here
// to a check the key manifest declares for that Hunt and step.

export interface UnaskedFact {
  readonly huntId: string
  /** The step as the key manifest and the Round Audit name it: `initial` or `follow_up`. */
  readonly stepId: string
  readonly checkId: string
  /** What the command asks in its place, in one line. */
  readonly reason: string
}

export const UNASKED_FACTS: readonly UnaskedFact[] = [
  {
    huntId: 'rule-eurostar-luggage',
    stepId: 'initial',
    checkId: 'fact-03',
    reason: 'the command asks whether the guitar is allowed despite its length, and never whether the suitcases meet a length limit',
  },
  {
    huntId: 'rule-eurostar-luggage',
    stepId: 'initial',
    checkId: 'fact-07',
    reason: 'the command asks for the smallest reduction that makes the load fit, and never for another reduction that would',
  },
]

/** The check ids of the Unasked Facts of one Hunt and step; empty for a step the list does not name. */
export function unaskedFactsOf(huntId: string, stepId: string): ReadonlySet<string> {
  return new Set(UNASKED_FACTS.filter((entry) => entry.huntId === huntId && entry.stepId === stepId).map((entry) => entry.checkId))
}
