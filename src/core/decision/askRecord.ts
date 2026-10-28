import type { CardCut } from './cardBudget'
import type { DecisionAttempt, DecisionQuestions } from '../ports/decisionModel'

// What Jev was asked (#338): every Decision Model call's full ask — the
// state text and the questions with their options — one JSON line in
// asks-*.jsonl beside the decision log, so the decision log stays small
// and any misread can be replayed against a reworded ask. A decision
// record names its ask by id; the corpus of replayable cases is grown
// from these (`pnpm jev:candidates`, `pnpm jev:case`).

/** Which call asked: the Appliance Card, read first on every line the Local Match cannot settle (#485); hop 0's reading on the page card, the Where Ask after a hop 0 that read none (#379), the Mark Ask after a Where Ask that read none (#382), a later hop of a Task, or a consent wall's decline; `site` reads the user's answer to a Site Question (#423); `shelf` asks which file on the Shelf an upload sets (#424). `partial`, an Early Fire partial's, was written before #477 only: no partial is asked now, and the old logs still carry it. */
export type AskKind = 'appliance' | 'command' | 'where' | 'mark' | 'hop' | 'partial' | 'consent' | 'setting' | 'site' | 'shelf'

/** The file an ask's image is saved as (#382, ADR 0084): its ask's id, and the image's place among the ask's after the first. */
export function askImageFile(askId: string, index: number): string {
  return `${askId}${index === 0 ? '' : `-${index}`}.jpg`
}

export interface AskRecord {
  readonly type: 'ask'
  /** The ask's id, which a decision record names: the turn's id for a Command or a hop; a partial's own (before #477), since it was asked before its turn existed. */
  readonly id: string
  /** The turn the ask was made for; absent on a partial (before #477). */
  readonly turnId?: string
  /** Wall-clock epoch ms when it was asked. */
  readonly at: number
  readonly kind: AskKind
  /** The model id the ask was addressed to: the live host's. */
  readonly model: string
  /** The model that answered (#477): a Fallback Host's when the live one failed; absent when none did. */
  readonly answeredBy?: string
  /** Every host's try at the ask, in order (#477); absent from a model that knows one host, and in logs before it. */
  readonly attempts?: readonly DecisionAttempt[]
  readonly state: string
  readonly questions: DecisionQuestions
  /** The images the state names (#382: the Mark Ask's), by reference: each the file saved beside the sidecar, relative to the logs dir; absent on a text ask. */
  readonly images?: Readonly<Record<string, string>>
  /** What the card gave up to fit the Card Budget (#495), each kind and how many; absent when nothing was cut. */
  readonly cuts?: readonly CardCut[]
  /** The Card Budget it was built to, in characters (#495), on an ask that cut anything. */
  readonly budget?: number
  /** Over the budget after every cut (#495): the ask was not sent. */
  readonly unsent?: true
  /** The ask the host refused for its size that this one retries at a tighter budget (#495): its count and limit. */
  readonly retryOf?: { readonly id: string; readonly tokens: number; readonly maxLen: number }
}
