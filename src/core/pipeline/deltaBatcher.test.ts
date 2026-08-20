import { describe, expect, it } from 'vitest'
import { createLlmDeltaBatcher, DELTA_FLUSH_MS, type DeltaFlush } from './deltaBatcher'
import { FakeClock } from '../testing/doubles'

// The delta batcher (#47): token deltas are chatty, so the pipeline
// accumulates them per round and flushes through the detail channel every
// ~120ms — never per token. Answer text flushes as its visible part (the
// answer-contract JSON streams as the first opened value); reasoning
// flushes raw. Tool-intent snapshots (#48) ride the same window: one
// flush per call index, carrying the latest accumulated arguments.

function makeBatcher() {
  const clock = new FakeClock()
  const flushed: DeltaFlush[] = []
  const batcher = createLlmDeltaBatcher({ clock, emit: (fragment) => flushed.push(fragment) })
  return { clock, flushed, batcher }
}

/** The text fragments only — intent flushes carry args, not text. */
function texts(flushed: DeltaFlush[]): string[] {
  return flushed.flatMap((fragment) => ('text' in fragment ? [fragment.text] : []))
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

    expect(texts(flushed)).toEqual(['Opening You', 'Tube.'])
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
    expect(texts(flushed)).toEqual(['thinking…'])
  })

  it('flush() drains the tail at round end without waiting out the window', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'text', text: '{"speak":"Tail.' })
    batcher.flush()
    expect(texts(flushed)).toEqual(['Tail.'])

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

    expect(texts(flushed)).toEqual(['First.', 'plain second round'])
  })

  it('drops an empty diff instead of emitting a blank fragment', () => {
    const { clock, flushed, batcher } = makeBatcher()

    // JSON preamble only: nothing visible yet.
    batcher.onDelta({ kind: 'text', text: '{"speak":' })
    clock.advance(DELTA_FLUSH_MS)
    expect(flushed).toEqual([])
  })

  it('coalesces intent snapshots per index — the window flushes the latest, not per fragment', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'tool_intent', index: 0, name: 'web_search', args: '{"query":"mech' })
    batcher.onDelta({ kind: 'tool_intent', index: 0, name: 'web_search', args: '{"query":"mechanical keyboards"}' })
    expect(flushed).toEqual([])

    clock.advance(DELTA_FLUSH_MS)
    expect(flushed).toEqual([{ kind: 'tool_intent', index: 0, name: 'web_search', args: '{"query":"mechanical keyboards"}', at: DELTA_FLUSH_MS }])
  })

  it('keeps parallel calls separate — one flush per index, in index order', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'tool_intent', index: 1, name: 'click', args: '{"ref":2}' })
    batcher.onDelta({ kind: 'tool_intent', index: 0, name: 'navigate', args: '{"url":"x.test"}' })
    clock.advance(DELTA_FLUSH_MS)

    expect(flushed).toEqual([
      { kind: 'tool_intent', index: 0, name: 'navigate', args: '{"url":"x.test"}', at: DELTA_FLUSH_MS },
      { kind: 'tool_intent', index: 1, name: 'click', args: '{"ref":2}', at: DELTA_FLUSH_MS },
    ])
  })

  it('drains a pending intent at round end without waiting out the window, then stays quiet', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'tool_intent', index: 0, name: 'click', args: '{"ref"' })
    batcher.flush()
    expect(flushed.map((fragment) => fragment.kind)).toEqual(['tool_intent'])

    // No new fragments — a later window (or round) re-emits nothing.
    clock.advance(DELTA_FLUSH_MS)
    batcher.flush()
    expect(flushed).toHaveLength(1)
  })

  it('rides intent beside reasoning in the same window — reasoning first, then intents', () => {
    const { clock, flushed, batcher } = makeBatcher()

    batcher.onDelta({ kind: 'tool_intent', index: 0, name: 'click', args: '{"ref":1}' })
    batcher.onDelta({ kind: 'reasoning', text: 'the user wants ' })
    batcher.onDelta({ kind: 'reasoning', text: 'this button' })
    clock.advance(DELTA_FLUSH_MS)

    expect(flushed.map((fragment) => fragment.kind)).toEqual(['reasoning', 'tool_intent'])
  })
})
