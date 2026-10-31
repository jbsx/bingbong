import { join } from 'node:path'

// The opt-in gates `pnpm gates` runs once each (#544). Left out on purpose: the
// paid ones (applianceVerbs, mediaOps live, applianceSpeed, sttCorpus), on the
// owner's word; voiceChain, which needs a folder of utterance dumps and a wake
// model; and musicThrottle, a measure with a chosen rate and no pass bar (#552).
// A gate's own variable is all that tells it to run;
// e2e/bin/no-network.sh reads the same variables, so a live gate reaches its host
// and every other gate has no route out.

export interface Gate {
  name: string
  file: string
  /** What switches the gate on; a measuring gate writes its numbers under `dir`. */
  env(dir: string): Record<string, string>
}

const measuring = (name: string, variable: string, file: string): Gate => ({ name, file, env: (dir) => ({ [variable]: join(dir, `${name}.json`) }) })

export const GATES: readonly Gate[] = [
  measuring('idleCpu', 'BINGBONG_IDLE_CPU', 'e2e/idleCpu.e2e.test.ts'),
  measuring('paneTiming', 'BINGBONG_PANE_TIMING', 'e2e/paneTiming.e2e.test.ts'),
  measuring('earCapture', 'BINGBONG_EAR_CPU', 'e2e/earCapture.e2e.test.ts'),
  { name: 'youtube', file: 'e2e/youtube.e2e.test.ts', env: () => ({ BINGBONG_YOUTUBE_E2E: '1' }) },
  { name: 'music', file: 'e2e/music.e2e.test.ts', env: () => ({ BINGBONG_YOUTUBE_E2E: '1' }) },
  measuring('playTiming', 'BINGBONG_PLAY_TIMING', 'e2e/playTiming.e2e.test.ts'),
  { name: 'speechEcho', file: 'e2e/speechEcho.e2e.test.ts', env: (dir) => ({ BINGBONG_SPEECH_ECHO: '1', BINGBONG_SPEECH_ECHO_OUT: join(dir, 'speechEcho.json') }) },
]

/** Every variable that switches a gate on or changes what it measures, the paid gates' too, which no-network.sh also reads as live. */
const GATE_VARIABLE = /^BINGBONG_(YOUTUBE_E2E|PLAY_TIMING|IDLE_CPU|PANE_TIMING|EAR_|SPEECH_ECHO|APPLIANCE_LIVE|MEDIA_OPS_LIVE|APPLIANCE_SPEED)/

/** A gate's whole environment: the caller's, less whatever the caller left set for some other run, plus its own. */
export function gateEnv(gate: Gate, dir: string, caller: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(caller).filter(([name]) => !GATE_VARIABLE.test(name))), ...gate.env(dir) }
}

/** The part of vitest's JSON report a verdict reads. */
export interface VitestReport {
  testResults: {
    /** Set when the file itself failed: a hook, or an import. */
    message?: string
    assertionResults: { status: string; fullName: string; failureMessages?: string[] | null }[]
  }[]
}

export interface GateVerdict {
  green: boolean
  passed: number
  failed: number
  skipped: number
  why?: string
}

const firstLine = (text: string): string => text.split('\n')[0].trim()

/** The error under vitest's first FAIL heading: where a describe-level hook's failure is, as the report holds none. */
function firstFailureInLog(log: string): string | undefined {
  const lines = log.replace(/\u001b\[[0-9;]*m/g, '').split('\n')
  const heading = lines.findIndex((line) => line.trim().startsWith('FAIL '))
  return heading < 0 ? undefined : lines.slice(heading + 1).find((line) => line.trim() !== '')?.trim()
}

/**
 * Whether a gate's one run held. Green only when every test ran and passed: an opt-in gate whose variable or tool went
 * missing skips and exits 0, the very way these gates rotted unseen, so a skip is red.
 */
export function gateVerdict(report: VitestReport | null, exit: { code: number | null; timedOut: boolean }, log = ''): GateVerdict {
  const tests = report?.testResults.flatMap((file) => file.assertionResults) ?? []
  const count = (status: string): number => tests.filter((test) => test.status === status).length
  const passed = count('passed')
  const failedTests = tests.filter((test) => test.status === 'failed')
  const failed = failedTests.length
  const skipped = tests.length - passed - failed
  const counts = { passed, failed, skipped }
  if (exit.timedOut) return { green: false, ...counts, why: 'timed out' }
  if (report === null) return { green: false, ...counts, why: `no report, exit ${String(exit.code)}` }
  const first = failedTests[0]
  if (first) {
    const error = first.failureMessages?.[0]
    return { green: false, ...counts, why: error ? `${first.fullName}: ${firstLine(error)}` : first.fullName }
  }
  const broken = report.testResults.find((file) => file.message)?.message
  if (broken) return { green: false, ...counts, why: firstLine(broken) }
  if (exit.code !== 0) return { green: false, ...counts, why: firstFailureInLog(log) ?? `exit ${String(exit.code)}` }
  if (skipped > 0) return { green: false, ...counts, why: `${skipped} skipped` }
  if (passed === 0) return { green: false, ...counts, why: 'no tests' }
  return { green: true, ...counts }
}

/** One gate's line. */
export function gateLine(name: string, verdict: GateVerdict, seconds: number): string {
  const line = `${verdict.green ? 'PASS' : 'FAIL'} ${name}: ${verdict.passed} passed, ${verdict.failed} failed, ${verdict.skipped} skipped, ${Math.round(seconds)} s`
  return verdict.why ? `${line}: ${verdict.why.replace(/\s*\n\s*/g, ' ')}` : line
}
