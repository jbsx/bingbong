import { describe, expect, it } from 'vitest'
import type { VisionAttemptObservation, VisionDescribeRequest, VisionLocateRequest } from '../../core/ports/vision'
import { AUTO_VISION_DESCRIBE_MS, VisionDeadlineError } from '../../core/ports/vision'
import { createZaiVisionApi, DESCRIBE_MAX_TOKENS, DESCRIBE_TIMEOUT_MS, LOCATE_MAX_TOKENS, resolveVisionTimeouts } from './createZaiVisionApi'

const locateRequest: VisionLocateRequest = {
  image: new Uint8Array([1, 2, 3]),
  target: 'the play button in the thumbnail',
  viewport: { width: 800, height: 600, scrollY: 0, scrollHeight: 600 },
}

const describeRequest: VisionDescribeRequest = {
  image: new Uint8Array([4, 5, 6]),
  prompt: 'Describe anything blocking progress.',
}

const configuredEnv = {
  BINGBONG_VISION_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
  BINGBONG_VISION_MODEL: 'GLM-4.6V',
  ZAI_API_KEY: 'secret-value',
}

interface CapturedRequest {
  url: string
  init: RequestInit
}

/** One SSE frame carrying a chat-completions chunk. */
function sseChunk(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
}

const SSE_DONE = 'data: [DONE]\n\n'

function sseResponse(frames: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

/** A completed streamed answer: content deltas, then the DONE frame. */
function okResponse(content: string): Response {
  return sseResponse([sseChunk({ role: 'assistant' }), sseChunk({ content }), SSE_DONE])
}

/** Frames arrive on a schedule — the slow-but-generating shape (ADR 0016). */
function timedSseResponse(frames: { afterMs: number; data: string }[]): Response {
  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        for (const frame of frames) {
          await new Promise((resolve) => setTimeout(resolve, frame.afterMs))
          controller.enqueue(encoder.encode(frame.data))
        }
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('createZaiVisionApi', () => {
  it('resolveVisionTimeouts: 15s/60s caps with an 8s first-token window, seconds-based env scaling with plausible bounds', () => {
    expect(resolveVisionTimeouts({})).toEqual({ describeMs: 15_000, locateMs: 60_000, firstTokenMs: 8_000 })
    // The override scales both whole-Look caps; the first-token window
    // shrinks with a lowered Describe cap but never grows past its default.
    expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: '2' })).toEqual({
      describeMs: 2_000,
      locateMs: 8_000,
      firstTokenMs: 2_000,
    })
    expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: '45' })).toEqual({
      describeMs: 45_000,
      locateMs: 180_000,
      firstTokenMs: 8_000,
    })
    // Non-numeric, zero, negative: defaults.
    for (const raw of ['soon', '0', '-5']) {
      expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: raw })).toEqual({
        describeMs: 15_000,
        locateMs: 60_000,
        firstTokenMs: 8_000,
      })
    }
    // Implausibly large (a legacy milliseconds value like 30000) is rejected to defaults.
    expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: '30000' })).toEqual({
      describeMs: 15_000,
      locateMs: 60_000,
      firstTokenMs: 8_000,
    })
  })

  it('fails a hung (never-answering) call at time-to-first-token, aborting the request', async () => {
    let observedSignal: AbortSignal | undefined
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async (_url, init) => {
        observedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
      // Whole-Look caps far away: only the first-token deadline can fire.
      timeoutMs: { describeMs: 10_000, locateMs: 40_000, firstTokenMs: 30 },
    })

    const failure = await vision.describe(describeRequest).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VisionDeadlineError)
    expect(String((failure as Error).message)).toContain('did not begin answering within 30ms')
    expect(observedSignal?.aborted).toBe(true)
    await expect(vision.locate(locateRequest)).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: expect.stringContaining('did not begin answering'),
    })
  })

  it('fails a headers-but-tokenless stream at time-to-first-token', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // Headers arrive; the body never yields a token.
              setTimeout(() => controller.error(new Error('body never finishes')), 5_000)
            },
          }),
          { status: 200 },
        ),
      timeoutMs: { describeMs: 10_000, locateMs: 10_000, firstTokenMs: 50 },
    })

    await expect(vision.describe(describeRequest)).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: expect.stringContaining('did not begin answering'),
    })
  })

  it('lets a slow-but-generating Look stream past the first-token window to completion', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        timedSseResponse([
          { afterMs: 10, data: sseChunk({ role: 'assistant' }) },
          { afterMs: 10, data: sseChunk({ content: 'A cookie banner ' }) },
          // Tokens keep flowing well past the 40ms first-token window.
          { afterMs: 40, data: sseChunk({ content: 'covers ' }) },
          { afterMs: 45, data: sseChunk({ content: 'the page.' }) },
          { afterMs: 30, data: SSE_DONE },
        ]),
      timeoutMs: { describeMs: 1_000, locateMs: 4_000, firstTokenMs: 40 },
    })

    await expect(vision.describe(describeRequest)).resolves.toBe('A cookie banner covers the page.')
  })

  it('counts reasoning tokens as answering, accumulating only content (Locate)', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        timedSseResponse([
          { afterMs: 5, data: sseChunk({ reasoning_content: 'scanning the thumbnail…' }) },
          { afterMs: 30, data: sseChunk({ content: '{"x": 340, ' }) },
          { afterMs: 20, data: sseChunk({ content: '"y": 220}' }) },
          { afterMs: 5, data: SSE_DONE },
        ]),
      timeoutMs: { describeMs: 1_000, locateMs: 4_000, firstTokenMs: 30 },
    })

    await expect(vision.locate(locateRequest)).resolves.toEqual({ x: 340, y: 220 })
  })

  it('caps a stream that stalls mid-answer at the whole-Look deadline', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseChunk({ content: 'partial' })))
              // Tokens flowed, then the stream stalls forever.
            },
          }),
          { status: 200 },
        ),
      timeoutMs: { describeMs: 50, locateMs: 200, firstTokenMs: 10_000 },
    })

    await expect(vision.describe(describeRequest)).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: 'Vision request timed out after 50ms',
    })
  })

  it('auto-vision advisory budget stays shorter than the Describe Look cap', () => {
    expect(AUTO_VISION_DESCRIBE_MS).toBeLessThan(DESCRIBE_TIMEOUT_MS)
  })

  it('honors an advisory deadline: clamps the whole-Look cap and scales the first-token window', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      // A hung exchange: headers never arrive, no token ever flows.
      fetch: () => new Promise<Response>(() => {}),
      timeoutMs: { describeMs: 10_000, locateMs: 40_000, firstTokenMs: 6_000 },
    })

    // A 60ms advisory cap keeps the default 8:15 first-token ratio: 32ms.
    await expect(vision.describe({ ...describeRequest, lookCapMs: 60 })).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: 'Vision request did not begin answering within 32ms',
    })
  })

  it('caps a stalling advisory describe at its shorter deadline, not the Look cap', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // One token flows immediately, then the stream stalls forever.
              controller.enqueue(new TextEncoder().encode(sseChunk({ content: 'partial' })))
            },
          }),
          { status: 200 },
        ),
      timeoutMs: { describeMs: 10_000, locateMs: 40_000, firstTokenMs: 6_000 },
    })

    await expect(vision.describe({ ...describeRequest, lookCapMs: 70 })).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: 'Vision request timed out after 70ms',
    })
  })

  it('clamps an advisory deadline larger than the configured Look cap', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: () => new Promise<Response>(() => {}),
      timeoutMs: { describeMs: 60, locateMs: 240, firstTokenMs: 10_000 },
    })

    // An absurd 999s advisory request dies at the 60ms Look cap, first-token
    // window scaled to it (60 * 8/15 = 32ms).
    await expect(vision.describe({ ...describeRequest, lookCapMs: 999_000 })).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: 'Vision request did not begin answering within 32ms',
    })
  })

  it('rejects a stream that ends without any content', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => sseResponse([sseChunk({ role: 'assistant' }), SSE_DONE]),
    })

    await expect(vision.describe(describeRequest)).rejects.toThrow('Vision model returned no content')
  })

  it('parses the SSE event model: joined multi-line data, ignored comments and keep-alives', async () => {
    // One JSON payload split across two data: lines of one event (at a JSON
    // token boundary — data lines join with newlines), a comment line, and
    // a frame split mid-line by the transport.
    const whole = `data: ${JSON.stringify({ choices: [{ delta: { content: 'reassembled' } }] })}\n\n${SSE_DONE}`
    const splitAt = Math.floor(whole.length / 2)
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        sseResponse([
          ': keep-alive\n',
          'data: {"choices":\n',
          'data: [{"delta":{"content":"joined payload"}}]}\n\n',
          whole.slice(0, splitAt),
          whole.slice(splitAt),
        ]),
    })

    await expect(vision.describe(describeRequest)).resolves.toBe('joined payloadreassembled')
  })

  it('describe: streams, disables thinking, and caps tokens on the fast path', async () => {
    const captured: CapturedRequest[] = []
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async (url, init) => {
        captured.push({ url: String(url), init: init ?? {} })
        return okResponse('A cookie banner covers the page.')
      },
    })

    await expect(vision.describe(describeRequest)).resolves.toBe('A cookie banner covers the page.')
    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>
    expect(captured[0]?.url).toBe('https://api.z.ai/api/coding/paas/v4/chat/completions')
    expect(String((captured[0]?.init.headers as Record<string, string>).authorization).toLowerCase()).toContain('bearer secret-value')
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.max_tokens).toBe(DESCRIBE_MAX_TOKENS)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('GLM-4.6V')
  })

  it('uses a caller-selected answer cap for a questioned Describe', async () => {
    let body: Record<string, unknown> | undefined
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return okResponse('Solo Leveling, Omniscient Reader.')
      },
    })

    await vision.describe({ ...describeRequest, maxTokens: 512 })

    expect(body?.max_tokens).toBe(512)
  })

  it('locate: keeps thinking enabled on the precision path and parses the point', async () => {
    const captured: CapturedRequest[] = []
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async (url, init) => {
        captured.push({ url: String(url), init: init ?? {} })
        return okResponse('```json\n{"x": 340, "y": 220}\n```')
      },
    })

    await expect(vision.locate(locateRequest)).resolves.toEqual({ x: 340, y: 220 })
    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.max_tokens).toBe(LOCATE_MAX_TOKENS)
    const prompt = (body.messages as { content: { type: string; text?: string }[] }[])[0].content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
    expect(prompt).toContain('the play button in the thumbnail')
    expect(prompt).toContain('800x600')
  })

  it('sends the screenshot as a base64 image_url part', async () => {
    let content: unknown
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: { content: unknown[] }[] }
        content = body.messages[0].content
        return okResponse('blank page')
      },
    })

    await vision.describe(describeRequest)
    const imagePart = (content as { type: string; image_url?: { url: string } }[]).find(
      (part) => part.type === 'image_url',
    )
    expect(imagePart?.image_url?.url).toBe(`data:image/jpeg;base64,${Buffer.from(describeRequest.image).toString('base64')}`)
  })

  it('surfaces HTTP errors with status and body excerpt', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), { status: 429 }),
    })

    await expect(vision.describe(describeRequest)).rejects.toThrow(/429.*Rate limit exceeded/)
  })

  it('rejects malformed or out-of-viewport locate answers', async () => {
    for (const answer of ['no json at all', '{"x": 900, "y": 20}']) {
      const vision = createZaiVisionApi({
        getEnv: () => ({ ...configuredEnv }),
        fetch: async () => okResponse(answer),
      })
      await expect(vision.locate(locateRequest)).rejects.toThrow(/valid JSON point|outside the viewport/)
    }
  })

  it('serves scripted describe/locate test hooks without live calls', async () => {
    const calls: string[] = []
    const vision = createZaiVisionApi({
      getEnv: () => ({
        ...configuredEnv,
        BINGBONG_VISION_SCRIPT: JSON.stringify([{ x: 10, y: 20 }]),
        BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify(['Scripted state.']),
      }),
      fetch: async (url) => {
        calls.push(String(url))
        return okResponse('unused')
      },
    })

    await expect(vision.locate(locateRequest)).resolves.toEqual({ x: 10, y: 20 })
    await expect(vision.describe(describeRequest)).resolves.toBe('Scripted state.')
    expect(calls).toEqual([])
    await expect(vision.locate(locateRequest)).rejects.toThrow(/ran out of points/)
    await expect(vision.describe(describeRequest)).rejects.toThrow(/ran out of descriptions/)
  })
})

/**
 * The vision attempt fixtures (#204). Each one drives the adapter with a
 * locally injected stream and asserts both what the caller got back and what
 * the attempt reported observing — the two together are the diagnosis. What
 * they establish is local: how this adapter parses and times a stream it is
 * handed. They say nothing about why a provider was slow in the captured
 * failures, and nothing about whether live vision has recovered.
 */
describe('createZaiVisionApi: vision attempt records', () => {
  function observer(): { observations: VisionAttemptObservation[]; observe: (o: VisionAttemptObservation) => void } {
    const observations: VisionAttemptObservation[] = []
    return { observations, observe: (o) => observations.push(o) }
  }

  /** The one observation of an attempt, failing loudly if it never reported. */
  function only(observations: VisionAttemptObservation[]): VisionAttemptObservation {
    expect(observations).toHaveLength(1)
    return observations[0] as VisionAttemptObservation
  }

  it('records no response milestone at all when no response ever arrives', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      // The provider never answers: no headers, no body, nothing.
      fetch: () => new Promise<Response>(() => {}),
      timeoutMs: { describeMs: 10_000, locateMs: 40_000, firstTokenMs: 30 },
    })

    await expect(vision.describe({ ...describeRequest, observe })).rejects.toBeInstanceOf(VisionDeadlineError)

    const attempt = only(observations)
    expect(attempt.ending).toBe('first_token_deadline')
    // Absent, not zero: nothing was observed, and nothing is guessed.
    expect(attempt).not.toHaveProperty('responseAtMs')
    expect(attempt).not.toHaveProperty('responseStatus')
    expect(attempt).not.toHaveProperty('firstByteAtMs')
    expect(attempt).not.toHaveProperty('firstTokenKind')
    expect(attempt.bytesRead).toBe(0)
    expect(attempt.streamEvents).toBe(0)
    expect(attempt.firstTokenLimitMs).toBe(30)
    expect(attempt.wholeLookLimitMs).toBe(10_000)
  })

  it('separates a response that arrived from progress that did not', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      // Headers, a keep-alive comment and a role-only frame: bytes flow, no
      // generation content ever does.
      fetch: async () =>
        timedSseResponse([
          { afterMs: 1, data: ': keep-alive\n\n' },
          { afterMs: 1, data: sseChunk({ role: 'assistant' }) },
          { afterMs: 5_000, data: SSE_DONE },
        ]),
      timeoutMs: { describeMs: 10_000, locateMs: 40_000, firstTokenMs: 60 },
    })

    await expect(vision.describe({ ...describeRequest, observe })).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      message: expect.stringContaining('did not begin answering'),
    })

    const attempt = only(observations)
    expect(attempt.ending).toBe('first_token_deadline')
    expect(attempt.responseStatus).toBe(200)
    expect(typeof attempt.responseAtMs).toBe('number')
    expect(typeof attempt.firstByteAtMs).toBe('number')
    expect(attempt.bytesRead).toBeGreaterThan(0)
    // One parsed event, none of it recognized generation content.
    expect(attempt.streamEvents).toBe(1)
    expect(attempt.progressEvents).toBe(0)
    expect(attempt.malformedEvents).toBe(0)
    expect(attempt).not.toHaveProperty('firstReasoningAtMs')
    expect(attempt).not.toHaveProperty('firstContentAtMs')
    expect(attempt).not.toHaveProperty('streamEndAtMs')
    expect(attempt.sawDone).toBe(false)
  })

  it('reasoning satisfies the first-token window and is recorded as reasoning, not as answer content', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        timedSseResponse([
          { afterMs: 5, data: sseChunk({ reasoning_content: 'scanning the thumbnail…' }) },
          { afterMs: 60, data: sseChunk({ content: 'A cookie banner ' }) },
          { afterMs: 10, data: sseChunk({ content: 'covers the page.' }) },
          { afterMs: 5, data: SSE_DONE },
        ]),
      // The window would have fired at 40ms had reasoning not counted.
      timeoutMs: { describeMs: 5_000, locateMs: 20_000, firstTokenMs: 40 },
    })

    // The answer is the content alone: reasoning kept the Look alive, it did
    // not answer the question.
    await expect(vision.describe({ ...describeRequest, observe })).resolves.toBe('A cookie banner covers the page.')

    const attempt = only(observations)
    expect(attempt.ending).toBe('answered')
    expect(attempt.firstTokenKind).toBe('reasoning')
    expect(attempt.firstReasoningAtMs).toBeLessThan(attempt.firstContentAtMs as number)
    expect(attempt.reasoningChars).toBe('scanning the thumbnail…'.length)
    expect(attempt.contentChars).toBe('A cookie banner covers the page.'.length)
    expect(attempt.progressEvents).toBe(3)
    expect(attempt.sawDone).toBe(true)
  })

  it('records a slow but valid answer as answered, milestones in the order they happened', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        timedSseResponse([
          { afterMs: 10, data: sseChunk({ content: 'A cookie ' }) },
          { afterMs: 50, data: sseChunk({ content: 'banner.' }) },
          { afterMs: 10, data: SSE_DONE },
        ]),
      timeoutMs: { describeMs: 5_000, locateMs: 20_000, firstTokenMs: 40 },
    })

    await expect(vision.describe({ ...describeRequest, observe })).resolves.toBe('A cookie banner.')

    const attempt = only(observations)
    expect(attempt.ending).toBe('answered')
    expect(attempt.firstTokenKind).toBe('content')
    expect(attempt).not.toHaveProperty('firstReasoningAtMs')
    const { responseAtMs, firstByteAtMs, firstContentAtMs, streamEndAtMs, settledAtMs } = attempt
    expect(responseAtMs).toBeLessThanOrEqual(firstByteAtMs as number)
    expect(firstByteAtMs).toBeLessThanOrEqual(firstContentAtMs as number)
    expect(firstContentAtMs).toBeLessThanOrEqual(streamEndAtMs as number)
    expect(streamEndAtMs).toBeLessThanOrEqual(settledAtMs)
  })

  it('records a mid-stream stall as the whole-Look cap, with the content it did see', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseChunk({ content: 'partial' })))
              // Tokens flowed, then the stream stalls forever.
            },
          }),
          { status: 200 },
        ),
      timeoutMs: { describeMs: 60, locateMs: 240, firstTokenMs: 10_000 },
    })

    await expect(vision.describe({ ...describeRequest, observe })).rejects.toMatchObject({
      name: 'VisionDeadlineError',
      phase: 'whole-look',
      message: 'Vision request timed out after 60ms',
    })

    const attempt = only(observations)
    expect(attempt.ending).toBe('whole_look_deadline')
    expect(attempt.firstTokenKind).toBe('content')
    expect(attempt.contentChars).toBe('partial'.length)
    // The stream never ended and never said DONE — that is the stall.
    expect(attempt).not.toHaveProperty('streamEndAtMs')
    expect(attempt.sawDone).toBe(false)
    expect(attempt.wholeLookLimitMs).toBe(60)
  })

  it('records a completed but empty stream as an empty completion, not as a deadline', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => sseResponse([sseChunk({ role: 'assistant' }), SSE_DONE]),
    })

    await expect(vision.describe({ ...describeRequest, observe })).rejects.toThrow('Vision model returned no content')

    const attempt = only(observations)
    expect(attempt.ending).toBe('empty_completion')
    expect(attempt.sawDone).toBe(true)
    expect(typeof attempt.streamEndAtMs).toBe('number')
    expect(attempt.streamEvents).toBe(1)
    expect(attempt.progressEvents).toBe(0)
    expect(attempt.contentChars).toBe(0)
    expect(attempt.message).toContain('no content')
  })

  it('counts supported SSE framing as events and unparseable payloads as malformed', async () => {
    const { observations, observe } = observer()
    const whole = `data: ${JSON.stringify({ choices: [{ delta: { content: 'reassembled' } }] })}\n\n${SSE_DONE}`
    const splitAt = Math.floor(whole.length / 2)
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        sseResponse([
          ': keep-alive\n',
          // One payload split across two data: lines of one event.
          'data: {"choices":\n',
          'data: [{"delta":{"content":"joined payload"}}]}\n\n',
          // Content this adapter cannot parse: a finding of its own.
          'data: {not json at all}\n\n',
          whole.slice(0, splitAt),
          whole.slice(splitAt),
        ]),
    })

    await expect(vision.describe({ ...describeRequest, observe })).resolves.toBe('joined payloadreassembled')

    const attempt = only(observations)
    expect(attempt.ending).toBe('answered')
    expect(attempt.streamEvents).toBe(2)
    expect(attempt.progressEvents).toBe(2)
    expect(attempt.malformedEvents).toBe(1)
    expect(attempt.sawDone).toBe(true)
  })

  it('records an aborted request as aborted rather than as a failed deadline', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => {
        const aborted = new Error('The operation was aborted')
        aborted.name = 'AbortError'
        throw aborted
      },
      timeoutMs: { describeMs: 5_000, locateMs: 20_000, firstTokenMs: 4_000 },
    })

    await expect(vision.describe({ ...describeRequest, observe })).rejects.toMatchObject({ name: 'AbortError' })

    const attempt = only(observations)
    expect(attempt.ending).toBe('aborted')
    expect(attempt).not.toHaveProperty('responseAtMs')
  })

  it('records a transport failure as a stream error, and an HTTP status as an HTTP error', async () => {
    const streamError = observer()
    const failing = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => {
        throw new Error('socket hang up')
      },
    })
    await expect(failing.describe({ ...describeRequest, observe: streamError.observe })).rejects.toThrow('socket hang up')
    expect(only(streamError.observations).ending).toBe('stream_error')

    const httpError = observer()
    const rateLimited = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), { status: 429 }),
    })
    await expect(rateLimited.describe({ ...describeRequest, observe: httpError.observe })).rejects.toThrow(/429/)
    const attempt = only(httpError.observations)
    expect(attempt.ending).toBe('http_error')
    expect(attempt.responseStatus).toBe(429)
    // The error body is read off the stream, so its bytes are counted: an
    // absent first byte has to keep meaning "the body stayed silent".
    expect(attempt.bytesRead).toBeGreaterThan(0)
    expect(typeof attempt.firstByteAtMs).toBe('number')
    expect(attempt.streamEvents).toBe(0)
  })

  it('a stream that settles after the deadline cannot rewrite the record of the attempt that failed', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      // Content arrives well after the first-token window has already fired.
      fetch: async () =>
        timedSseResponse([
          { afterMs: 80, data: sseChunk({ content: 'too late to matter' }) },
          { afterMs: 5, data: SSE_DONE },
        ]),
      timeoutMs: { describeMs: 10_000, locateMs: 40_000, firstTokenMs: 20 },
    })

    await expect(vision.describe({ ...describeRequest, observe })).rejects.toMatchObject({ phase: 'first-token' })
    const attempt = only(observations)
    expect(attempt.ending).toBe('first_token_deadline')

    // Let the late stream run to completion behind the failure.
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Still one record, and still the record of what the caller saw.
    expect(observations).toHaveLength(1)
    expect(attempt.ending).toBe('first_token_deadline')
    expect(attempt).not.toHaveProperty('firstContentAtMs')
    expect(attempt.contentChars).toBe(0)
  })

  it('records the limits and settings in force without credentials, prompt, image, or reasoning text', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        sseResponse([sseChunk({ reasoning_content: 'the tier list is unreadable at this size' }), sseChunk({ content: 'ok' }), SSE_DONE]),
      timeoutMs: { describeMs: 15_000, locateMs: 60_000, firstTokenMs: 8_000 },
    })

    await vision.describe({ ...describeRequest, maxTokens: 512, lookCapMs: 6_000, observe })

    const attempt = only(observations)
    expect(attempt).toMatchObject({
      model: 'GLM-4.6V',
      maxTokens: 512,
      thinking: 'disabled',
      // The advisory cap as asked for, and the deadlines it actually produced.
      requestedCapMs: 6_000,
      wholeLookLimitMs: 6_000,
      firstTokenLimitMs: 3_200,
    })
    // Reasoning is counted, never quoted.
    expect(attempt.reasoningChars).toBe('the tier list is unreadable at this size'.length)
    const serialized = JSON.stringify(attempt)
    for (const secret of [
      'secret-value',
      describeRequest.prompt,
      'the tier list is unreadable',
      Buffer.from(describeRequest.image).toString('base64'),
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('records a locate attempt too, and omits a cap the caller never asked for', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => okResponse('{"x": 340, "y": 220}'),
      timeoutMs: { describeMs: 15_000, locateMs: 60_000, firstTokenMs: 8_000 },
    })

    await expect(vision.locate({ ...locateRequest, observe })).resolves.toEqual({ x: 340, y: 220 })

    const attempt = only(observations)
    expect(attempt).toMatchObject({ ending: 'answered', thinking: 'enabled', maxTokens: LOCATE_MAX_TOKENS, wholeLookLimitMs: 60_000 })
    expect(attempt).not.toHaveProperty('requestedCapMs')
  })

  it('records an unusable Locate answer as answered: the exchange answered, the caller could not use it', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => okResponse('somewhere near the middle'),
    })

    // The attempt is the exchange with the endpoint. Parsing the answer is
    // the caller's, and its failure is the caller's outcome — recorded on the
    // vision_request event beside this record, not folded into it.
    await expect(vision.locate({ ...locateRequest, observe })).rejects.toThrow(/valid JSON point/)

    const attempt = only(observations)
    expect(attempt.ending).toBe('answered')
    expect(attempt.contentChars).toBe('somewhere near the middle'.length)
    expect(attempt).not.toHaveProperty('message')
  })

  it('never lets a throwing observer fail the Look it describes', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () => okResponse('A cookie banner covers the page.'),
    })

    await expect(
      vision.describe({
        ...describeRequest,
        observe: () => {
          throw new Error('dead logs dir')
        },
      }),
    ).resolves.toBe('A cookie banner covers the page.')
  })

  it('reports nothing for a scripted answer, which never made an attempt', async () => {
    const { observations, observe } = observer()
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv, BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify(['Scripted state.']) }),
      fetch: async () => okResponse('unused'),
    })

    await expect(vision.describe({ ...describeRequest, observe })).resolves.toBe('Scripted state.')
    expect(observations).toEqual([])
  })
})
