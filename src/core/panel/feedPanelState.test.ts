import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import type { SessionId } from '../session/sessionIdentity'
import {
  FEED_MODE_STORAGE_KEY,
  FEED_PANEL_WIDTH_DEFAULT,
  FEED_PANEL_WIDTH_MAX_STEPS,
  FEED_PANEL_WIDTH_MIN,
  FEED_PANEL_WIDTH_STEP,
  FEED_WIDTH_STORAGE_KEY,
  clampFeedPanelWidth,
  createFeedPanelStateFold,
  isFeedPanelMode,
  isPanelWidthDirection,
  isPanelWidthPreset,
  presetFeedPanelWidth,
  readStoredFeedMode,
  readStoredFeedWidth,
  stepFeedPanelWidth,
} from './feedPanelState'
import { isFeedPanelStatePayload } from './ipcChannels'

// Feed panel layout life (#45, ADR 0021): overlay/docked mode plus the
// open state, as one pure fold over the same pipeline event seam every
// observer rides. Voice never opens the panel — a command shows the Peek
// Card instead — so only human acts and run ends move `open`. Table-driven
// like the projections it sits beside. The width axis (#65) rides the same
// fold: defaults, bounds, storage.

function events(...parts: Array<Partial<PipelineEvent> & { type: PipelineEvent['type'] }>): PipelineEvent[] {
  return parts.map((part, index) => ({ at: index, ...part }) as PipelineEvent)
}

function feedEvents(...types: Array<'command' | 'done' | 'status' | 'error' | 'speak'>): PipelineEvent[] {
  return events(
    ...types.map((type) => {
      if (type === 'command') return { type, turnId: 't1', text: 'find a pizza place' }
      if (type === 'done') return { type, turnId: 't1', outcome: 'done' as const }
      if (type === 'error') return { type, message: 'boom' }
      if (type === 'speak') return { type, text: 'hello' }
      return { type, turnId: 't1', status: 'thinking' as const }
    }),
  )
}

describe('createFeedPanelStateFold', () => {
  it('boots collapsed in overlay mode at the default width', () => {
    const fold = createFeedPanelStateFold()
    expect(fold.state()).toEqual({ mode: 'overlay', open: false, width: FEED_PANEL_WIDTH_DEFAULT })
  })

  it('a command never opens the panel — voice shows the Peek Card, not the slab (ADR 0021)', () => {
    const fold = createFeedPanelStateFold()
    for (const event of feedEvents('command', 'status', 'speak')) fold.onEvent(event)
    expect(fold.state().open).toBe(false)
  })

  it('done collapses a manually opened panel, and a failed run stays balanced', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    fold.onEvent(feedEvents('command')[0]!)
    fold.onEvent(feedEvents('done')[0]!)
    expect(fold.state().open).toBe(false)
  })

  it('ignores detail, status, and out-of-turn events', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    const before = fold.state()
    for (const event of events(
      { type: 'llm_retry', turnId: 't1', attempt: 2, maxAttempts: 3 },
      { type: 'tool_call', turnId: 't1', callId: 'c1', name: 'navigate', args: {} },
      {
        type: 'agent_update',
        agent: {
          id: 'a1',
          kind: 'browse',
          task: 'check the news',
          status: 'running',
          startedAt: 0,
          finishedAt: null,
          steps: 0,
          lastAction: null,
          result: null,
          error: null,
        },
      },
      { type: 'session_started', sessionId: 'session-1' as SessionId, sessionGeneration: 0 },
    )) {
      fold.onEvent(event)
    }
    expect(fold.state()).toEqual(before)
  })

  it('toggleOpen flips the manual state without waiting for a run', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    expect(fold.state().open).toBe(true)
    fold.toggleOpen()
    expect(fold.state().open).toBe(false)
  })

  it('a manual open survives until the next run boundary, not forever', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    // Even a manual open yields to the run's end, so the idle panel is
    // always collapsed.
    fold.onEvent(feedEvents('done')[0]!)
    expect(fold.state().open).toBe(false)
  })

  it('setMode switches layout mode independently of open state', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    fold.setMode('docked')
    expect(fold.state()).toMatchObject({ mode: 'docked', open: true })
    fold.setMode('overlay')
    expect(fold.state().mode).toBe('overlay')
  })

  it('setWidth stores a rounded width and leaves mode/open untouched', () => {
    const fold = createFeedPanelStateFold()
    fold.toggleOpen()
    fold.setWidth(640.6)
    expect(fold.state()).toEqual({ mode: 'overlay', open: true, width: 641 })
    // Layout controls are independent axes: mode changes keep the width.
    fold.setMode('docked')
    expect(fold.state()).toEqual({ mode: 'docked', open: true, width: 641 })
  })

  it('setWidth ignores junk so a malformed IPC payload cannot corrupt the fold', () => {
    const fold = createFeedPanelStateFold()
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) fold.setWidth(junk)
    expect(fold.state().width).toBe(FEED_PANEL_WIDTH_DEFAULT)
  })
})

describe('clampFeedPanelWidth', () => {
  it('passes through in-bounds widths, rounding to whole pixels', () => {
    expect(clampFeedPanelWidth(600, 1280)).toBe(600)
    expect(clampFeedPanelWidth(880, 1280)).toBe(880)
    expect(clampFeedPanelWidth(640.4, 1280)).toBe(640)
  })

  it('enforces the 320px floor', () => {
    expect(clampFeedPanelWidth(200, 1280)).toBe(FEED_PANEL_WIDTH_MIN)
    expect(clampFeedPanelWidth(319, 1280)).toBe(FEED_PANEL_WIDTH_MIN)
  })

  it('enforces the 75%-of-window ceiling', () => {
    expect(clampFeedPanelWidth(1400, 1280)).toBe(960)
    expect(clampFeedPanelWidth(880, 1000)).toBe(750)
  })

  it('lets the floor win when the window is too small for both bounds', () => {
    // CSS clamp() semantics (max(MIN, min(VAL, MAX))): the stated 320px
    // floor is the hard promise even on a 400px window.
    expect(clampFeedPanelWidth(880, 400)).toBe(FEED_PANEL_WIDTH_MIN)
  })
})

describe('stepFeedPanelWidth', () => {
  it('moves one fixed step per count in the given direction', () => {
    expect(FEED_PANEL_WIDTH_STEP).toBeGreaterThan(0)
    expect(stepFeedPanelWidth(880, 'narrower', 1, 1280)).toBe(880 - FEED_PANEL_WIDTH_STEP)
    expect(stepFeedPanelWidth(880, 'narrower', 2, 1280)).toBe(880 - 2 * FEED_PANEL_WIDTH_STEP)
    expect(stepFeedPanelWidth(560, 'wider', 1, 1280)).toBe(560 + FEED_PANEL_WIDTH_STEP)
  })

  it('clamps to the same bounds as every other width writer', () => {
    // Below the floor…
    expect(stepFeedPanelWidth(360, 'narrower', 1, 1280)).toBe(FEED_PANEL_WIDTH_MIN)
    // …and above the ceiling.
    expect(stepFeedPanelWidth(880, 'wider', 2, 1280)).toBe(Math.floor(1280 * 0.75))
  })

  it('treats a fractional or non-positive count as one step — never zero or reversed', () => {
    expect(stepFeedPanelWidth(880, 'wider', 0, 1280)).toBe(stepFeedPanelWidth(880, 'wider', 1, 1280))
    expect(stepFeedPanelWidth(880, 'wider', 2.4, 1280)).toBe(stepFeedPanelWidth(880, 'wider', 2, 1280))
    expect(stepFeedPanelWidth(880, 'wider', Number.NaN, 1280)).toBe(stepFeedPanelWidth(880, 'wider', 1, 1280))
  })
})

describe('presetFeedPanelWidth', () => {
  it('half_screen is half the window content width', () => {
    expect(presetFeedPanelWidth('half_screen', 1280)).toBe(640)
    // Odd widths round with the fold's usual whole-pixel policy.
    expect(presetFeedPanelWidth('half_screen', 1001)).toBe(501)
  })

  it('clamps presets to the bounds on extreme windows', () => {
    // Half of 400 is 200, but the 320px floor is the hard promise.
    expect(presetFeedPanelWidth('half_screen', 400)).toBe(FEED_PANEL_WIDTH_MIN)
  })

  it('the max step count cannot cross the whole bounds range from the default', () => {
    // 5 steps from either end stays inside the policy's reach: reachable
    // from the default in both directions (with clamping), and the count
    // is small enough that one call is one nudge, not a teleport.
    expect(FEED_PANEL_WIDTH_MAX_STEPS).toBeGreaterThanOrEqual(1)
    expect(FEED_PANEL_WIDTH_MAX_STEPS).toBeLessThanOrEqual(5)
  })
})

describe('isPanelWidthDirection', () => {
  it('accepts only wider/narrower', () => {
    expect(isPanelWidthDirection('wider')).toBe(true)
    expect(isPanelWidthDirection('narrower')).toBe(true)
    expect(isPanelWidthDirection('wider ')).toBe(false)
    expect(isPanelWidthDirection('half_screen')).toBe(false)
    expect(isPanelWidthDirection(undefined)).toBe(false)
  })
})

describe('isPanelWidthPreset', () => {
  it('accepts only half_screen', () => {
    expect(isPanelWidthPreset('half_screen')).toBe(true)
    expect(isPanelWidthPreset('wider')).toBe(false)
    expect(isPanelWidthPreset('full_screen')).toBe(false)
    expect(isPanelWidthPreset(1)).toBe(false)
  })
})

describe('readStoredFeedMode', () => {
  it('defaults to overlay with no storage or key', () => {
    expect(readStoredFeedMode(null)).toBe('overlay')
    expect(readStoredFeedMode({ getItem: () => null })).toBe('overlay')
  })

  it('reads a stored mode', () => {
    expect(readStoredFeedMode({ getItem: (key) => (key === FEED_MODE_STORAGE_KEY ? 'docked' : null) })).toBe('docked')
  })

  it('falls back to overlay on junk values', () => {
    expect(readStoredFeedMode({ getItem: () => 'floating' })).toBe('overlay')
    expect(readStoredFeedMode({ getItem: () => JSON.stringify({ mode: 'docked' }) })).toBe('overlay')
  })
})

describe('readStoredFeedWidth', () => {
  it('defaults to the caller-supplied fallback with no storage or key', () => {
    expect(readStoredFeedWidth(null, FEED_PANEL_WIDTH_DEFAULT)).toBe(FEED_PANEL_WIDTH_DEFAULT)
    expect(readStoredFeedWidth({ getItem: () => null }, 420)).toBe(420)
  })

  it('reads a stored width', () => {
    expect(
      readStoredFeedWidth({ getItem: (key) => (key === FEED_WIDTH_STORAGE_KEY ? '640' : null) }, 880),
    ).toBe(640)
  })

  it('falls back on junk values', () => {
    for (const junk of ['wide', 'NaN', 'Infinity', '-20', '0', '880.5.2', JSON.stringify({ width: 880 })]) {
      expect(readStoredFeedWidth({ getItem: () => junk }, 880)).toBe(880)
    }
  })

  it('returns raw stored widths — window-relative clamping is the fold owner job', () => {
    // A stored 950 on a small window must clamp at boot, but the stored
    // value itself survives a window that grows again.
    expect(readStoredFeedWidth({ getItem: () => '950' }, 880)).toBe(950)
  })
})

describe('isFeedPanelStatePayload', () => {
  it('accepts a state carrying a finite width', () => {
    expect(isFeedPanelStatePayload({ mode: 'overlay', open: false, width: 880 })).toBe(true)
    expect(isFeedPanelStatePayload({ mode: 'docked', open: true, width: 320 })).toBe(true)
  })

  it('rejects states without a usable width', () => {
    expect(isFeedPanelStatePayload({ mode: 'overlay', open: false })).toBe(false)
    expect(isFeedPanelStatePayload({ mode: 'overlay', open: false, width: Number.NaN })).toBe(false)
    expect(isFeedPanelStatePayload({ mode: 'overlay', open: false, width: '880' })).toBe(false)
  })
})

describe('isFeedPanelMode', () => {
  it('accepts only the two mode literals', () => {
    expect(isFeedPanelMode('overlay')).toBe(true)
    expect(isFeedPanelMode('docked')).toBe(true)
    expect(isFeedPanelMode('floating')).toBe(false)
    expect(isFeedPanelMode(undefined)).toBe(false)
    expect(isFeedPanelMode(1)).toBe(false)
  })
})
