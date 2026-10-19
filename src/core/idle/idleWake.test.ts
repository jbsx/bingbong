import { describe, expect, it } from 'vitest'
import { wakesIdleScreen } from './idleWake'

describe('wakesIdleScreen', () => {
  it('a Command that acts on the pane wakes it', () => {
    expect(wakesIdleScreen({ type: 'command', turnId: 't1', text: 'open youtube', action: 'open youtube', at: 1 })).toBe(true)
  })

  it('a Command that keeps idle, or a dropped line, leaves it up', () => {
    expect(wakesIdleScreen({ type: 'command', turnId: 't1', text: 'timer 5m', action: 'timer 5 minutes', keepsIdle: true, at: 1 })).toBe(false)
    expect(wakesIdleScreen({ type: 'command', turnId: 't1', text: 'hmm', dropped: true, at: 1 })).toBe(false)
  })

  it('the rest of the stream — a reading, its Answer, its end — leaves it up', () => {
    expect(wakesIdleScreen({ type: 'status', turnId: 't1', status: 'thinking', at: 1 })).toBe(false)
    expect(wakesIdleScreen({ type: 'display', turnId: 't1', text: 'Timer set for 5 minutes.', at: 1 })).toBe(false)
    expect(wakesIdleScreen({ type: 'done', turnId: 't1', outcome: 'done', at: 1 })).toBe(false)
  })
})
