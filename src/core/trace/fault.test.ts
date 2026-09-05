import { afterEach, describe, expect, it } from 'vitest'

// The fault seam (#184): a module-level reporter that is a no-op until
// main installs a sink, and that can never raise a failure of its own —
// it is called from inside `catch` blocks whose whole point is that the
// work survives.

import { reportFault, setFaultSink, type FaultReport } from './fault'

afterEach(() => setFaultSink(null))

function collect(): FaultReport[] {
  const reports: FaultReport[] = []
  setFaultSink((report) => reports.push(report))
  return reports
}

describe('reportFault', () => {
  it('does nothing at all with no sink installed', () => {
    expect(() => reportFault('voice.stt', new Error('boom'))).not.toThrow()
  })

  it('reports an Error with its message and stack', () => {
    const reports = collect()
    const error = new Error('transcribe failed')
    reportFault('voice.stt.transcribe', error)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ kind: 'fault', site: 'voice.stt.transcribe', message: 'transcribe failed' })
    expect(reports[0]?.stack).toBe(error.stack)
  })

  it('describes a thrown value that is not an Error, and carries no stack', () => {
    const reports = collect()
    reportFault('vision.capture', 'screen went away')
    reportFault('vision.encode', { code: 7 })
    expect(reports.map((report) => report.message)).toEqual(['screen went away', '[object Object]'])
    expect(reports.every((report) => report.stack === undefined)).toBe(true)
  })

  it('carries the identities the caller had in hand, and only those', () => {
    const reports = collect()
    reportFault('pipeline.tool', new Error('x'), { turnId: 'turn-9' })
    expect(reports[0]).toMatchObject({ turnId: 'turn-9' })
    expect(reports[0]?.runId).toBeUndefined()
    expect(reports[0]?.sessionId).toBeUndefined()
  })

  it('swallows a sink that throws — a fault report never raises a second fault', () => {
    setFaultSink(() => {
      throw new Error('logs dir is gone')
    })
    expect(() => reportFault('anywhere', new Error('boom'))).not.toThrow()
  })

  it('goes quiet again when the sink is cleared', () => {
    const reports = collect()
    setFaultSink(null)
    reportFault('anywhere', new Error('boom'))
    expect(reports).toEqual([])
  })
})
