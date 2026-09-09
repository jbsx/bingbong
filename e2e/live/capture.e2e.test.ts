import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../../src/core/ports/llm'
import { feedText } from '../feed'
import { startFixtureServer, type FixtureServer } from '../fixtureServer'
import { tracedCommands } from '../runTrace'
import { sleep, waitFor } from '../waitFor'
import { promptIdentity, readSessionCapture } from './artifacts.ts'
import { startCaptureSession, type CaptureSession } from './capture.ts'
import type { LiveAttemptCapture, LiveSessionCapture } from './types.ts'

// The capture Session at the agreed boundary (#224): the real Electron
// Prompt Bar, the app's own published events and rendered Feed, the
// profile's own storage, and the files the capture retains — all under
// Xvfb, all scripted, none of it baseline evidence. Every case is a
// no-spend verification of the runner, not of the assistant.

const prompt = (text: string) => promptIdentity('v-test', text)
const answer = (display: string, speak = 'Done.'): AssistantTurn => ({ kind: 'answer', speak, display })
const navigate = (url: string, id = 'nav'): AssistantTurn => ({ kind: 'tool_calls', calls: [{ id, name: 'navigate', args: { url } }] })

function attempt(record: Awaited<ReturnType<CaptureSession['captureCommand']>>): LiveAttemptCapture {
  if (record.kind !== 'attempt') throw new Error(`expected an attempt, got not_reached: ${record.reason}`)
  return record
}

function observedValue<T>(figure: { status: string; value?: T; reason?: string }, what: string): T {
  if (figure.status !== 'observed') throw new Error(`${what} was ${figure.status}: ${figure.reason}`)
  return figure.value as T
}

describe('live capture e2e (#224)', () => {
  let fixture: FixtureServer
  let root: string
  let sequence = 0

  beforeAll(async () => {
    fixture = await startFixtureServer()
    root = mkdtempSync(join(tmpdir(), 'live-capture-e2e-'))
  })

  afterAll(async () => {
    await fixture?.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function start(
    script: AssistantTurn[],
    options: { env?: Record<string, string | undefined>; bounds?: { attemptMs?: number; abortMs?: number; drainMs?: number }; accessGuard?: boolean } = {},
  ): Promise<CaptureSession> {
    sequence += 1
    return startCaptureSession({
      mode: 'verification',
      captureId: `cap-${sequence}`,
      huntId: 'hunt-test',
      root,
      verification: { env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script), ...options.env }, fixture },
      ...(options.bounds !== undefined ? { bounds: options.bounds } : {}),
      ...(options.accessGuard !== undefined ? { accessGuard: options.accessGuard } : {}),
    })
  }

  it('accepts by the app\'s own command event, scopes duplicate text by cursor, and retains everything after cleanup', async () => {
    const session = await start([answer('ANSWER-ONE'), answer('ANSWER-TWO')])
    let capture: LiveSessionCapture
    const text = 'find the same thing'
    try {
      const first = attempt(await session.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text, prompt: prompt(text) }))
      expect(first.dispatch.submitResult).toBe('submitted')
      const accepted = observedValue(first.accepted, 'acceptance')
      expect(accepted).toMatchObject({ text, turnId: expect.stringMatching(/^turn-/), runId: expect.any(String), sessionId: expect.any(String), submissionId: expect.any(String) })
      expect(observedValue(first.finalAnswer, 'final Answer')).toMatchObject({ text: 'ANSWER-ONE', deterministic: false })
      // A scripted Answer proposes no Resolution: null, never invented.
      expect(observedValue(first.terminal, 'terminal')).toMatchObject({ outcome: 'done', resolution: null, finalizationCause: 'model_answered' })
      expect(first.settlement.status).toBe('observed')
      expect(first.stop.reason).toBe('terminal')
      const latency = observedValue(first.metrics.answerLatencyMs, 'Answer latency')
      const duration = observedValue(first.metrics.runDurationMs, 'Run duration')
      expect(latency).toBeGreaterThanOrEqual(0)
      expect(duration).toBeGreaterThanOrEqual(latency)
      expect(first.metrics.userWaitMs).toEqual({ status: 'observed', value: 0 })
      expect(first.metrics.speech.inputLatencyMs.status).toBe('not_applicable')
      expect(first.continuation.ready).toBe(true)

      // The same text again: a fresh cursor finds the second acceptance,
      // never the first — a different Run in the same Session.
      expect(await session.continuationState()).toEqual({ ready: true })
      const second = attempt(
        await session.captureCommand({ attemptId: 'a2', stepId: 'follow_up', order: 1, relation: 'revised_objective', parentAttemptId: 'a1', text, prompt: prompt(text) }),
      )
      const acceptedAgain = observedValue(second.accepted, 'second acceptance')
      expect(second.dispatch.cursor).toBeGreaterThan(first.dispatch.cursor)
      expect(acceptedAgain.turnId).not.toBe(accepted.turnId)
      expect(acceptedAgain.runId).not.toBe(accepted.runId)
      expect(acceptedAgain.sessionId).toBe(accepted.sessionId)
      expect(observedValue(second.finalAnswer, 'second Answer').text).toBe('ANSWER-TWO')
      expect(second.metrics.spans.status).toBe('observed')
      expect(second.metrics.usage.orchestrator).toMatchObject({ status: 'unavailable' })

      await expect(session.captureCommand({ attemptId: 'a2', stepId: 'x', order: 2, relation: 'initial', text, prompt: prompt(text) })).rejects.toThrow(/already used/)
    } finally {
      capture = await session.close()
    }

    expect(capture.closeState).toBe('closed')
    expect(capture.retention).toEqual({ complete: true, note: null })
    expect(capture.attempts).toHaveLength(2)
    const families = new Set(capture.artifacts.map((artifact) => artifact.family))
    expect([...families].sort()).toEqual(expect.arrayContaining(['events', 'perf', 'run_trace']))
    const read = readSessionCapture(session.captureDir)
    expect(read.ok, JSON.stringify(read)).toBe(true)
    // The disposable profile is gone; the capture holds no profile files.
    expect(existsSync(capture.launch.envFile.path)).toBe(false)
    const retained = readdirSync(session.captureDir).sort()
    expect(retained).toEqual(expect.arrayContaining(['capture.json', 'events', 'logs']))
    expect(retained.filter((name) => !['capture.json', 'events', 'logs', 'stderr.txt', 'usage.json'].includes(name))).toEqual([])
    expect(readdirSync(join(session.captureDir, 'logs')).some((name) => /^(Cookies|settings\.json|Local Storage)$/.test(name))).toBe(false)
    const tape = JSON.parse(readFileSync(join(session.captureDir, 'events', 'a1.json'), 'utf8')) as { events: { type: string }[] }
    expect(tape.events.map((event) => event.type)).toEqual(expect.arrayContaining(['command', 'display', 'done']))
  }, 120_000)

  it('starts every independent hunt from the same clean profile: no cookies, no storage, no Session evidence from the last', async () => {
    let sessionA: string | undefined
    let digestA: string | undefined
    const a = await start([navigate(fixture.url('/set-cookie')), answer('MARKER-A')])
    try {
      const first = attempt(await a.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'plant a cookie', prompt: prompt('plant a cookie') }))
      sessionA = observedValue(first.accepted, 'acceptance').sessionId
      await a.harness!.paneEval(`localStorage.setItem('live-probe', 'from hunt A')`)
      expect(await a.harness!.paneEval<string>('document.cookie')).toContain('bb_profile=persisted')
      expect(await feedText(a.harness!)).toContain('MARKER-A')
    } finally {
      digestA = (await a.close()).launch.settings.digest
    }

    const b = await start([navigate(fixture.url('/cookie-echo')), answer('MARKER-B')])
    try {
      const first = attempt(await b.captureCommand({ attemptId: 'b1', stepId: 'initial', order: 0, relation: 'initial', text: 'read the cookie', prompt: prompt('read the cookie') }))
      expect(observedValue(first.accepted, 'acceptance').sessionId).not.toBe(sessionA)
      expect(await b.harness!.paneEval<string>('document.cookie')).toBe('')
      expect(await b.harness!.paneEval<string | null>(`localStorage.getItem('live-probe')`)).toBeNull()
      const feed = await feedText(b.harness!)
      expect(feed).toContain('MARKER-B')
      expect(feed).not.toContain('MARKER-A')
      expect(tracedCommands(b.harness!.readRunTrace())).toEqual(['read the cookie'])
    } finally {
      const capture = await b.close()
      expect(capture.launch.settings.digest).toBe(digestA)
      expect(capture.launch.profile).toEqual({ seed: 'fresh_benchmark', downloadsDir: 'benchmark_owned' })
    }
  }, 120_000)

  it('delivers the follow-up on the same handle after a wrong Answer, and after a mechanically failed but settled Run', async () => {
    // One scripted Answer, then the script is exhausted: the second Run
    // fails on its first model call — still a settled Run in the same
    // Session, still accepted, still retained with its screenshot.
    const session = await start([answer('WRONG ANSWER')])
    let capture: LiveSessionCapture
    try {
      const first = attempt(await session.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'first', prompt: prompt('first') }))
      expect(observedValue(first.finalAnswer, 'Answer').text).toBe('WRONG ANSWER')
      // No grading gate: the follow-up goes in whatever the Answer said.
      const second = attempt(
        await session.captureCommand({ attemptId: 'a2', stepId: 'follow_up', order: 1, relation: 'revised_objective', parentAttemptId: 'a1', text: 'second', prompt: prompt('second') }),
      )
      expect(observedValue(second.accepted, 'acceptance').sessionId).toBe(observedValue(first.accepted, 'acceptance').sessionId)
      expect(observedValue(second.terminal, 'terminal').outcome).toBe('failed')
      expect(second.settlement.status).toBe('observed')
      expect(second.metrics.counts.errors).toBeGreaterThan(0)
      // A third command still finds the Session mechanically ready — the
      // failed Run settled; nothing is gated on correctness.
      expect(await session.continuationState()).toEqual({ ready: true })
    } finally {
      capture = await session.close()
    }
    expect(capture.artifacts.some((artifact) => artifact.family === 'screenshot')).toBe(true)
    expect(capture.retention.complete).toBe(true)
  }, 120_000)

  it('refuses a follow-up while help is awaited, rejects a concurrent dispatch, and keeps a timed-out attempt', async () => {
    const session = await start([{ kind: 'tool_calls', calls: [{ id: 'ask', name: 'ask_user', args: { question: 'Which city?' } }] }], {
      env: { BINGBONG_ASK_TIMEOUT_MS: '120000' },
      bounds: { attemptMs: 8_000, abortMs: 30_000 },
    })
    let capture: LiveSessionCapture
    try {
      const pending = session.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'ask me', prompt: prompt('ask me') })
      await waitFor(async () => (await session.harness!.dashboardEval<boolean>(`!!document.querySelector('.ask-card')`)) || undefined, { timeoutMs: 20_000, intervalMs: 200 })
      expect(await session.continuationState()).toMatchObject({ ready: false, reason: 'awaiting_help' })
      await expect(session.captureCommand({ attemptId: 'a2', stepId: 'follow_up', order: 1, relation: 'revised_objective', parentAttemptId: 'a1', text: 'x', prompt: prompt('x') })).rejects.toThrow(
        /already in flight/,
      )
      const first = attempt(await pending)
      expect(first.stop.reason).toBe('attempt_timeout')
      expect(first.waits).toHaveLength(1)
      expect(first.waits[0]).toMatchObject({ kind: 'ask' })
      expect(first.finalAnswer.status).toBe('unavailable')
      expect(first.metrics.answerLatencyMs.status).toBe('unavailable')
      // The one abort landed: the Run reached a terminal, and nothing was invented for it.
      expect(observedValue(first.terminal, 'terminal').outcome).toBe('cancelled')
      expect(first.metrics.userWaitMs.status).not.toBe('invalid')
    } finally {
      capture = await session.close()
    }
    expect(capture.attempts[0]).toMatchObject({ kind: 'attempt', stop: { reason: 'attempt_timeout' } })
    expect(capture.retention.complete).toBe(true)
  }, 120_000)

  it('marks a lost Session not reached — no submission, no fresh Session, no coaching', async () => {
    const session = await start([answer('FIRST'), answer('NEVER SENT')], { env: { BINGBONG_SESSION_WINDOW_MS: '3000', BINGBONG_SESSION_WARNING_MS: '1500' } })
    try {
      const first = attempt(await session.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'first', prompt: prompt('first') }))
      expect(observedValue(first.finalAnswer, 'Answer').text).toBe('FIRST')
      // Let the Session Window lapse: the app ends the Session itself.
      await waitFor(
        async () => (await session.harness!.dashboardEval<boolean>(`(window.__liveTape ?? []).some((e) => e.type === 'session_ended')`)) || undefined,
        { timeoutMs: 15_000, intervalMs: 250 },
      )
      const state = await session.continuationState()
      expect(state.ready).toBe(false)
      if (!state.ready) expect(['session_unavailable', 'session_lost']).toContain(state.reason)
      const second = await session.captureCommand({ attemptId: 'a2', stepId: 'follow_up', order: 1, relation: 'revised_objective', parentAttemptId: 'a1', text: 'second', prompt: prompt('second') })
      expect(second.kind).toBe('not_reached')
      if (second.kind === 'not_reached') expect(second.reason).toMatch(/session/)
      expect(tracedCommands(session.harness!.readRunTrace())).toEqual(['first'])
    } finally {
      await session.close()
    }
  }, 120_000)

  it('reads the marked final Answer card before a delayed Run completion, at the event\'s own stamp', async () => {
    // The TTS seam delays `done` deterministically: a fake piper that
    // sleeps three seconds, with a stub voice so the synthesizer reaches
    // it. No production sleep, no timing guess.
    const seam = mkdtempSync(join(tmpdir(), 'live-fake-piper-'))
    writeFileSync(join(seam, 'test-voice.onnx'), '')
    writeFileSync(join(seam, 'test-voice.onnx.json'), '{}')
    const piper = join(seam, 'piper')
    writeFileSync(piper, '#!/bin/sh\nsleep 3\nexit 1\n')
    chmodSync(piper, 0o755)
    const session = await start([answer('DELAYED-ANSWER', 'Here it is.')], {
      env: { BINGBONG_PIPER_BIN: piper, BINGBONG_PIPER_VOICE_DIR: seam, BINGBONG_PIPER_VOICE: 'test-voice' },
    })
    try {
      const pending = session.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'answer slowly', prompt: prompt('answer slowly') })
      const card = await waitFor(
        async () =>
          session.harness!.overlayEval<{ at: string | null; doneSeen: boolean } | null>(`(() => {
            const el = [...document.querySelectorAll('.feed-entry--display[data-event-at]')].find((e) => e.textContent.includes('DELAYED-ANSWER'))
            return el ? { at: el.getAttribute('data-event-at'), doneSeen: false } : null
          })()`).then((found) => found ?? undefined),
        { timeoutMs: 20_000, intervalMs: 100 },
      )
      // Seen in the Feed while the Run is still finishing.
      const doneYet = await session.harness!.dashboardEval<boolean>(`(window.__liveTape ?? []).some((e) => e.type === 'done')`)
      expect(doneYet).toBe(false)
      const first = attempt(await pending)
      const finalAnswer = observedValue(first.finalAnswer, 'Answer')
      expect(finalAnswer.text).toBe('DELAYED-ANSWER')
      expect(Number(card.at)).toBe(finalAnswer.at)
      const terminal = observedValue(first.terminal, 'terminal')
      expect(terminal.at - finalAnswer.at).toBeGreaterThanOrEqual(2_500)
      expect(observedValue(first.metrics.runDurationMs, 'duration') - observedValue(first.metrics.answerLatencyMs, 'latency')).toBeGreaterThanOrEqual(2_500)
      expect(first.metrics.answerBoundary).toBe('event_publication')
    } finally {
      await session.close()
      rmSync(seam, { recursive: true, force: true })
    }
  }, 120_000)

  it('keeps evaluator material out of measured browsing: a private file is refused with the guard, and only with the guard', async () => {
    const privateDir = mkdtempSync(join(tmpdir(), 'live-private-'))
    const keyFile = join(privateDir, 'keys.md')
    const canary = 'CANARY-KEY-7f3a-must-not-leak'
    writeFileSync(keyFile, `# evaluator key\n${canary}\n`)
    const fileUrl = `file://${keyFile}`

    const guarded = await start([navigate(fileUrl), answer('LOOKED')])
    try {
      const first = attempt(await guarded.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'read the keys', prompt: prompt('read the keys') }))
      expect(observedValue(first.finalAnswer, 'Answer').text).toBe('LOOKED')
      const body = await guarded.harness!.paneEval<string>('document.body.innerText')
      expect(body).not.toContain(canary)
      expect(body).toContain('measurement access guard')
      expect(JSON.stringify(guarded.harness!.readRunTrace())).not.toContain(canary)
    } finally {
      const capture = await guarded.close()
      expect(capture.launch.accessGuard).toBe(true)
      expect(readFileSync(join(guarded.captureDir, 'events', 'a1.json'), 'utf8')).not.toContain(canary)
    }

    // Without the guard the same load succeeds: production behaviour is
    // unchanged, and the guard is what closed the route above.
    const open = await start([navigate(fileUrl), answer('LOOKED')], { accessGuard: false })
    try {
      attempt(await open.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'read the keys', prompt: prompt('read the keys') }))
      expect(await open.harness!.paneEval<string>('document.body.innerText')).toContain(canary)
    } finally {
      const capture = await open.close()
      expect(capture.launch.accessGuard).toBe(false)
      rmSync(privateDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('retains no secret and no profile: a known secret value is redacted from every file, and the profile never enters the capture', async () => {
    const secret = 'canary-secret-token-value-9x'
    const session = await start([answer(`the token is ${secret}`)], { env: { BINGBONG_TEST_SECRET_TOKEN: secret } })
    let capture: LiveSessionCapture
    try {
      const first = attempt(await session.captureCommand({ attemptId: 'a1', stepId: 'initial', order: 0, relation: 'initial', text: 'say the secret', prompt: prompt('say the secret') }))
      expect(observedValue(first.finalAnswer, 'Answer').text).toContain(secret)
    } finally {
      capture = await session.close()
    }
    const files = walk(session.captureDir)
    expect(files.length).toBeGreaterThan(2)
    for (const file of files) {
      if (file.endsWith('.png')) continue
      expect(readFileSync(file, 'utf8'), file).not.toContain(secret)
    }
    expect(files.some((file) => /settings\.json$|Cookies$|Local Storage/.test(file))).toBe(false)
    expect(readFileSync(join(session.captureDir, 'capture.json'), 'utf8')).not.toMatch(/apiKey"\s*:\s*"[^"]+/)
    expect(capture.launch.roles.orchestrator).toEqual({ configured: false, reason: 'verification mode: scripted (BINGBONG_LLM_SCRIPT)' })
    expect(capture.launch.scriptedHooks).toContain('BINGBONG_LLM_SCRIPT')
  }, 120_000)

  it('refuses to reuse a capture identity before launching anything', async () => {
    mkdirSync(join(root, 'cap-taken'))
    await expect(
      startCaptureSession({ mode: 'verification', captureId: 'cap-taken', huntId: 'hunt-test', root, verification: { env: { BINGBONG_LLM_SCRIPT: '[]' }, fixture } }),
    ).rejects.toThrow(/refusing to reuse capture identity/)
    await sleep(10)
  })
})

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
}
