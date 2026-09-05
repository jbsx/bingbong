import { describe, expect, it } from 'vitest'
import { failureScreenshotCause, failureScreenshotEvent } from './failureScreenshot'

describe('what earns a failure screenshot (#191)', () => {
  it('a failed outcome, or a finalization on a work rail — and nothing else', () => {
    const at = 0
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'failed', at })).toBe('failed')
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'done', finalizationCause: 'no_progress', at })).toBe('no_progress')
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'done', finalizationCause: 'deadline_reached', at })).toBe('deadline_reached')
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'done', finalizationCause: 'budget_exhausted', at })).toBe('budget_exhausted')

    // A Run that met its objective, was cancelled, or reset leaves no
    // capture: the file is about failures, and a Kiosk's happy path must
    // never accumulate pixels.
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'done', finalizationCause: 'objective_met', at })).toBeNull()
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'done', at })).toBeNull()
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'cancelled', at })).toBeNull()
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'reset', at })).toBeNull()
    expect(failureScreenshotCause({ type: 'status', turnId: 't', status: 'thinking', at })).toBeNull()
  })

  it('a failed outcome outranks whatever cause rides beside it', () => {
    expect(failureScreenshotCause({ type: 'done', turnId: 't', outcome: 'failed', finalizationCause: 'no_progress', at: 0 })).toBe('failed')
  })

  it('records the cause and where the PNG went', () => {
    expect(failureScreenshotEvent('no_progress', { path: '/logs/run-trace-run-1-turn-9.png', bytes: 1_024 })).toEqual({
      kind: 'failure_screenshot',
      cause: 'no_progress',
      path: '/logs/run-trace-run-1-turn-9.png',
      bytes: 1_024,
    })
  })
})
