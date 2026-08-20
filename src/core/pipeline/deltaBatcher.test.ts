import { describe, expect, it } from 'vitest'
import { createLlmDeltaBatcher, DELTA_FLUSH_MS } from './deltaBatcher'
import { FakeClock } from '../testing/doubles'

// The delta batcher (#47): token deltas are chatty, so the pipeline
// accumulates them per round and flushes through the detail channel every
// ~120ms — never per token. Answer text flushes as its visible part (the
// answer-contract JSON streams as the first opened value); reasoning
// flushes raw.

function makeBatcher() {
  const clock = new FakeClock()
  const flushed: { kind: 'text' | 'reasoning'; text: string; at: number }[] = []
  const batcher = createLlmDeltaBatcher({ clock, emit: (fragment) => flushed.push(fragment) })
  return { clock, flushed, batcher }
}

describe('llm delta batcher', () => {
  it('flushes within the agreed window, not per fragment', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'text', text: '{"speak":"Done.' })
    batcher.onDelta({ kind: 'text', text: ' Playing.' })
    expect(flushed).toEqual([])

    clock.advance(DELTA_FLUSH_MS)
    expect(flushed).toEqual([{ kind: 'text', text: 'Done. Playing.', at: DELTA_FLUSH_MS }])
  })

  it('flushes the visible part of answer-contract JSON, not the raw envelope', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'text', text: '{"display":"# Det' })
    batcher.onDelta({ kind: 'text', text: 'ail."}' })
    clock.advance(DELTA_FLUSH_MS)

    expect(flushed).toEqual([{ kind: 'text', text: '# Detail.', at: DELTA_FLUSH_MS }])
  })

  it('flushes only the newly visible suffix on later windows', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'text', text: 'Opening You' })
    clock.advance(DELTA_FLUSH_MS)
    batcher.onDelta({ kind: 'text', text: 'Tube.' })
    clock.advance(DELTA_FLUSH_MS)

    expect(flushed.map((f) => f.text)).toEqual(['Opening You', 'Tube.'])
  })

  it('flushes reasoning fragments raw, after the answer fragment of the same window', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'reasoning', text: 'the user wants ' })
    batcher.onDelta({ kind: 'reasoning', text: 'youtube' })
    batcher.onDelta({ kind: 'text', text: '{"speak":"OK.' })
    clock.advance(DELTA_FLUSH_MS)

    expect(flushed).toEqual([
      { kind: 'reasoning', text: 'the user wants youtube', at: DELTA_FLUSH_MS },
      { kind: 'text', text: 'OK.', at: DELTA_FLUSH_MS },
    ])
  })

  it('holds the window until the first fragment arrives, then flushes one window later', () => {
    const { clock, flushed, batcher } = makeBatcher()

    clock.advance(DELTA_FLUSH_MS * 3)
    expect(flushed).toEqual([])

    batcher.onDelta({ kind: 'reasoning', text: 'thinking…' })
    clock.advance(DELTA_FLUSH_MS)
    expect(flushed.map((f) => f.text)).toEqual(['thinking…'])
  })

  it('flush() drains the tail at round end without waiting out the window', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'text', text: '{"speak":"Tail.' })
    batcher.flush()
    expect(flushed.map((f) => f.text)).toEqual(['Tail.'])

    // Already drained — a late window tick flushes nothing.
    clock.advance(DELTA_FLUSH_MS)
    expect(flushed).toHaveLength(1)
  })

  it('resets between rounds — fragments never leak across rounds', () => {
    const { flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'text', text: '{"speak":"First.' })
    batcher.flush()
    batcher.onDelta({ kind: 'text', text: 'plain second round' })
    batcher.flush()

    expect(flushed.map((f) => f.text)).toEqual(['First.', 'plain second round'])
  })

  it('drops an empty diff instead of emitting a blank fragment', () => {
    const { clock, flushed, batcher } = makeBatcher()

    // JSON preamble only: nothing visible yet.
    batcher.onDelta({ kind: 'text', text: '{"speak":' })
    clock.advance(DELTA_FLUSH_MS)
    expect(flushed).toEqual([])
  })
})
