import type { FixtureServer } from '../fixtureServer'
import type { ScenarioMetrics } from './metrics'

// The real-model corpus — #109's six behavior classes grown to the #130
// production-weighted corpus. Direct Actions and simple Lookups dominate
// real traced turns, so they dominate the corpus (≥10 each — the classes
// the release gates judge as percentages); every remaining class #108's
// Testing Decisions list names is present at least once: multi-source
// Investigations, contradictions, Blockers, unanswered questions, repeated
// or near-identical pages, Steering, Subagent work, cancelled work with
// checkpointed evidence, stale evidence, and deliberately unresolvable
// requests. Commands are typed through the Prompt Bar like a user's;
// success is judged on external outcomes only (final pane state, delivered
// answer, pipeline outcome), never on model prose matching a template. The
// fixture web is fully deterministic, so model decisions are the only
// variable under test.
//
// The corpus runs as ONE session in evaluator order: later scenarios may
// legitimately reuse earlier Session Evidence — that is production shape
// (#108 story 26), and the order below is deliberate where it matters
// (the unanswered-questions scenario runs before anything introduces depot
// bulletins; the stale-evidence board is touched by nothing earlier).

export type ScenarioKind =
  | 'direct-action'
  | 'lookup'
  | 'candidate'
  | 'investigation'
  | 'contradiction'
  | 'blocker'
  | 'unresolvable'
  | 'unanswered'
  | 'near-identical'
  | 'steering'
  | 'subagent'
  | 'cancelled-evidence'
  | 'stale-evidence'

/** Objective pane state beyond URL/heading — the fixed probe the evaluator collects after each scenario. */
export interface PaneState {
  title: string
  scrollY: number
  dialogPresent: boolean
  agreeChecked: boolean | null
  pressedKeys: { key: string; shift: boolean }[] | null
}

/** One executed command's record — a scenario with a follow-up contributes two. */
export interface RunObservation {
  metrics: ScenarioMetrics
}

/** What a predicate may look at: objective end state plus every run's own record. */
export interface ScenarioObservation {
  paneUrl: string | undefined
  paneHeading: string | null
  paneState: PaneState | null
  answerText: string | null
  outcome: ScenarioMetrics['outcome']
  rawLimitFailure: string | null
  timedOut: boolean
  /** Every executed command of the scenario, in order — the last is the follow-up when one exists. */
  runs: readonly RunObservation[]
}

export interface EvalScenario {
  id: string
  kind: ScenarioKind
  /** The typed command; fixture URLs are embedded so the model never has to guess where the fixture web lives. */
  command: (fixture: FixtureServer) => string
  /**
   * A mid-run Steering directive (#130's Steering class): submitted through
   * the steer seam once the first run has started real work, exactly like a
   * user correcting the assistant mid-flight.
   */
  steer?: (fixture: FixtureServer) => string
  /**
   * The cancelled-work class: abort the first run once it checkpointed (or,
   * on a path without checkpoints, visited) the marker URL — then judge the
   * follow-up, which must succeed without repeating the cancelled browsing.
   */
  cancel?: { urlMarker: string }
  /** An optional second command in the same Session, with a fixture mutation hook before it (stale evidence). */
  followUp?: {
    prepare?: (fixture: FixtureServer) => void
    command: (fixture: FixtureServer) => string
  }
  /** Objective success — one boolean, no partial credit. */
  success: (observation: ScenarioObservation, fixture: FixtureServer) => boolean
}

/** Graceful-stop standard for the scenarios whose hazard is not stopping: an honest answer, no raw-limit error. */
function answeredWithoutRawLimit(observation: ScenarioObservation): boolean {
  return observation.outcome === 'done' && observation.answerText !== null && observation.rawLimitFailure === null
}

/** An honest answer whose text mentions the phrase (case-insensitive). */
function answerMentions(observation: ScenarioObservation, phrase: string): boolean {
  return answeredWithoutRawLimit(observation) && observation.answerText!.toLowerCase().includes(phrase)
}

/** True when any of the scenario's runs asked the user and the ask timed out unanswered. */
function askedAndWaitedOut(observation: ScenarioObservation): boolean {
  return observation.runs.some((run) => run.metrics.askTimedOut)
}

/** The last run's record — the follow-up when one exists, the run itself otherwise. */
function finalRun(observation: ScenarioObservation): RunObservation {
  return observation.runs[observation.runs.length - 1]!
}

/** True when the final run executed an action touching the marker URL (repeated browsing). */
function finalRunRetouched(observation: ScenarioObservation, urlMarker: string): boolean {
  return finalRun(observation).metrics.actions.some(
    (action) => action.ok && JSON.stringify(action.args).includes(urlMarker),
  )
}

/** Every executed command finished done with no raw-limit error. */
function allRunsDone(observation: ScenarioObservation): boolean {
  return (
    observation.runs.length > 0 &&
    observation.runs.every((run) => run.metrics.outcome === 'done' && run.metrics.rawLimitFailure === null)
  )
}

export function evalScenarios(): EvalScenario[] {
  return [
    // ---- Direct Actions (the production majority; the ≥95% gate's class) ----
    {
      id: 'direct-action-open-page',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/second')} in the browser`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/second') && observation.outcome === 'done',
    },
    {
      id: 'direct-action-open-article',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/widgets-article')} in the browser`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/widgets-article') && observation.outcome === 'done',
    },
    {
      id: 'direct-action-open-alt-host',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.altUrl('/widget-review')} in the browser`,
      success: (observation, fixture) => observation.paneUrl === fixture.altUrl('/widget-review') && observation.outcome === 'done',
    },
    {
      id: 'direct-action-open-results',
      kind: 'direct-action',
      command: (fixture) => `open the fixture web results for widgets at ${fixture.url('/results?q=widgets')} in the browser`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/results?q=widgets') && observation.outcome === 'done',
    },
    {
      id: 'direct-action-click-button',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/interactive')} and click the Say hello button`,
      success: (observation) => observation.paneState?.title === 'clicked:btn-hello' && observation.outcome === 'done',
    },
    {
      id: 'direct-action-check-checkbox',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/interactive')} and tick the Agree checkbox`,
      success: (observation) => observation.paneState?.agreeChecked === true && observation.outcome === 'done',
    },
    {
      // Click-through navigation — the production-shaped "open X and click
      // the link to Y". (A native <select> option-pick scenario lived here
      // briefly: synthetic clicks into Chromium's select popup flake, which
      // is controller coverage to prove deterministically, not a coin-flip
      // sample inside a 95% gate.)
      id: 'direct-action-click-link',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/native-dialog')} and click the Leave page link`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/second') && observation.outcome === 'done',
    },
    {
      id: 'direct-action-type-submit',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/site-search')} and submit a search for widgets`,
      success: (observation) => observation.paneState?.title === 'submitted:sitesearch' && observation.outcome === 'done',
    },
    {
      id: 'direct-action-dismiss-dialog',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/dialog-wall')} and dismiss the sign-in wall with Not now`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/dialog-wall') &&
        observation.paneState?.dialogPresent === false &&
        observation.outcome === 'done',
    },
    {
      // Production-shaped scrolling (a couple of screens), not a race to a
      // 3000px floor: the tall fixture needs ~9 scroll steps, structurally
      // beyond the 6-round Direct Action budget — a corpus must be
      // completable by design-conformant behavior, not measure the honest
      // partial that budgets exist to produce.
      id: 'direct-action-scroll-down',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/interactive')} and scroll down a few screens`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/interactive') &&
        (observation.paneState?.scrollY ?? 0) >= 500 &&
        observation.outcome === 'done',
    },
    {
      id: 'direct-action-media-pause',
      kind: 'direct-action',
      command: (fixture) => `toggle playback of the video on ${fixture.url('/media')}`,
      success: (observation) =>
        (observation.paneState?.pressedKeys ?? []).some((key) => key.key === 'k') && observation.outcome === 'done',
    },

    // ---- Unanswered questions (before anything introduces depot bulletins) ----
    {
      id: 'unanswered-earlier-bulletin',
      kind: 'unanswered',
      command: () => 'open the depot bulletin I mentioned earlier and show me what it says',
      // Honest when the assistant asked (and waited out the ask) or plainly
      // stated it lacks the context — NOT when it silently guessed a page
      // the user never identified.
      success: (observation, fixture) =>
        answeredWithoutRawLimit(observation) &&
        (askedAndWaitedOut(observation) ||
          observation.paneUrl !== fixture.url('/mirror-alpha')) &&
        observation.paneUrl !== fixture.url('/mirror-gamma'),
    },

    // ---- Lookups (open-web and known-page; the ≥90% gate's class, with candidates below) ----
    {
      id: 'lookup-widgets-guide',
      kind: 'lookup',
      command: () => 'search the fixture web for widgets and open the complete guide',
      success: (observation, fixture) => observation.paneUrl === fixture.url('/widgets-article') && observation.outcome === 'done',
    },
    {
      id: 'lookup-open-web-answer',
      kind: 'lookup',
      command: () => 'search the fixture web for fixture widgets and tell me the title of the complete guide',
      success: (observation) => answerMentions(observation, 'fixture widgets'),
    },
    {
      id: 'lookup-open-web-review',
      kind: 'lookup',
      command: () => 'search the fixture web for the independent widget review and tell me the weight it measured',
      success: (observation) => answerMentions(observation, '4.2'),
    },
    {
      id: 'lookup-known-page-weight',
      kind: 'lookup',
      command: (fixture) => `open ${fixture.url('/widget-specs')} and tell me the official weight of the standard widget`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/widget-specs') && answerMentions(observation, '3.8'),
    },
    {
      id: 'lookup-known-page-care',
      kind: 'lookup',
      command: (fixture) => `open ${fixture.url('/widget-care')} and tell me how often standard widgets need cleaning`,
      success: (observation) => answerMentions(observation, '6 months'),
    },
    {
      id: 'lookup-depot-bulletin',
      kind: 'lookup',
      command: () => 'search the fixture web for the depot bulletin and open it',
      success: (observation, fixture) => observation.paneUrl === fixture.url('/mirror-alpha') && observation.outcome === 'done',
    },

    // ---- Ambiguous Candidate identification ----
    {
      id: 'candidate-polished-widgets',
      kind: 'candidate',
      command: (fixture) =>
        `starting from the fixture catalog at ${fixture.url('/catalog')}, open the page about polished widgets`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/widgets-polished') && observation.outcome === 'done',
    },
    {
      id: 'candidate-vintage-synonym',
      kind: 'candidate',
      command: (fixture) =>
        `starting from the fixture catalog at ${fixture.url('/catalog')}, open the guide about collectible widgets`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/widgets-vintage') && observation.outcome === 'done',
    },
    {
      id: 'candidate-anodized-synonym',
      kind: 'candidate',
      command: (fixture) =>
        `starting from the fixture catalog at ${fixture.url('/catalog')}, open the guide about the dull durable industrial finish`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/widgets-anodized') && observation.outcome === 'done',
    },
    {
      id: 'candidate-search-polished',
      kind: 'candidate',
      command: () => 'search the fixture web for widget guides and open the one about polished widgets',
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/widgets-polished') && observation.outcome === 'done',
    },

    // ---- Multi-source Investigation and contradictions ----
    {
      id: 'investigation-material-finish',
      kind: 'investigation',
      command: (fixture) =>
        `the standard fixture widget's build is documented in two places: the material sheet at ${fixture.url('/widget-material')} and the finish sheet at ${fixture.url('/widget-finish')}. read both and tell me the material and the finish`,
      success: (observation) => answerMentions(observation, 'titanium') && answerMentions(observation, 'matte'),
    },
    {
      id: 'contradiction-widget-weight',
      kind: 'contradiction',
      command: (fixture) =>
        `the weight of the standard fixture widget is disputed. read the spec sheet at ${fixture.url('/widget-specs')} and the independent review at ${fixture.altUrl('/widget-review')}, then tell me both weights`,
      // The only honest answer carries both sources' numbers; the disagreement is the point.
      success: (observation) =>
        observation.answerText !== null &&
        observation.answerText.includes('3.8') &&
        observation.answerText.includes('4.2') &&
        observation.outcome === 'done',
    },

    // ---- Subagent work: three independent facts across two hosts — the shape parallel delegation exists for ----
    {
      id: 'subagent-widget-facts',
      kind: 'subagent',
      command: (fixture) =>
        `gather three facts about the standard fixture widget: the material from ${fixture.url('/widget-material')}, the finish from ${fixture.url('/widget-finish')}, and the care schedule from ${fixture.altUrl('/widget-care')}. tell me all three`,
      success: (observation) =>
        answerMentions(observation, 'titanium') &&
        answerMentions(observation, 'matte') &&
        answerMentions(observation, '6 months'),
    },

    // ---- Steering mid-run ----
    {
      id: 'steering-correct-objective',
      kind: 'steering',
      command: (fixture) => `open the fixture widgets article at ${fixture.url('/widgets-article')} in the browser`,
      steer: (fixture) => `actually, open the fixture catalog at ${fixture.url('/catalog')} instead`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/catalog') && observation.outcome === 'done',
    },

    // ---- Cancelled work with checkpointed evidence ----
    {
      id: 'cancelled-warranty-reuse',
      kind: 'cancelled-evidence',
      command: (fixture) => `read the warranty page at ${fixture.url('/widget-warranty')} and tell me how long the warranty lasts`,
      cancel: { urlMarker: '/widget-warranty' },
      followUp: {
        command: () => 'how long did that widget warranty last again?',
      },
      // The cancelled run must land as cancelled; the follow-up must answer
      // from retained Session Evidence — done, correct, and without
      // re-executing any browsing of the page it already read.
      success: (observation) =>
        observation.runs[0]?.metrics.outcome === 'cancelled' &&
        answerMentions(observation, '5 year') &&
        !finalRunRetouched(observation, '/widget-warranty'),
    },

    // ---- Stale evidence: the board flips between runs; reuse without revalidation is now wrong ----
    {
      id: 'stale-status-board',
      kind: 'stale-evidence',
      command: (fixture) => `open the status board at ${fixture.url('/status-board')} and tell me which way the wind gauge reads`,
      followUp: {
        prepare: (fixture) => fixture.setStatusBoard('south'),
        command: () => 'check the status board again — which way does the wind gauge read now?',
      },
      success: (observation) =>
        allRunsDone(observation) &&
        (observation.runs[0]!.metrics.answerText ?? '').toLowerCase().includes('north') &&
        (observation.answerText ?? '').toLowerCase().includes('south'),
    },

    // ---- Near-identical pages: two true duplicates and one that differs by a token ----
    {
      id: 'near-identical-depot-bulletins',
      kind: 'near-identical',
      command: (fixture) =>
        `three fixture pages look nearly identical: ${fixture.url('/mirror-alpha')}, ${fixture.url('/mirror-beta')}, and ${fixture.url('/mirror-gamma')}. open the one that says orders ship on Friday`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/mirror-gamma') && observation.outcome === 'done',
    },

    // ---- Blockers and deliberately unresolvable requests ----
    {
      id: 'blocker-challenge-page',
      kind: 'blocker',
      command: (fixture) => `open ${fixture.url('/challenge')} and tell me what the page says`,
      success: answeredWithoutRawLimit,
    },
    {
      id: 'unresolvable-mercury-dampeners',
      kind: 'unresolvable',
      command: () => 'search the fixture web for mercury dampeners and tell me which page explains them',
      success: answeredWithoutRawLimit,
    },
  ]
}
