import { afterEach, describe, expect, it } from 'vitest'
import {
  offLanguageAnswerEvent,
  offLanguageAnswerFaultMessage,
  OFF_LANGUAGE_FAULT_HEAD_CHARS,
  recordOffLanguageAnswer,
  type TracedOffLanguageAnswer,
} from './offLanguageAnswerTrace'
import { setFaultSink, type FaultReport } from './fault'
import { TRACE_OFF_CONTRACT_TEXT_MAX_CHARS } from './runTrace'

// Issue #286: an Off-language Answer is never rendered, so the record is
// the only place its words and its shares are kept.

const CARD = { rendering: 'card', share: 0.64 } as const
const SPOKEN = { rendering: 'spoken', share: 1 } as const

describe('offLanguageAnswerEvent', () => {
  it('keeps the round, the renderings that failed with their shares, and whether a retry was spent', () => {
    expect(offLanguageAnswerEvent({ round: 4, renderings: [CARD, SPOKEN], retried: true, text: '这是答案。' })).toEqual({
      kind: 'off_language_answer',
      round: 4,
      renderings: [CARD, SPOKEN],
      retried: true,
      text: '这是答案。',
      chars: 5,
    })
  })

  it('carries the cause the deterministic Answer used, and none when the phase was working', () => {
    expect(offLanguageAnswerEvent({ round: 25, renderings: [CARD], retried: false, cause: 'budget_exhausted', text: 't' })).toMatchObject({
      retried: false,
      cause: 'budget_exhausted',
    })
    expect(offLanguageAnswerEvent({ round: 3, renderings: [CARD], retried: false, text: 't' })).not.toHaveProperty('cause')
  })

  it('cuts an oversized reply as off_contract_reply cuts it, and keeps the cut visible', () => {
    const text = '中'.repeat(TRACE_OFF_CONTRACT_TEXT_MAX_CHARS + 500)

    const record = offLanguageAnswerEvent({ round: 1, renderings: [CARD], retried: true, text })

    expect(record).toMatchObject({ text: '中'.repeat(TRACE_OFF_CONTRACT_TEXT_MAX_CHARS), chars: text.length })
  })
})

describe('recordOffLanguageAnswer', () => {
  afterEach(() => setFaultSink(null))

  it('writes the record and reports the fault together, on the caller’s site', () => {
    const traced: TracedOffLanguageAnswer[] = []
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))

    recordOffLanguageAnswer({
      site: 'pipeline.createCommandPipeline.offLanguageAnswer',
      round: 25,
      renderings: [CARD, SPOKEN],
      retried: false,
      cause: 'budget_exhausted',
      text: '这是答案。',
      trace: (record) => traced.push(record),
      turnId: 'turn-1',
    })

    expect(traced).toEqual([{ round: 25, renderings: [CARD, SPOKEN], retried: false, cause: 'budget_exhausted', text: '这是答案。' }])
    expect(faults).toEqual([
      {
        kind: 'fault',
        site: 'pipeline.createCommandPipeline.offLanguageAnswer',
        message: 'round 25 replied with an Off-language Answer (card 64%, spoken 100% of letters outside Latin script; budget_exhausted): 这是答案。',
        turnId: 'turn-1',
      },
    ])
  })

  it('says a retry was spent in place of a cause, and quotes only the head of the reply', () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))

    recordOffLanguageAnswer({ site: 's', round: 2, renderings: [SPOKEN], retried: true, text: '中'.repeat(1_000) })

    expect(faults).toHaveLength(1)
    expect(faults[0]?.message).toBe(
      offLanguageAnswerFaultMessage({ round: 2, renderings: [SPOKEN], retried: true, text: '中'.repeat(1_000) }),
    )
    expect(faults[0]?.message).toContain('Answer Retry spent')
    expect(faults[0]?.message).toContain('中'.repeat(OFF_LANGUAGE_FAULT_HEAD_CHARS))
    expect(faults[0]?.message).not.toContain('中'.repeat(OFF_LANGUAGE_FAULT_HEAD_CHARS + 1))
  })

  it('names no cause and no retry for a fallback made while the phase was working', () => {
    expect(offLanguageAnswerFaultMessage({ round: 3, renderings: [CARD], retried: false, text: 't' })).toBe(
      'round 3 replied with an Off-language Answer (card 64% of letters outside Latin script; no Answer Retry left): t',
    )
  })
})
