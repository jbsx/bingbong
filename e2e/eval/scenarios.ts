import type { FixtureServer } from '../fixtureServer'
import type { ScenarioMetrics } from './metrics'

// The #109 real-model corpus — one scenario per behavior class the #108
// baseline must cover (Direct Action, Lookup, ambiguous Candidate,
// Investigation, Blocker, deliberately unresolvable). Commands are typed
// through the Prompt Bar like a user's; success is judged on external
// outcomes only (final pane state, delivered answer, pipeline outcome),
// never on model prose matching a template. The fixture web is fully
// deterministic, so model decisions are the only variable under test.

export type ScenarioKind = 'direct-action' | 'lookup' | 'candidate' | 'investigation' | 'blocker' | 'unresolvable'

/** What a predicate may look at: objective end state plus the run's own record. */
export interface ScenarioObservation {
  paneUrl: string | undefined
  paneHeading: string | null
  answerText: string | null
  outcome: ScenarioMetrics['outcome']
  rawLimitFailure: string | null
  timedOut: boolean
}

export interface EvalScenario {
  id: string
  kind: ScenarioKind
  /** The typed command; fixture URLs are embedded so the model never has to guess where the fixture web lives. */
  command: (fixture: FixtureServer) => string
  /** Objective success — one boolean, no partial credit. */
  success: (observation: ScenarioObservation, fixture: FixtureServer) => boolean
}

/** Graceful-stop standard for the scenarios whose hazard is not stopping: an honest answer, no raw-limit error. */
function answeredWithoutRawLimit(observation: ScenarioObservation): boolean {
  return observation.outcome === 'done' && observation.answerText !== null && observation.rawLimitFailure === null
}

export function evalScenarios(): EvalScenario[] {
  return [
    {
      id: 'direct-action-open-page',
      kind: 'direct-action',
      command: (fixture) => `open ${fixture.url('/second')} in the browser`,
      success: (observation, fixture) => observation.paneUrl === fixture.url('/second') && observation.outcome === 'done',
    },
    {
      id: 'lookup-widgets-guide',
      kind: 'lookup',
      command: () => 'search the fixture web for widgets and open the complete guide',
      success: (observation, fixture) => observation.paneUrl === fixture.url('/widgets-article') && observation.outcome === 'done',
    },
    {
      id: 'candidate-polished-widgets',
      kind: 'candidate',
      command: (fixture) =>
        `starting from the fixture catalog at ${fixture.url('/catalog')}, open the page about polished widgets`,
      success: (observation, fixture) =>
        observation.paneUrl === fixture.url('/widgets-polished') && observation.outcome === 'done',
    },
    {
      id: 'investigation-widget-weight',
      kind: 'investigation',
      command: (fixture) =>
        `the weight of the standard fixture widget is disputed. read the spec sheet at ${fixture.url('/widget-specs')} and the independent review at ${fixture.altUrl('/widget-review')}, then tell me both weights`,
      // The only honest answer carries both sources' numbers; the disagreement is the point.
      success: (observation) =>
        observation.answerText !== null &&
        observation.answerText.includes('3.8') &&
        observation.answerText.includes('4.2') &&
        observation.outcome === 'done',
    },
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
