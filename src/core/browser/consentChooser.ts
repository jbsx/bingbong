import type { AskRecord } from '../decision/askRecord'
import { choiceProbability, type DecisionChoiceQuestion, type DecisionModel } from '../ports/decisionModel'
import { reportFault } from '../trace/fault'
import { costsAWayThrough, isAcceptStyle, type ConsentChooser } from './dialogPolicy'

// The consent wall's reject, found by Jev (owner's rule 2026-10-19: the
// widest net, no label list deciding alone). Jev is asked which control
// declines, over every control of the wall that neither accepts nor is a
// way through that costs, so a "Continue without accepting" or a "Refuse"
// the rule never listed is found. Its sure pick ranks first (ADR 0089);
// the privacy-first rule's reject (ADR 0061) is the fallback under the
// bar, and the accept after it.

/** The question asked over a consent wall's controls: which one declines, or none. Null when every control accepts. */
export function consentQuestion(dialogText: string, controlLabels: readonly string[]): { state: string; questions: { decline: DecisionChoiceQuestion } } | null {
  const offered = controlLabels.flatMap((label, index) => (isAcceptStyle(label) || costsAWayThrough(label) || label.trim() === '' ? [] : [[`c-${index}`, JSON.stringify(label)] as const]))
  if (offered.length === 0) return null
  return {
    state: [`A cookie consent notice covers a web page: ${JSON.stringify(dialogText)}`, 'Its controls:', ...controlLabels.map((label, index) => `[c-${index}] ${JSON.stringify(label)}`)].join('\n'),
    questions: {
      decline: {
        type: 'choice',
        instructions:
          'Which control declines the optional cookies and closes the notice: reject, decline, refuse, continue without accepting, necessary or essential only, save without the optional ones? Never one that opens settings, manages preferences or learns more. Choose none when no control declines.',
        options: { none: 'no control declines the optional cookies', ...Object.fromEntries(offered) },
      },
    },
  }
}

/** Where a consent ask is written once its answer is in (#338's sidecar): every Jev call's whole ask, this one's too. */
export interface ConsentAskLog {
  readonly write: (record: AskRecord) => void
  readonly now?: () => number
}

/** A {@link ConsentChooser} over the Decision Model: the control Jev is sure declines, else null. */
export function createConsentChooser(model: () => DecisionModel | null, sureAbove: number, askLog?: ConsentAskLog): ConsentChooser {
  let asked = 0
  return async (dialogText, controlLabels) => {
    const jev = model()
    if (jev === null) return null
    const ask = consentQuestion(dialogText, controlLabels)
    if (ask === null) return null
    const askedAt = (askLog?.now ?? Date.now)()
    const result = await jev.ask(ask)
    try {
      // No turn owns a consent wall: the ask carries its own id, as a partial's does.
      askLog?.write({ type: 'ask', id: `consent-${askedAt.toString(36)}-${(asked += 1)}`, at: askedAt, kind: 'consent', model: jev.model, state: ask.state, questions: ask.questions })
    } catch (error) {
      reportFault('browser.consentChooser.askLog', error)
    }
    if (result.status !== 'answered') return null
    const { choice } = result.answers.decline
    const match = /^c-(\d+)$/.exec(choice)
    if (match === null || choiceProbability(result.answers.decline) < sureAbove) return null
    const index = Number(match[1])
    const label = controlLabels[index]
    return label === undefined || isAcceptStyle(label) || costsAWayThrough(label) ? null : index
  }
}
