// EVALUATOR-ONLY grading keys for the live-web hunts (#223/#225).
//
// NOTHING ON THE CAPTURE PATH MAY IMPORT THIS MODULE. It holds the answers,
// the primary-source URLs, and the passages those answers rest on. The
// measured assistant must discover all of it on the live web; a key that
// reached its context would turn a discovery measurement into a reading
// comprehension one. The split is structural — ./hunts.ts holds prompt text
// and nothing else — and `corpus.test.ts` asserts that no string in here
// appears in any prompt, so the rule fails a test rather than a review.
//
// A KEY IS NOT A PREDICATE. Grading here is manual and source-grounded
// (#223): an evaluator reads the Answer against `requiredFacts`, applies
// `constraints`, checks `pitfalls` were not walked into and `uncertainties`
// survived, and follows `sources` to confirm. There is deliberately no
// automated matcher — unordered keyword matching passes a near-miss that
// names the right numbers about the wrong object, which is exactly the
// failure mode two of these hunts were built to catch.
//
// EQUIVALENT SOURCES PASS. `sources` records where the evaluator verified
// each fact, not a route the assistant must reproduce. An Answer grounded in
// a different page carrying the same statement is correct (#223 story 7).
//
// KEYS ARE REVISED WITH PROVENANCE, NEVER TO MATCH AN ANSWER. Facts may
// legitimately change — `liveFacts` names the statements that can — and the
// rule is to recheck the source and bump the key with a reason, before a
// capture. Rewriting a key after reading a measured Answer is the specific
// bias #225's third acceptance criterion forbids; `revisions.length ===
// version` makes an unprovenanced edit visible.

import { digestOf } from './artifacts.ts'
import {
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
  type LiveKeyCheck,
  type LiveKeyManifest,
  type LiveKeyTask,
} from './grades.ts'
import { liveWebHunts, type HuntId, type Revision } from './hunts.ts'

/** A primary source, and what the evaluator verified it states. */
export interface KeySource {
  url: string
  /** The statement this page supports, in the evaluator's words or a short quote. */
  supports: string
}

/** How grading a follow-up differs from grading its initial prompt. */
export interface FollowUpDelta {
  /** The facts the follow-up Answer must carry, beyond continuing the Session coherently. */
  requiredFacts: readonly string[]
  /** What must not be asserted in the follow-up specifically. */
  pitfalls: readonly string[]
  sources: readonly KeySource[]
}

export interface GradingKey {
  huntId: HuntId
  version: number
  revisions: readonly Revision[]
  /** What a correct Answer must carry. All of them, for Task Success. */
  requiredFacts: readonly string[]
  /** How to grade — scope, separability, and what evidence is and is not required. */
  constraints: readonly string[]
  /** Near-matches and plausible wrong readings that must fail. */
  pitfalls: readonly string[]
  /** Genuine source uncertainty that a correct Answer preserves rather than resolves. */
  uncertainties: readonly string[]
  sources: readonly KeySource[]
  /**
   * Statements that are current-state rather than settled history, and so
   * may legitimately differ at capture time. Recheck these against their
   * sources before a measured pass; a changed live rule updates the key
   * (with provenance), it does not fail the Answer.
   */
  liveFacts: readonly string[]
  /** Present exactly on the hunts that have a follow-up. */
  followUpDelta?: FollowUpDelta
}

const RESEARCHED: Revision = {
  version: 1,
  date: '2026-09-09',
  reason:
    'Initial key, researched from the primary sources listed below and accepted on #223. Verified against retrieved page bodies; no measured Answer had been observed.',
}

const GRADING_RULES: Revision = {
  version: 2,
  date: '2026-09-12',
  reason:
    'Two grading rules added to every key’s constraints, fixing the judgement calls #227 recorded as carrying the pilot result: a required fact must be stated, not left to inference; an uncertainty is failed only when the Answer resolves it. No fact, pitfall, uncertainty or source changed, so every check id and count is unchanged. Decided on #223 after the pilot Answers had been read, and recorded as rules for the reviewer rather than a change to what any key requires — the strict reading was taken where it costs a pilot verdict, never the one that rescues it.',
}

/**
 * Rules every reviewer applies, on every key, whoever the reviewer is. They
 * decide verdicts without being checks, so they live in `constraints`, where
 * the bench shows them and the key digest binds them. Each is one of the two
 * calls #227 flagged as carrying the whole pilot result — both went the
 * generous way there, and neither was written down, so the next reviewer
 * could have gone the other way without anyone noticing.
 */
const SHARED_GRADING_RULES: readonly string[] = [
  'A required fact is carried only when the Answer states it. An enumerated set, a piece of arithmetic or a general rule from which a reader could work the fact out does not carry it: a required fact left to inference is not satisfied.',
  'An uncertainty check ("The Answer preserves: …") is unsatisfied only when the Answer resolves the matter — states it with a certainty the source does not have. An Answer that never reaches the matter has not resolved it; the required facts it missed carry that failure, not this check. An Answer that does reach it must carry the source’s own qualification.',
]

export function gradingKeys(): readonly GradingKey[] {
  return [
    {
      huntId: 'compatibility-pi-camera',
      version: 2,
      revisions: [RESEARCHED, GRADING_RULES],
      requiredFacts: [
        'Compatible in principle: the stated board has a CSI camera connector, which is what the camera requires.',
        'The standard ribbon supplied with the camera does not fit the Zero connector.',
        'The required cable is a Standard-Mini / Zero camera cable: a 15-pin camera end and a 22-pin Zero end.',
        'Camera Module 3 has autofocus, and its IMX708 sensor is supported through libcamera.',
        'The legacy camera stack supports only Camera Modules 1 and 2 and the HQ camera, not Module 3, so the raspistill tutorial cannot drive this camera.',
        'Raspberry Pi OS Bookworm uses the rpicam applications; a documented still capture using them, with an appropriate autofocus explanation, is the current approach.',
      ],
      constraints: [
        'Grade the cable, the hardware pairing, and the software stack separately — one of the three being right does not carry the others.',
        'Require source support for the hardware and software claims. Producing an actual photograph is not required and was never verified by the evaluator.',
        'An autofocus-on-capture explanation is acceptable when it describes running an autofocus cycle just before image capture.',
        ...SHARED_GRADING_RULES,
      ],
      pitfalls: [
        'Treating the supplied ribbon as usable because the connector is "the camera connector" — the Zero connector is the smaller one.',
        'Recommending raspistill or the legacy stack for Module 3 because the tutorial used it.',
        'Asserting the Zero 2 or a different board to make the tutorial fit, when the prompt fixes the board.',
        'Answering as a shopping list or an installation walkthrough when the prompt asked for a compatibility verdict.',
      ],
      uncertainties: [],
      sources: [
        {
          url: 'https://www.raspberrypi.com/products/camera-module-3/',
          supports:
            'States that the supplied standard cable is not compatible with the smaller Zero connector, and that Module 3 features autofocus.',
        },
        {
          url: 'https://www.raspberrypi.com/documentation/accessories/camera.html',
          supports:
            'States compatibility with Raspberry Pi computers having CSI connectors, and specifies standard 15-pin versus mini 22-pin connectors.',
        },
        {
          url: 'https://www.raspberrypi.com/documentation/computers/camera_software.html',
          supports:
            'Limits legacy support to Modules 1/2 and HQ; names the Bookworm capture applications rpicam-*; describes autofocus-on-capture as running an autofocus cycle just before image capture.',
        },
      ],
      liveFacts: [],
      followUpDelta: {
        requiredFacts: [
          'No — under the added enclosure constraint the Camera Module 3 solution no longer meets all the requirements.',
          'The official mechanical documentation gives the reason: the changed sensor-module size and position make Module 3 incompatible with that camera lid, despite matching board dimensions and mounting-hole positions.',
          'What does not change: the electrical and software compatibility established in the initial answer remain true.',
        ],
        pitfalls: [
          'Inferring that some unverified fixed-focus replacement satisfies the autofocus requirement — it does not, and the substitution was never verified.',
          'Reversing the initial verdict wholesale, as though the cable or software conclusions had also been wrong.',
          'Answering yes from matching board dimensions and mounting holes alone, which are the facts that do match.',
        ],
        sources: [
          {
            url: 'https://www.raspberrypi.com/documentation/accessories/camera.html',
            supports:
              'The mechanical section stating Module 3 does not fit the official Raspberry Pi Zero Case camera lid intended for Module 2, while board dimensions and mounting-hole positions match.',
          },
        ],
      },
    },
    {
      huntId: 'historical-longitude-watch',
      version: 2,
      revisions: [RESEARCHED, GRADING_RULES],
      requiredFacts: [
        'The watch is H4.',
        'Catalogue ID ZAA0037.',
        'Catalogued creator: Harrison, John.',
        'Date 1759, with work having begun in 1755.',
        'Dial diameter 102 mm.',
        'The larger machine it superseded as Harrison’s promising approach is H3.',
        'The linked wooden carrying case is ZAA0037.1.',
        'The case holds H4 on the left and K1 on the right — so the other watch is K1.',
        'The case is not an original 1759 accessory.',
        'The catalogue date field says circa 1962.',
        'The description says the case was probably made in 1938, possibly with adaptations in the 1960s, its inner boxes almost certainly adapted from Hamilton Model 22 boxes (1942).',
      ],
      constraints: [
        'The catalogue ID is the wanted field, not the numerical identifier in the record’s URL.',
        'The dial diameter is the wanted measurement, not the object’s overall width.',
        'Do not grade trial-voyage details or current exhibition availability — neither was part of the verified task.',
        'Which watch is on which side must be stated, not merely that both are present.',
        ...SHARED_GRADING_RULES,
      ],
      pitfalls: [
        'Reporting the numeric URL identifier (for example the object number in the page address) as the catalogue ID.',
        'Reporting overall case or object width as the dial diameter.',
        'Naming H1 or H2 as the superseded larger machine.',
        'Collapsing the circa 1962 date field and the 1938 description into a single confident date.',
        'Asserting the case was made with the watch in 1759.',
      ],
      uncertainties: [
        'The case’s dating is genuinely unsettled: the structured date field and the description disagree, and the description itself hedges ("probably", "possibly", "almost certainly"). A correct Answer reports the tension and its qualifications rather than inventing a definitive chronology.',
      ],
      sources: [
        {
          url: 'https://www.rmg.co.uk/collections/objects/rmgc-object-79142',
          supports:
            'The watch record: catalogue ID, catalogued creator, date, dial diameter, the 1755 start and the Jefferys/H3 history, and the case linked as a part.',
        },
        {
          url: 'https://www.rmg.co.uk/collections/objects/rmgc-object-256323',
          supports:
            'The case record: its ID, "H4 on the left and K1 on the right", "probably made in 1938", "possibly also with adaptations in the 1960s", the Hamilton Model 22 inner boxes, and the circa 1962 date field.',
        },
      ],
      liveFacts: [],
    },
    {
      huntId: 'rule-eurostar-luggage',
      version: 2,
      revisions: [RESEARCHED, GRADING_RULES],
      requiredFacts: [
        'No — the complete load is not included in the ordinary Standard allowance.',
        'Standard permits two pieces of luggage plus one item of hand luggage; the load is three large items plus the daypack, which exceeds it.',
        'Both suitcases are within the general maximum length rule (85 cm on London routes) at 70 cm.',
        'A cased guitar is an explicit exception to the length threshold: guitars may travel on routes to and from London despite exceeding 85 cm, provided the guitar is in a case.',
        'The guitar nonetheless travels as part of the luggage allowance — it consumes a slot and is not a free extra item.',
        'The smallest reduction that makes the load fit is removing one suitcase, which keeps the guitar.',
        'Removing the guitar instead would also bring the count within the allowance.',
        'Removing only the daypack does not fix it, because the daypack is the hand-luggage item rather than one of the two pieces.',
      ],
      constraints: [
        'The guitar rule and the medium-instrument rule are different rules and must be distinguished, as the prompt asks.',
        'Grade the allowance arithmetic and the guitar exception separately; getting the exception right while miscounting the allowance is not success.',
        'Equivalent official pages stating the same allowance are acceptable sources.',
        ...SHARED_GRADING_RULES,
      ],
      pitfalls: [
        'Applying the generic 85–136 cm medium-instrument seat/service arrangements to this guitar and concluding it needs its own seat or a booked service.',
        'Concluding the guitar is simply banned for exceeding 85 cm, having read only the general luggage page.',
        'Treating the cased guitar as a free extra that does not consume an allowance slot, and so concluding the whole load fits.',
        'Guaranteeing boarding, or asserting what staff will do at the gate — the published allowance is what was verified.',
        'Naming the daypack as the smallest removal.',
      ],
      uncertainties: [
        'The published allowance is what was verified; it is not a guarantee of what happens at the gate on any given day.',
      ],
      sources: [
        {
          url: 'https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage',
          supports:
            'Standard: two pieces plus hand luggage. London maximum general length 85 cm. Premier: three pieces plus hand luggage.',
        },
        {
          url: 'https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments',
          supports:
            '"Musical instruments smaller than 85 cm long and guitars can travel with you as part of your luggage allowance on routes to and from London. Guitars must be in a case." Separately describes medium instruments of 85–136 cm and their arrangements.',
        },
      ],
      liveFacts: [
        'The Standard allowance of two pieces plus hand luggage.',
        'The Premier allowance of three pieces plus hand luggage.',
        'The 85 cm general maximum length on London routes.',
        'The guitar exception and its in-a-case condition.',
        'Everything in this key is current published policy and must be rechecked against both sources before a measured pass. A changed rule is a key revision with provenance — never a failed Answer.',
      ],
      followUpDelta: {
        requiredFacts: [
          'No — under Premier no suitcase has to be left behind.',
          'Premier permits three pieces plus hand luggage, which accommodates the two suitcases, the cased guitar, and the daypack.',
          'Only the allowance arithmetic changes: the route and the guitar exception are unaffected by the fare class.',
        ],
        pitfalls: [
          'Re-deriving or re-litigating the guitar exception as though the fare class could change it.',
          'Silently dropping an item from the original load, or changing the route, when the prompt fixed both.',
          'Carrying the Standard count forward and answering yes.',
        ],
        sources: [
          {
            url: 'https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage',
            supports: 'Premier: three pieces of luggage plus one item of hand luggage.',
          },
        ],
      },
    },
    {
      huntId: 'superseded-voyager-interstellar',
      version: 2,
      revisions: [RESEARCHED, GRADING_RULES],
      requiredFacts: [
        'The JPL account was published June 27, 2013.',
        'The NASA announcement was published September 12, 2013.',
        'The crossing date eventually accepted by the team is August 25, 2012 — before both announcements.',
        'The missing sign behind the June conclusion: the expected abrupt change in magnetic-field direction had not been seen, despite the particle evidence.',
        'The later conclusion rested on plasma density inferred from plasma-wave oscillations — not on a newly observed magnetic-field reversal.',
        'A March 2012 coronal mass ejection reached the spacecraft about 13 months later.',
        'The decisive observation: oscillations observed April 9, 2013, consistent with plasma more than 40 times denser than the outer heliosphere.',
        'The re-examined earlier observations: fainter oscillations from October and November 2012, whose extrapolated densities supported an August 2012 arrival.',
        'Why it was not a crossing between the announcements: the accepted crossing predates both, so the change was in the measurement and its interpretation, not in the spacecraft’s position.',
      ],
      constraints: [
        'Crossing date, observation date, and announcement dates are three different things and must stay separate.',
        'Use the explicit release dates, not a site migration or "last updated" footer.',
        'Grade the causal reconciliation against both official accounts; a correct pair of dates with no mechanism is not success.',
        ...SHARED_GRADING_RULES,
      ],
      pitfalls: [
        'Answering from a remembered date without the two accounts.',
        'Claiming the later announcement reported the long-awaited magnetic-field reversal.',
        'Placing the crossing between June and September 2013.',
        'Claiming Voyager 1 left the entire solar system, rather than the heliosphere.',
        'Citing only a modern summary when the prompt asked for both official accounts.',
      ],
      uncertainties: [
        'The August 25, 2012 date is a retrospective determination extrapolated from density measurements, not a directly observed moment. An Answer that presents it as settled-by-inference is correct; one that presents it as directly observed at the time is not.',
      ],
      sources: [
        {
          url: 'https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/',
          supports:
            'The June 27 account: "Scientists have not yet seen the third sign, an abrupt change in the direction of the magnetic field" and "the team feels Voyager 1 has not yet gotten there".',
        },
        {
          url: 'https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-into-interstellar-space/',
          supports:
            'The September 12 announcement: April 9 observations, plasma more than 40 times denser, the October/November 2012 oscillations, and August 25, 2012 accepted as the arrival date.',
        },
      ],
      liveFacts: [],
    },
  ]
}

/** The key for this hunt, or `undefined`. */
export function gradingKeyFor(huntId: string, keys: readonly GradingKey[] = gradingKeys()): GradingKey | undefined {
  return keys.find((key) => key.huntId === huntId)
}

// ---------------------------------------------------------------------------
// The public face of a key (#226)
//
// A grade binds itself to the key it was applied under by `keyVersion` and
// `keyDigest`, so a key edited after an Answer was graded no longer matches
// the grade claiming it. That binding is only worth anything because the keys
// above are COMMITTED: an edit shows up in history and breaks a recorded
// digest. A key nobody can diff is a key nobody can be held to — which is why
// this study keeps its keys in the repository rather than an ignored
// directory. Privacy is not the thing at stake: the measured assistant is a
// browser agent with no repo access, and corpus.test.ts walks the import graph
// to prove nothing on the capture path loads this module.
//
// The dependency points this way on purpose. `grades.ts` stays generic over
// arbitrary task ids and never imports this corpus; it treats `keyRef` as
// opaque. So the corpus knows how to describe itself to the grader, and the
// grader knows nothing about the corpus.
// ---------------------------------------------------------------------------

/** Where a reviewer finds the substantive key. Never its content. */
const KEY_MODULE = 'e2e/live/keys.ts'

/**
 * A digest of the key's content that does not depend on how its JSON happened
 * to be written: object keys sorted, `undefined` dropped. Two keys that say
 * the same thing agree, and any change to what a key requires, forbids or
 * rests on changes the digest.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([name, field]) => `${JSON.stringify(name)}:${canonicalJson(field)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const numbered = (index: number): string => String(index + 1).padStart(2, '0')

/**
 * The checks a reviewer judges one by one, derived from the key's own
 * sentences rather than minted as opaque ids — someone reading `fact-03` in a
 * grade can find exactly which sentence it refers to.
 *
 * Three of the key's prose fields become checks, because each is a yes/no
 * question about the Answer in front of the reviewer: a required fact is
 * present or it is not, a pitfall was walked into or it was not, an
 * uncertainty survived or it did not. `constraints` deliberately does not —
 * it tells the reviewer HOW to grade ("grade cable, hardware and software
 * separately"), which is not a claim an Answer can satisfy or fail.
 */
function checksOf(key: {
  requiredFacts: readonly string[]
  pitfalls: readonly string[]
  uncertainties?: readonly string[]
}): LiveKeyCheck[] {
  return [
    ...key.requiredFacts.map((description, index) => ({ checkId: `fact-${numbered(index)}`, description })),
    ...key.pitfalls.map((description, index) => ({
      checkId: `pitfall-${numbered(index)}`,
      description: `The Answer avoids: ${description}`,
    })),
    ...(key.uncertainties ?? []).map((description, index) => ({
      checkId: `uncertainty-${numbered(index)}`,
      description: `The Answer preserves: ${description}`,
    })),
  ]
}

/**
 * Describe one hunt's key to the grader: which key, at what version, and what
 * it requires of each step — never the conclusions themselves. A hunt with a
 * follow-up describes both steps, because the follow-up is graded against its
 * own delta and its own prompt version.
 */
export function keyManifestOf(huntId: string): LiveKeyManifest {
  const key = gradingKeyFor(huntId)
  const hunt = liveWebHunts().find((candidate) => candidate.id === huntId)
  if (!key || !hunt) {
    throw new Error(`"${huntId}" is not an approved live-web hunt, so it has no grading key`)
  }

  const tasks: LiveKeyTask[] = [
    {
      huntId,
      stepId: 'initial',
      promptVersion: String(hunt.prompt.version),
      keyRef: `${KEY_MODULE}#${huntId}`,
      checks: checksOf(key),
      referenceSources: key.sources.map((source) => source.url),
    },
  ]

  if (hunt.followUp && key.followUpDelta) {
    tasks.push({
      huntId,
      stepId: 'follow_up',
      promptVersion: String(hunt.followUp.version),
      keyRef: `${KEY_MODULE}#${huntId}.followUpDelta`,
      checks: checksOf(key.followUpDelta),
      referenceSources: key.followUpDelta.sources.map((source) => source.url),
    })
  }

  return {
    kind: LIVE_KEY_MANIFEST_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    keyVersion: String(key.version),
    keyDigest: digestOf(canonicalJson(key)),
    // The key's own newest revision date — when the key was last prepared,
    // never when this manifest happened to be generated.
    preparedAt: key.revisions[key.revisions.length - 1].date,
    tasks,
  }
}
