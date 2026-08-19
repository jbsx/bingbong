import { describe, expect, it } from 'vitest'
import { BROWSER_SUBSPANS_ENV, browserSubspansEnabled, createBrowserSubspans } from './browserSubspans'
import { fakePerfHarness } from '../testing/doubles'

// The verbose browser sub-span channel (#32): one shared object between the
// pipeline's tool gate (which opens the current-turn scope) and the browser
// controller (which emits sub-spans for its internal delays and extra
// round-trips). Flag off (the default) or no open scope — nothing is written,
// so the default log stays byte-identical to whole-action tool spans.

describe('browserSubspansEnabled', () => {
  it.each(['1', 'true', 'yes', 'on', 'TRUE', 'Yes'])('enables for %s', (value) => {
    expect(browserSubspansEnabled({ [BROWSER_SUBSPANS_ENV]: value })).toBe(true)
  })

  it.each([undefined, '', '0', 'false', 'no', 'off', 'nonsense'])('disables for %s', (value) => {
    expect(browserSubspansEnabled({ [BROWSER_SUBSPANS_ENV]: value })).toBe(false)
  })
})

describe('createBrowserSubspans', () => {
  it('emits sub-spans keyed by the open turn scope', () => {
    const { records, state, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })

    subspans.runInTurn('turn-1', () => {
      const start = subspans.now()
      state.monotonicMs += 300
      subspans.emit('browser-settle', subspans.now() - start, { action: 'navigate', ms: 300 })
      return Promise.resolve()
    })

    expect(records).toEqual([
      { turnId: 'turn-1', stage: 'browser-settle', durMs: 300, at: 1_700_000_000_000, t: 300, detail: { action: 'navigate', ms: 300 } },
    ])
  })

  it('writes nothing while the flag is off — the default log stays byte-identical', () => {
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer })

    subspans.runInTurn('turn-1', () => {
      subspans.emit('browser-settle', 300, { action: 'navigate', ms: 300 })
      subspans.emit('browser-recollection', 40, { reason: 'resolve-ref' })
      subspans.emit('browser-safety', 25, { kind: 'click-prep' })
      return Promise.resolve()
    })

    expect(records).toEqual([])
  })

  it('drops emissions from outside any turn scope (CLI harness, detached panes)', () => {
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })

    subspans.emit('browser-settle', 300, { action: 'navigate', ms: 300 })

    expect(records).toEqual([])
  })

  it('restores the outer turn scope after a nested run, and returns the action value', async () => {
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })
    const emits = (turn: string) => subspans.emit('browser-settle', 1, { turn })

    await subspans.runInTurn('turn-outer', async () => {
      emits('turn-outer')
      const inner = await subspans.runInTurn('turn-inner', () => {
        emits('turn-inner')
        return Promise.resolve('inner-result')
      })
      expect(inner).toBe('inner-result')
      emits('turn-outer')
    })
    subspans.runInTurn('turn-next', () => {
      emits('turn-next')
      return Promise.resolve()
    })

    expect(records.map((record) => [record.turnId, record.detail])).toEqual([
      ['turn-outer', { turn: 'turn-outer' }],
      ['turn-inner', { turn: 'turn-inner' }],
      ['turn-outer', { turn: 'turn-outer' }],
      ['turn-next', { turn: 'turn-next' }],
    ])
  })

  it('clears the scope when the scoped action throws', async () => {
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })

    await expect(
      subspans.runInTurn('turn-1', async () => {
        throw new Error('action failed')
      }),
    ).rejects.toThrow('action failed')
    subspans.emit('browser-settle', 1)

    expect(records).toEqual([])
  })

  it('swallows a throwing tracer — the log is advisory and never fails a browser action', () => {
    const tracer = fakePerfHarness().tracer
    const original = tracer.span.bind(tracer)
    tracer.span = () => {
      throw new Error('sink exploded')
    }
    const subspans = createBrowserSubspans({ tracer, enabled: true })

    expect(() => subspans.runInTurn('turn-1', () => Promise.resolve())).not.toThrow()
    tracer.span = original
  })
})
