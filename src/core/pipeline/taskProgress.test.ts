import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from './events'
import { createTaskProgressTracker, describeProgress } from './taskProgress'

// The Task's progress bar (#375): the per-hop Progress Noul (#373) folded
// into one bar for the Status Capsule — pinned here as a pure projection
// over the event stream, so the renderer only draws what this yields.

const WORDS = 'what defect rate did hub aurora return'

/** A hop's command event: hop 0 fires the words' first action; a later hop carries its Noul. */
function hop(n: number, progress?: number, at = 100 * (n + 1)): PipelineEvent {
  return { type: 'command', turnId: `h${n}`, text: WORDS, action: `click [${n + 1}]`, task: { id: 'h0', hop: n, ...(progress !== undefined ? { progress } : {}) }, at }
}

/** The closing hop that fires nothing: `done` on a sure yes, `not sure this is it` otherwise. */
function closing(n: number, action: string, progress?: number): PipelineEvent {
  return { type: 'command', turnId: `h${n}`, text: WORDS, action, dropped: true, task: { id: 'h0', hop: n, ...(progress !== undefined ? { progress } : {}) }, at: 100 * (n + 1) }
}

function fold(events: PipelineEvent[]) {
  const tracker = createTaskProgressTracker()
  for (const event of events) tracker.onEvent(event)
  return tracker.current()
}

describe('the Task progress bar (#375)', () => {
  it('shows no bar before the first Progress Noul: hop 0 alone, or a Local Match Command', () => {
    expect(fold([hop(0)])).toBeNull()
    expect(fold([{ type: 'command', turnId: 'l1', text: 'scroll down', action: 'scroll down', task: { id: 'l1', hop: 0 }, at: 1 }])).toBeNull()
    expect(fold([{ type: 'command', turnId: 'l2', text: 'reload', at: 1 }])).toBeNull()
  })

  it('moves with each hop\'s Noul as it arrives: forward on a hop that helped, held in the middle, back on one that did not', () => {
    expect(fold([hop(0), hop(1, 0.9)])).toEqual({ taskId: 'h0', filled: 0.2, moves: ['forward'] })
    expect(fold([hop(0), hop(1, 0.9), hop(2, 0.5)])).toEqual({ taskId: 'h0', filled: 0.2, moves: ['forward', 'held'] })
    expect(fold([hop(0), hop(1, 0.9), hop(2, 0.5), hop(3, 0.1)])).toEqual({ taskId: 'h0', filled: 0, moves: ['forward', 'held', 'back'] })
  })

  it('never goes under the floor on a Task whose first action did not help, and never fills by helping hops alone', () => {
    expect(fold([hop(0), hop(1, 0.1)])).toMatchObject({ filled: 0, moves: ['back'] })
    const five = fold([hop(0), hop(1, 0.9), hop(2, 0.9), hop(3, 0.9), hop(4, 0.9), hop(5, 0.9)])
    expect(five?.filled).toBeGreaterThan(0.8)
    expect(five?.filled).toBeLessThan(1)
  })

  it('fills on a sure yes — the closing hop whose action is `done` — and stands where it got on any other close', () => {
    const closed = (close: string) => fold([hop(0), hop(1, 0.9), hop(2, 0.1), closing(3, close, 0.9)])
    expect(closed('done')).toEqual({ taskId: 'h0', filled: 1, moves: ['forward', 'back', 'full'] })
    expect(closed('not sure this is it')).toEqual({ taskId: 'h0', filled: 0.2, moves: ['forward', 'back', 'forward'] })
  })

  it('stands after the Task ends until the next Command\'s hop 0, which shows no bar of its own', () => {
    const ended: PipelineEvent[] = [hop(0), hop(1, 0.9), closing(2, 'done'), { type: 'done', turnId: 'h2', outcome: 'done', at: 301 }]
    expect(fold(ended)).toMatchObject({ filled: 1 })
    expect(fold([...ended, { type: 'command', turnId: 'n1', text: 'scroll down', action: 'scroll down', task: { id: 'n1', hop: 0 }, at: 400 }])).toBeNull()
    expect(fold([...ended, { type: 'command', turnId: 'n2', text: 'read', action: 'read', task: { id: 'n2', hop: 0 }, at: 400 }, { type: 'command', turnId: 'n3', text: 'open it', action: 'click [1]', task: { id: 'n2', hop: 1, progress: 0.5 }, at: 500 }])).toEqual({ taskId: 'n2', filled: 0, moves: ['held'] })
  })
})

describe('describeProgress', () => {
  it('reads a Noul in the words the Feed shows: closer at the bar, no closer at the floor, unsure between', () => {
    expect(describeProgress(0.9)).toBe('closer')
    expect(describeProgress(0.7)).toBe('closer')
    expect(describeProgress(0.5)).toBe('unsure')
    expect(describeProgress(0.3)).toBe('no closer')
    expect(describeProgress(0.1)).toBe('no closer')
  })
})
