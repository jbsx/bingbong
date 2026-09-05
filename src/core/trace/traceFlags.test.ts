import { describe, expect, it } from 'vitest'

// The two diagnostics opt-ins (#184): each named for exactly the glossary
// term it gates, both read through the one shared BINGBONG_* parser, both
// off unless set — the invariant a deployed Kiosk depends on.

import { HOST_TRACE_ENV, hostTraceEnabled, RUN_TRACE_ENV, runTraceEnabled } from './traceFlags'

describe('trace flags', () => {
  it('names each flag for the glossary term it gates', () => {
    expect(RUN_TRACE_ENV).toBe('BINGBONG_RUN_TRACE')
    expect(HOST_TRACE_ENV).toBe('BINGBONG_HOST_TRACE')
  })

  it('is off when unset, empty, or set to anything but an opt-in word', () => {
    expect(runTraceEnabled({})).toBe(false)
    expect(hostTraceEnabled({})).toBe(false)
    expect(runTraceEnabled({ [RUN_TRACE_ENV]: '' })).toBe(false)
    expect(runTraceEnabled({ [RUN_TRACE_ENV]: '0' })).toBe(false)
    expect(runTraceEnabled({ [RUN_TRACE_ENV]: 'off' })).toBe(false)
    expect(hostTraceEnabled({ [HOST_TRACE_ENV]: 'please' })).toBe(false)
  })

  it('is on for the opt-in words, case- and whitespace-insensitively', () => {
    for (const value of ['1', 'true', 'yes', 'on', ' YES ', 'True']) {
      expect(runTraceEnabled({ [RUN_TRACE_ENV]: value })).toBe(true)
      expect(hostTraceEnabled({ [HOST_TRACE_ENV]: value })).toBe(true)
    }
  })

  it('gates the two families independently', () => {
    expect(runTraceEnabled({ [HOST_TRACE_ENV]: '1' })).toBe(false)
    expect(hostTraceEnabled({ [RUN_TRACE_ENV]: '1' })).toBe(false)
  })
})
