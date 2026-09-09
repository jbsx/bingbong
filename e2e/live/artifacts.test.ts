import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  archiveFamilyOf,
  archiveLogFile,
  archiveLogsDir,
  claimCaptureDir,
  digestOf,
  parseJsonl,
  promptIdentity,
  readCaptureSet,
  readSessionCapture,
  redactText,
  validateCaptureSet,
  validateSessionCapture,
  verifyArtifacts,
  writeCaptureSet,
  writeSessionCapture,
} from './artifacts.ts'
import {
  LIVE_CAPTURE_SCHEMA_VERSION,
  LIVE_CAPTURE_SET_KIND,
  LIVE_SESSION_CAPTURE_KIND,
  type LiveCaptureSet,
  type LiveLaunchProvenance,
  type LiveMetrics,
  type LiveSessionCapture,
} from './types.ts'

// The durable-file half of the contract (#224): launch-free, so these
// tests never start Electron. They pin the four behaviours a later
// reader relies on — a torn JSONL tail keeps every earlier record, secrets
// never reach a file, only allowlisted families are copied, and an
// identity is never reused.

const launch: LiveLaunchProvenance = {
  mode: 'verification',
  commit: 'abc123',
  dirtyTree: false,
  dirtyPaths: [],
  platform: { node: 'v22', os: 'linux', electron: null },
  roles: {
    orchestrator: { configured: false, reason: 'scripted (BINGBONG_LLM_SCRIPT)' },
    subagent: { configured: false, reason: 'unconfigured' },
    vision: { configured: false, reason: 'unconfigured' },
  },
  reasoningEffortOverride: null,
  effortOverrides: {},
  envFile: { path: 'env-file-not-set', present: false, digest: null },
  settings: { source: 'defaults', digest: digestOf('{}'), adblockEnabled: true, webZoomPercent: 130, appearance: 'system', sttModel: 'small', routingOverrides: false },
  adblock: { lists: 'override', listsOverride: 'http://127.0.0.1:1/adblock-list', resourcesOverride: '' },
  scriptedHooks: ['BINGBONG_LLM_SCRIPT'],
  wakeMonitoring: 'off',
  traceFlags: { runTrace: true, hostTrace: true },
  profile: { seed: 'fresh_benchmark', downloadsDir: 'benchmark_owned' },
  accessGuard: true,
}

const metrics: LiveMetrics = {
  answerBoundary: 'event_publication',
  acceptedAt: { status: 'observed', value: 1000 },
  finalAnswerAt: { status: 'observed', value: 1500 },
  terminalAt: { status: 'observed', value: 2000 },
  answerLatencyMs: { status: 'observed', value: 500 },
  runDurationMs: { status: 'observed', value: 1000 },
  userWaitMs: { status: 'observed', value: 0 },
  waits: [],
  speech: {
    inputLatencyMs: { status: 'not_applicable', reason: 'typed' },
    synthesis: { status: 'unavailable', reason: 'no span' },
    playback: { status: 'unavailable', reason: 'no span' },
  },
  outcome: 'done',
  resolution: 'completed',
  finalizationCause: null,
  deterministicAnswer: false,
  effortTier: 'lookup',
  deadlineTierEscalations: 0,
  counts: { llmSpans: 1, llmRetries: 0, toolCalls: 0, toolSpans: 0, visionRequests: 0, workersFinalized: 0, errors: 0 },
  usage: {
    orchestrator: { status: 'unavailable', reason: 'none' },
    subagent: { status: 'not_applicable', reason: 'none' },
    vision: { status: 'unavailable', reason: 'none' },
  },
  coverage: { events: 3, traceRecords: 0, llmRoundRecords: 0, truncatedToolResults: 0, perfRecords: 1 },
}

const prompt = promptIdentity('v1', 'find a pizza place')

function sessionCapture(overrides: Partial<LiveSessionCapture> = {}): LiveSessionCapture {
  return {
    kind: LIVE_SESSION_CAPTURE_KIND,
    schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
    captureId: 'cap-1',
    huntId: 'hunt-1',
    mode: 'verification',
    startedAt: '2026-09-09T00:00:00.000Z',
    closedAt: '2026-09-09T00:01:00.000Z',
    launch,
    attempts: [
      {
        kind: 'attempt',
        attemptId: 'a1',
        huntId: 'hunt-1',
        stepId: 'initial',
        order: 0,
        relation: 'initial',
        command: { text: 'find a pizza place', prompt },
        dispatch: { requestedAt: '2026-09-09T00:00:01.000Z', submitResult: 'submitted', cursor: 0 },
        accepted: {
          status: 'observed',
          value: { at: 1000, text: 'find a pizza place', turnId: 't1', runId: 'r1', sessionId: 's1', sessionGeneration: 1, submissionId: 'sub1' },
        },
        finalAnswer: { status: 'observed', value: { at: 1500, text: 'Pizza A', turnId: 't1', deterministic: false } },
        terminal: { status: 'observed', value: { at: 2000, turnId: 't1', outcome: 'done', resolution: 'completed', finalizationCause: null } },
        settlement: { status: 'observed', value: '2026-09-09T00:00:03.000Z' },
        stop: { at: '2026-09-09T00:00:03.000Z', reason: 'terminal' },
        waits: [],
        anomalies: [],
        continuation: { ready: true, reason: 'terminal seen, submit settled, no open wait, Session live', checkedAt: '2026-09-09T00:00:03.000Z' },
        bounds: { acceptanceMs: 30_000, attemptMs: 1_200_000, drainMs: 15_000, abortMs: 60_000 },
        metrics,
        events: null,
      },
      {
        kind: 'not_reached',
        attemptId: 'a2',
        huntId: 'hunt-1',
        stepId: 'follow_up',
        order: 1,
        relation: 'revised_objective',
        parentAttemptId: 'a1',
        command: { text: 'and the second one?', prompt: promptIdentity('v1', 'and the second one?') },
        reason: 'the Session ended before the follow-up could be dispatched',
        decidedAt: '2026-09-09T00:00:04.000Z',
      },
    ],
    artifacts: [],
    closeState: 'closed',
    errors: [],
    retention: { complete: true, note: null },
    ...overrides,
  }
}

describe('parseJsonl', () => {
  it('keeps every valid record before a torn tail and reports the tail', () => {
    const parsed = parseJsonl('{"a":1}\n{"a":2}\n{"a":3,"partial')
    expect(parsed.records).toEqual([{ a: 1 }, { a: 2 }])
    expect(parsed.tornTail).toBe(true)
    expect(parsed.malformed).toBe(0)
    expect(parsed.keptLines).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('counts a malformed middle line as malformed, not as a torn tail', () => {
    const parsed = parseJsonl('{"a":1}\nnot json\n{"a":3}\n')
    expect(parsed.records).toEqual([{ a: 1 }, { a: 3 }])
    expect(parsed.malformed).toBe(1)
    expect(parsed.tornTail).toBe(false)
  })

  it('reads a clean terminated file as complete', () => {
    const parsed = parseJsonl('{"a":1}\n')
    expect(parsed).toMatchObject({ records: [{ a: 1 }], malformed: 0, tornTail: false })
  })
})

describe('redactText', () => {
  it('replaces known secret values, longest first, and credential-bearing URL shapes', () => {
    const text = 'key sk-live-abcdef12 and sk-live-abcdef https://h.example/?api_key=zzz9&x=1 Bearer tok_1234567890 https://u:p@h.example/'
    const out = redactText(text, ['sk-live-abcdef', 'sk-live-abcdef12'])
    expect(out).not.toContain('sk-live-abcdef')
    expect(out).not.toContain('zzz9')
    expect(out).not.toContain('tok_1234567890')
    expect(out).not.toContain('u:p@')
    expect(out).toContain('[redacted]')
    expect(out).toContain('&x=1')
  })

  it('ignores secrets too short to redact safely', () => {
    expect(redactText('the id is 42', ['42'])).toBe('the id is 42')
  })
})

describe('archiving', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'live-artifacts-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('archives only diagnostic family files, redacts them, and drops a torn tail without losing earlier records', () => {
    const logs = join(root, 'logs')
    mkdirSync(logs)
    writeFileSync(join(logs, 'run-trace-1-1.jsonl'), '{"v":1,"kind":"x","msg":"key sk-secret-value-1"}\n{"v":1,"kind":"y"}\n{"v":1,"to')
    writeFileSync(join(logs, 'perf-1-1.jsonl'), '{"turnId":"t","stage":"llm","durMs":1}\n')
    writeFileSync(join(logs, 'run-trace-r1-t1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(join(logs, 'settings.json'), '{"apiKeys":{"zai":"sk-secret-value-1"}}')
    mkdirSync(join(logs, 'nested'))
    writeFileSync(join(logs, 'nested', 'run-trace-2-1.jsonl'), '{"v":1}\n')

    const captureDir = join(root, 'capture')
    const archived = archiveLogsDir(logs, captureDir, { secrets: ['sk-secret-value-1'] })

    expect(archived.failures).toEqual([])
    expect(archived.skipped).toEqual(['nested', 'settings.json'])
    const byName = Object.fromEntries(archived.artifacts.map((artifact) => [artifact.locator, artifact]))
    expect(Object.keys(byName).sort()).toEqual(['perf-1-1.jsonl', 'run-trace-1-1.jsonl', 'run-trace-r1-t1.png'])
    expect(byName['run-trace-1-1.jsonl']).toMatchObject({ family: 'run_trace', complete: false, redacted: true, note: 'torn final line dropped' })
    expect(byName['perf-1-1.jsonl']).toMatchObject({ family: 'perf', complete: true })
    expect(byName['run-trace-r1-t1.png']).toMatchObject({ family: 'screenshot', complete: true, bytes: 4 })

    const copied = readFileSync(join(captureDir, 'logs', 'run-trace-1-1.jsonl'), 'utf8')
    expect(copied.split('\n').filter((line) => line !== '')).toHaveLength(2)
    expect(copied).not.toContain('sk-secret-value-1')
    expect(copied).toContain('[redacted]')
    expect(verifyArtifacts(captureDir, sessionCapture({ artifacts: archived.artifacts }))).toEqual([])
  })

  it('refuses to archive a file outside the allowlist', () => {
    writeFileSync(join(root, 'settings.json'), '{}')
    expect(() => archiveLogFile(join(root, 'settings.json'), join(root, 'capture'))).toThrow(/not a diagnostic family file/)
    expect(archiveFamilyOf('cookies')).toBeNull()
    expect(archiveFamilyOf('host-trace-1-1.jsonl')).toBe('host_trace')
  })

  it('reports an unreadable source as a failure instead of throwing', () => {
    const logs = join(root, 'logs')
    mkdirSync(logs)
    mkdirSync(join(logs, 'perf-1-1.jsonl'))
    const archived = archiveLogsDir(logs, join(root, 'capture'))
    expect(archived.artifacts).toEqual([])
    expect(archived.skipped).toEqual(['perf-1-1.jsonl'])
  })

  it('claims a capture directory once and refuses every reuse of the identity', () => {
    const dir = claimCaptureDir(root, 'cap-1')
    writeSessionCapture(dir, sessionCapture({ closeState: 'open', closedAt: null }))
    expect(() => claimCaptureDir(root, 'cap-1')).toThrow(/refusing to reuse capture identity/)
    expect(() => claimCaptureDir(root, '../escape')).toThrow(/not a safe directory name/)
  })

  it('round-trips a session capture and a set through the validating readers', () => {
    const dir = claimCaptureDir(root, 'cap-1')
    const capture = sessionCapture()
    writeSessionCapture(dir, capture, { secrets: ['sk-nothing-here-1'] })
    const read = readSessionCapture(dir)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toEqual(capture)

    const set: LiveCaptureSet = {
      kind: LIVE_CAPTURE_SET_KIND,
      schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
      setId: 'set-1',
      study: { name: 'live-web-baseline', protocolVersion: 'v1' },
      mode: 'verification',
      createdAt: '2026-09-09T00:00:00.000Z',
      slots: capture.attempts.map(({ attemptId, huntId, stepId, order, relation, parentAttemptId, command }) => ({
        attemptId,
        huntId,
        stepId,
        order,
        relation,
        ...(parentAttemptId !== undefined ? { parentAttemptId } : {}),
        prompt: command.prompt,
      })),
      sessions: [{ captureId: 'cap-1', huntId: 'hunt-1', path: 'cap-1/capture.json' }],
      state: 'complete',
    }
    const setPath = writeCaptureSet(join(root, 'set.json'), set)
    const readSet = readCaptureSet(setPath)
    expect(readSet.ok).toBe(true)
    if (readSet.ok) {
      expect(readSet.value.set).toEqual(set)
      expect(readSet.value.sessions).toHaveLength(1)
      expect(readSet.value.sessions[0]!.ok).toBe(true)
    }
  })
})

describe('validation', () => {
  it('rejects another schema version and a release-evaluation artifact', () => {
    const wrongVersion = validateSessionCapture({ ...sessionCapture(), schemaVersion: 2 })
    expect(wrongVersion.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.errors.join('\n')).toMatch(/schemaVersion is 2/)
    const releaseReport = validateCaptureSet({ capturedAt: 'x', gitCommit: 'y', scenarios: [] })
    expect(releaseReport.ok).toBe(false)
  })

  it('rejects broken parent links and a not-reached slot that invents observations', () => {
    const orphan = validateSessionCapture(
      sessionCapture({
        attempts: [{ ...(sessionCapture().attempts[1] as Extract<LiveSessionCapture['attempts'][number], { kind: 'not_reached' }>), parentAttemptId: 'missing' }],
      }),
    )
    expect(orphan.ok).toBe(false)
    if (!orphan.ok) expect(orphan.errors.join('\n')).toMatch(/parent missing is not an earlier attempt/)

    const invented = validateSessionCapture(
      sessionCapture({
        attempts: [{ ...sessionCapture().attempts[0]!, kind: 'not_reached', reason: 'skipped' } as unknown as LiveSessionCapture['attempts'][number]],
      }),
    )
    expect(invented.ok).toBe(false)
    if (!invented.ok) expect(invented.errors.join('\n')).toMatch(/carries accepted/)
  })

  it('rejects a measured capture that carries scripted hooks or effort overrides', () => {
    const scripted = validateSessionCapture(sessionCapture({ mode: 'measured', launch: { ...launch, mode: 'measured' } }))
    expect(scripted.ok).toBe(false)
    if (!scripted.ok) expect(scripted.errors.join('\n')).toMatch(/scripted hooks/)
    const overridden = validateSessionCapture(
      sessionCapture({ mode: 'measured', launch: { ...launch, mode: 'measured', scriptedHooks: [], effortOverrides: { BINGBONG_ACTIVE_WORK_DEADLINE_MS: '1000' } } }),
    )
    expect(overridden.ok).toBe(false)
    if (!overridden.ok) expect(overridden.errors.join('\n')).toMatch(/effort overrides/)
  })

  it('rejects an artifact path that escapes the capture directory and a raw Task Success field', () => {
    const escaping = validateSessionCapture(
      sessionCapture({ artifacts: [{ path: '../../keys.md', family: 'events', digest: digestOf(''), bytes: 0, complete: true }] }),
    )
    expect(escaping.ok).toBe(false)
    const graded = validateSessionCapture(
      sessionCapture({
        attempts: [{ ...sessionCapture().attempts[0]!, metrics: { ...metrics, taskSuccess: true } } as unknown as LiveSessionCapture['attempts'][number]],
      }),
    )
    expect(graded.ok).toBe(false)
    if (!graded.ok) expect(graded.errors.join('\n')).toMatch(/no Task Success/)
  })
})
