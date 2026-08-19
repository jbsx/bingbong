import { describe, expect, it } from 'vitest'
import { formatTurnSummary } from './turnSummary'

// The per-turn console line (#30): every stage kind recorded for the turn,
// in first-recorded order, a repeat count when a stage ran more than once,
// and the total last — "stt 6.9s | llm 3.2s | tool(n=5) 8.1s | total 21.3s".
// There is no fixed stage list: whatever the turn recorded is what prints.
describe('formatTurnSummary', () => {
  it('renders each stage in first-recorded order with the total last', () => {
    const line = formatTurnSummary({
      turnId: 'turn-1',
      stages: {
        stt: { count: 1, durMs: 6_900 },
        llm: { count: 1, durMs: 3_200 },
        tool: { count: 5, durMs: 8_100 },
        tts: { count: 1, durMs: 1_400 },
      },
      totalMs: 19_600,
    })

    expect(line).toBe('stt 6.9s | llm 3.2s | tool(n=5) 8.1s | tts 1.4s | total 19.6s')
  })

  it('omits the repeat count for stages that ran once', () => {
    const line = formatTurnSummary({
      turnId: 'turn-1',
      stages: { llm: { count: 2, durMs: 500 }, tool: { count: 1, durMs: 250 } },
      totalMs: 750,
    })

    expect(line).toBe('llm(n=2) 0.5s | tool 0.3s | total 0.8s')
  })

  it('composes with whatever stages exist — a single-stage turn still gets a line', () => {
    const line = formatTurnSummary({
      turnId: 'turn-1',
      stages: { stt: { count: 1, durMs: 12_340 } },
      totalMs: 12_340,
    })

    expect(line).toBe('stt 12.3s | total 12.3s')
  })
})
