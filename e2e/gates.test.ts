import { describe, expect, it } from 'vitest'
import { GATES, gateEnv, gateLine, gateVerdict, type VitestReport } from './gates.ts'

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

  it('names a file that failed by its message', () => {
    const verdict = gateVerdict({ testResults: [{ message: 'Error: cannot import\n  at start', assertionResults: [] }] }, { code: 1, timedOut: false })
    expect(verdict).toEqual({ green: false, passed: 0, failed: 0, skipped: 0, why: 'Error: cannot import' })
  })

  it('names a describe-level hook that failed from the log, since the report counts its tests as skipped and holds no error', () => {
    // As vitest 4 prints it, colours and all.
    const log = '\n RUN  v4\n\n\u001b[31m FAIL \u001b[39m e2e/music.e2e.test.ts > the Player\n\u001b[31mError: Xvfb exited with 1\u001b[39m\n ❯ e2e/music.e2e.test.ts:5:11\n'
    const verdict = gateVerdict({ testResults: [{ message: '', assertionResults: [skipped] }] }, { code: 1, timedOut: false }, log)
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

describe('gateEnv', () => {
  const youtube = GATES.find((gate) => gate.name === 'youtube')!
  const idleCpu = GATES.find((gate) => gate.name === 'idleCpu')!

  it('gives a hermetic gate no live variable the caller left set, so no-network.sh still cuts its route', () => {
    const env = gateEnv(idleCpu, '/tmp/out', { PATH: '/bin', BINGBONG_YOUTUBE_E2E: '1', BINGBONG_PLAY_TIMING: '/x', BINGBONG_APPLIANCE_LIVE: '1', BINGBONG_MEDIA_OPS_LIVE: '1', BINGBONG_APPLIANCE_SPEED: '1' })
    expect(env).toEqual({ PATH: '/bin', BINGBONG_IDLE_CPU: '/tmp/out/idleCpu.json' })
  })

  it('leaves out what would change what a gate measures', () => {
    const env = gateEnv(idleCpu, '/tmp/out', { BINGBONG_PLAY_TIMING_ADBLOCK: 'real', BINGBONG_EAR_PULSE_SERVER: '/s', BINGBONG_EAR_PULSE_PID: '1', BINGBONG_EAR_PULSE_MIC: '1' })
    expect(env).toEqual({ BINGBONG_IDLE_CPU: '/tmp/out/idleCpu.json' })
  })

  it('switches a live gate on with its own variable', () => {
    expect(gateEnv(youtube, '/tmp/out', {}).BINGBONG_YOUTUBE_E2E).toBe('1')
  })

  it('keeps the owner\'s word that this machine runs with the network', () => {
    expect(gateEnv(idleCpu, '/tmp/out', { BINGBONG_E2E_NET: '1' }).BINGBONG_E2E_NET).toBe('1')
  })
})

describe('GATES', () => {
  it('holds the unpaid opt-in gates the issue names, once', () => {
    expect(GATES.map((gate) => gate.name)).toEqual(['idleCpu', 'paneTiming', 'earCapture', 'youtube', 'music', 'playTiming', 'speechEcho'])
  })

  it('holds no paid gate', () => {
    const named = GATES.flatMap((gate) => [gate.file, ...Object.keys(gate.env('/tmp/out'))]).join(' ')
    expect(named).not.toMatch(/applianceVerbs|mediaOps|applianceSpeed|sttCorpus|APPLIANCE_LIVE|MEDIA_OPS_LIVE|APPLIANCE_SPEED|ELEVENLABS|JEV/)
  })

  it('never runs the throttle measure, a tool with no pass bar: vitest takes a gate\'s file as a substring of the path', () => {
    for (const gate of GATES) expect('e2e/musicThrottle.e2e.test.ts').not.toContain(gate.file)
  })
})
