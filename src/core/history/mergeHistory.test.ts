import { describe, expect, it } from 'vitest'
import { filterHydratedDuplicates } from './mergeHistory'
import type { RecordedEntry, TranscriptEvent } from './historyStore'

describe('filterHydratedDuplicates', () => {
  it('removes a live event already present in the hydrated snapshot', () => {
    const recorded: RecordedEntry[] = [
      { id: 1, runId: 1, kind: 'command', text: 'open it', at: 100 },
    ]
    const live: TranscriptEvent[] = [
      { kind: 'command', text: 'open it', at: 100 },
      { kind: 'speak', text: 'Opened it.', at: 101 },
    ]

    expect(filterHydratedDuplicates(recorded, live)).toEqual([
      { kind: 'speak', text: 'Opened it.', at: 101 },
    ])
  })

  it('keeps a later identical command because its timestamp differs', () => {
    const recorded: RecordedEntry[] = [
      { id: 1, runId: 1, kind: 'command', text: 'open it', at: 100 },
    ]
    const live: TranscriptEvent[] = [
      { kind: 'command', text: 'open it', at: 200 },
    ]

    expect(filterHydratedDuplicates(recorded, live)).toEqual(live)
  })

  it('consumes duplicate matches one-for-one', () => {
    const recorded: RecordedEntry[] = [
      { id: 1, runId: 1, kind: 'error', text: 'offline', at: 100 },
    ]
    const live: TranscriptEvent[] = [
      { kind: 'error', text: 'offline', at: 100 },
      { kind: 'error', text: 'offline', at: 100 },
    ]

    expect(filterHydratedDuplicates(recorded, live)).toEqual([
      { kind: 'error', text: 'offline', at: 100 },
    ])
  })
})
