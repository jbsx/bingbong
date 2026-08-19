import { describe, expect, it } from 'vitest'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import { createPerfTracer } from './perfTracer'
import { withPerfTracing } from './perfTracing'
import { fakePerfHarness } from '../testing/doubles'

// The #29 wrapper seam: one `llm` span per round keyed by the request's
// turn id, plus one `llm-retry` event per attempt the client reports —
// a tripled round-trip shows up as attempts instead of hiding inside one
// inflated span. Tested against a fake underlying client, never the wire.

const ANSWER: AssistantTurn = { kind: 'answer', speak: 'Done.', display: 'Done.' }

/** A fake underlying client: scripts elapsed time, retry reports, and the outcome. */
class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = []

  constructor(
    private readonly state: { monotonicMs: number },
    private readonly behave: (request: LlmRequest) => AssistantTurn,
  ) {}

  async complete(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request)
    return this.behave(request)
  }

  advance(ms: number): void {
    this.state.monotonicMs += ms
  }
}

describe('withPerfTracing', () => {
  it('records one llm span per successful round, keyed by the request turn id', async () => {
    const { records, state, tracer } = fakePerfHarness()
    state.monotonicMs = 1_000
    const client = new FakeLlm(state, () => {
      state.monotonicMs += 450
      return ANSWER
    })
    const traced = withPerfTracing(client, tracer)

    const turn = await traced.complete({ command: 'open youtube', toolResults: [], turnId: 'turn-1' })

    expect(turn).toBe(ANSWER)
    expect(records).toEqual([
      { turnId: 'turn-1', stage: 'llm', durMs: 450, at: 1_700_000_000_000, t: 1_450 },
    ])
  })

  it('records one llm-retry event per reported retry attempt, attempt number in detail', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const client = new FakeLlm(state, (request) => {
      request.onRetryAttempt?.(2, 3)
      state.monotonicMs += 100
      request.onRetryAttempt?.(3, 3)
      state.monotonicMs += 100
      return ANSWER
    })
    const traced = withPerfTracing(client, tracer)

    await traced.complete({ command: 'x', toolResults: [], turnId: 'turn-7' })

    expect(records).toEqual([
      { turnId: 'turn-7', stage: 'llm-retry', durMs: 0, at: 1_700_000_000_000, t: 0, detail: { attempt: 2, maxAttempts: 3 } },
      { turnId: 'turn-7', stage: 'llm-retry', durMs: 0, at: 1_700_000_000_000, t: 100, detail: { attempt: 3, maxAttempts: 3 } },
      { turnId: 'turn-7', stage: 'llm', durMs: 200, at: 1_700_000_000_000, t: 200 },
    ])
  })

  it('chains a caller-supplied onRetryAttempt instead of clobbering it', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const seenAttempts: [number, number][] = []
    const client = new FakeLlm(state, (request) => {
      request.onRetryAttempt?.(2, 3)
      return ANSWER
    })
    const traced = withPerfTracing(client, tracer)

    await traced.complete({
      command: 'x',
      toolResults: [],
      turnId: 'turn-3',
      onRetryAttempt: (attempt, maxAttempts) => seenAttempts.push([attempt, maxAttempts]),
    })

    // The caller's hook still fires with the full pair (the wrapper must
    // not drop it or the ceiling) and the retry is recorded under the
    // same chain.
    expect(seenAttempts).toEqual([[2, 3]])
    expect(records).toEqual([
      { turnId: 'turn-3', stage: 'llm-retry', durMs: 0, at: 1_700_000_000_000, t: 0, detail: { attempt: 2, maxAttempts: 3 } },
      { turnId: 'turn-3', stage: 'llm', durMs: 0, at: 1_700_000_000_000, t: 0 },
    ])
  })

  it('records under a custom stage and derives its retry stage from it', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const client = new FakeLlm(state, (request) => {
      state.monotonicMs += 250
      request.onRetryAttempt?.(2, 3)
      return ANSWER
    })
    const traced = withPerfTracing(client, tracer, 'subagent-llm')

    await traced.complete({ command: 'x', toolResults: [], turnId: 'turn-4' })

    expect(records).toEqual([
      { turnId: 'turn-4', stage: 'subagent-llm-retry', durMs: 0, at: 1_700_000_000_000, t: 250, detail: { attempt: 2, maxAttempts: 3 } },
      { turnId: 'turn-4', stage: 'subagent-llm', durMs: 250, at: 1_700_000_000_000, t: 250 },
    ])
  })

  it('still records the llm span when the round fails — the time was spent', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const client = new FakeLlm(state, () => {
      state.monotonicMs += 900
      throw new Error('orchestrator returned an empty completion')
    })
    const traced = withPerfTracing(client, tracer)

    await expect(traced.complete({ command: 'x', toolResults: [], turnId: 'turn-9' })).rejects.toThrow(/empty completion/)

    expect(records).toEqual([
      { turnId: 'turn-9', stage: 'llm', durMs: 900, at: 1_700_000_000_000, t: 900 },
    ])
  })

  it('passes the request through untouched when it carries no turn id', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const client = new FakeLlm(state, (request) => {
      request.onRetryAttempt?.(2, 3) // a hook the wrapper never installed stays silent
      return ANSWER
    })
    const traced = withPerfTracing(client, tracer)

    const request: LlmRequest = { command: 'x', toolResults: [] }
    await traced.complete(request)

    expect(records).toEqual([])
    expect(client.requests[0]).toBe(request)
  })

  it('never breaks a round over bookkeeping — a throwing sink is swallowed', async () => {
    const { state } = fakePerfHarness()
    const throwingTracer = withPerfTracing(
      new FakeLlm(state, () => ANSWER),
      createPerfTracer({
        clock: { monotonic: () => state.monotonicMs, wall: () => state.wallMs },
        sink: {
          write() {
            throw new Error('disk full')
          },
        },
      }),
    )

    const turn = await throwingTracer.complete({ command: 'x', toolResults: [], turnId: 'turn-1' })

    expect(turn).toBe(ANSWER)
  })

  it('a throwing sink never masks the round’s own failure', async () => {
    const { state } = fakePerfHarness()
    const throwingTracer = withPerfTracing(
      new FakeLlm(state, () => {
        throw new Error('orchestrator returned an empty completion')
      }),
      createPerfTracer({
        clock: { monotonic: () => state.monotonicMs, wall: () => state.wallMs },
        sink: {
          write() {
            throw new Error('disk full')
          },
        },
      }),
    )

    await expect(throwingTracer.complete({ command: 'x', toolResults: [], turnId: 'turn-1' })).rejects.toThrow(
      /empty completion/,
    )
  })
})
