import { describe, expect, it } from 'vitest'
import { GATES, gateLine, gateVerdict, type VitestReport } from './gates.ts'

const passed = { status: 'passed', fullName: 'the gate works', failureMessages: [] }
const skipped = { status: 'skipped', fullName: 'the gate sat out', failureMessages: [] }
const failed = { status: 'failed', fullName: 'the gate broke', failureMessages: ['Error: expected 1 to be 2\n  at somewhere'] }

function report(...tests: VitestReport['testResults'][number]['assertionResults']): VitestReport {
  return { testResults: [{ assertionResults: tests }] }
}

const exited = { code: 0, timedOut: false }

describe('gateVerdict', () => {
  it('is green when every test ran and passed', () => {
    expect(gateVerdict(report(passed, passed), exited)).toEqual({ green: true, passed: 2, failed: 0, skipped: 0 })
  })

  it('is red when vitest exits clean but every test was skipped: a gate that did not run has not passed', () => {
    expect(gateVerdict(report(skipped), exited)).toEqual({ green: false, passed: 0, failed: 0, skipped: 1, why: '1 skipped' })
  })

  it('is red when part of the gate was skipped', () => {
    expect(gateVerdict(report(passed, skipped), exited)).toEqual({ green: false, passed: 1, failed: 0, skipped: 1, why: '1 skipped' })
  })

  it('names the first failing test and the first line of its error', () => {
    expect(gateVerdict(report(passed, failed), { code: 1, timedOut: false })).toEqual({ green: false, passed: 1, failed: 1, skipped: 0, why: 'the gate broke: Error: expected 1 to be 2' })
  })

  it('names a hook that failed before any test could, which counts no test as failed', () => {
    const verdict = gateVerdict({ testResults: [{ message: 'Error: Xvfb exited with 1\n  at start', assertionResults: [skipped] }] }, { code: 1, timedOut: false })
    expect(verdict).toEqual({ green: false, passed: 0, failed: 0, skipped: 1, why: 'Error: Xvfb exited with 1' })
  })

  it('is red when the run left no report', () => {
    expect(gateVerdict(null, { code: 1, timedOut: false })).toEqual({ green: false, passed: 0, failed: 0, skipped: 0, why: 'no report, exit 1' })
  })

  it('is red when every test passed but the process exited with an error', () => {
    expect(gateVerdict(report(passed), { code: 1, timedOut: false })).toEqual({ green: false, passed: 1, failed: 0, skipped: 0, why: 'exit 1' })
  })

  it('says a run that was stopped timed out, whatever its report holds', () => {
    expect(gateVerdict(null, { code: null, timedOut: true })).toEqual({ green: false, passed: 0, failed: 0, skipped: 0, why: 'timed out' })
  })
})

describe('gateLine', () => {
  it('is one line with the name, the counts and the seconds', () => {
    expect(gateLine('idleCpu', { green: true, passed: 3, failed: 0, skipped: 0 }, 47.4)).toBe('PASS idleCpu: 3 passed, 0 failed, 0 skipped, 47 s')
  })

  it('carries why a red gate is red', () => {
    expect(gateLine('music', { green: false, passed: 7, failed: 1, skipped: 0, why: 'the gate broke' }, 120)).toBe('FAIL music: 7 passed, 1 failed, 0 skipped, 120 s: the gate broke')
  })

  it('stays one line whatever the error holds', () => {
    expect(gateLine('music', { green: false, passed: 0, failed: 1, skipped: 0, why: 'first\nsecond' }, 1)).toBe('FAIL music: 0 passed, 1 failed, 0 skipped, 1 s: first second')
  })
})

describe('GATES', () => {
  it('holds every unpaid opt-in gate the issue names, once', () => {
    expect(GATES.map((gate) => gate.name)).toEqual(['idleCpu', 'paneTiming', 'earCapture', 'youtube', 'music', 'playTiming', 'speechEcho'])
  })

  it('holds no paid gate', () => {
    const named = GATES.flatMap((gate) => [gate.file, ...Object.keys(gate.env('/tmp/out'))]).join(' ')
    expect(named).not.toMatch(/applianceVerbs|mediaOps|applianceSpeed|sttCorpus|APPLIANCE_LIVE|MEDIA_OPS_LIVE|APPLIANCE_SPEED|ELEVENLABS|JEV/)
  })
})
