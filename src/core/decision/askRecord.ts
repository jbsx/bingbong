import type { DecisionQuestions } from '../ports/decisionModel'

// What Jev was asked (#338): every Decision Model call's full ask — the
// state text and the questions with their options — one JSON line in
// asks-*.jsonl beside the decision log, so the decision log stays small
// and any misread can be replayed against a reworded ask. A decision
// record names its ask by id; the corpus of replayable cases is grown
// from these (`pnpm jev:candidates`, `pnpm jev:case`).

/** Which call asked: hop 0's reading, the Where Ask after a hop 0 that read none (#379), the Mark Ask after a Where Ask that read none (#382), a later hop of a Task, an Early Fire partial, or a consent wall's decline. */
export type AskKind = 'command' | 'where' | 'mark' | 'hop' | 'partial' | 'consent'

/** The file an ask's image is saved as (#382, ADR 0084): its ask's id, and the image's place among the ask's after the first. */
export function askImageFile(askId: string, index: number): string {
  return `${askId}${index === 0 ? '' : `-${index}`}.jpg`
}

export interface AskRecord {
  readonly type: 'ask'
  /** The ask's id, which a decision record names: the turn's id for a Command or a hop; a partial's own, since it is asked before its turn exists. */
  readonly id: string
  /** The turn the ask was made for; absent on a partial. */
  readonly turnId?: string
  /** Wall-clock epoch ms when it was asked. */
  readonly at: number
  readonly kind: AskKind
  /** The model id the ask was addressed to. */
  readonly model: string
  readonly state: string
  readonly questions: DecisionQuestions
  /** The images the state names (#382: the Mark Ask's), by reference: each the file saved beside the sidecar, relative to the logs dir; absent on a text ask. */
  readonly images?: Readonly<Record<string, string>>
}
