import { describe, expect, it } from 'vitest'
import { EAR_SHUT, opensCapture } from './captureAsk'

describe('opensCapture (#530)', () => {
  const shut = { listening: false, transcribing: false, monitoring: false }
  const resting = { ...shut, monitoring: true }
  const listen = { ...shut, listening: true, monitoring: true }

  it('opens for a listen, a read or a monitor, and never for an ear that is shut', () => {
    expect(opensCapture(EAR_SHUT, listen, false)).toBe(true)
    expect(opensCapture(resting, { ...shut, transcribing: true }, false)).toBe(true)
    expect(opensCapture(shut, resting, false)).toBe(true)
    expect(opensCapture(resting, shut, false)).toBe(false)
    expect(opensCapture(resting, shut, true)).toBe(false)
  })

  it('does not try again on a state that asks nothing new: the failure publishes a state, and that must not fail again', () => {
    expect(opensCapture(resting, resting, true)).toBe(false)
    expect(opensCapture(listen, resting, true)).toBe(false)
    expect(opensCapture(listen, listen, true)).toBe(false)
  })

  it('tries again when a listen opens: Ctrl+Space is someone asking to be heard now', () => {
    expect(opensCapture(resting, listen, true)).toBe(true)
  })

  it('tries again when the ear reopens, as under the Mic Mute going off', () => {
    expect(opensCapture(shut, resting, true)).toBe(true)
  })
})
