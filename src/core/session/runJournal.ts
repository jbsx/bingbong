import type { RunId } from './sessionIdentity'

export const MAX_RUN_NOTE_CHARS = 1_200

export interface RunJournalEntry {
  readonly runId: RunId
  readonly outcome: 'done' | 'failed' | 'cancelled'
  readonly text: string
}

export type RunJournalSnapshot = readonly Readonly<RunJournalEntry>[]
