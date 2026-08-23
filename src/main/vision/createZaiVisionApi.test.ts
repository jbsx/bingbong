import { describe, expect, it } from 'vitest'
import type { VisionDescribeRequest, VisionLocateRequest } from '../../core/ports/vision'
import { VisionDeadlineError } from '../../core/ports/vision'
import { createZaiVisionApi, DESCRIBE_MAX_TOKENS, LOCATE_MAX_TOKENS, resolveVisionTimeouts } from './createZaiVisionApi'

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

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}

describe('createZaiVisionApi', () => {
  it('resolveVisionTimeouts: 15s describe / 60s locate, seconds-based env scaling with plausible bounds', () => {
    expect(resolveVisionTimeouts({})).toEqual({ describeMs: 15_000, locateMs: 60_000 })
    expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: '2' })).toEqual({ describeMs: 2_000, locateMs: 8_000 })
    // Non-numeric, zero, negative: defaults.
    for (const raw of ['soon', '0', '-5']) {
      expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: raw })).toEqual({ describeMs: 15_000, locateMs: 60_000 })
    }
    // Implausibly large (a legacy milliseconds value like 30000) is rejected to defaults.
    expect(resolveVisionTimeouts({ BINGBONG_VISION_TIMEOUT_MS: '30000' })).toEqual({ describeMs: 15_000, locateMs: 60_000 })
  })

  it('times out a stuck call per capability, aborting the request and naming the deadline', async () => {
    let observedSignal: AbortSignal | undefined
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async (_url, init) => {
        observedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
      timeoutMs: { describeMs: 30, locateMs: 60 },
    })

    const failure = await vision.describe(describeRequest).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VisionDeadlineError)
    expect(String((failure as Error).message)).toContain('timed out after 30ms')
    expect(observedSignal?.aborted).toBe(true)
    await expect(vision.locate(locateRequest)).rejects.toBeInstanceOf(VisionDeadlineError)
  })

  it('covers slow response bodies within the deadline', async () => {
    const vision = createZaiVisionApi({
      getEnv: () => ({ ...configuredEnv }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // Headers arrive; the body never completes within the deadline.
              setTimeout(() => controller.error(new Error('body never finishes')), 5_000)
            },
          }),
          { status: 200 },
        ),
      timeoutMs: { describeMs: 50, locateMs: 50 },
    })

    await expect(vision.describe(describeRequest)).rejects.toBeInstanceOf(VisionDeadlineError)
  })

  it('describe: disables thinking and caps tokens on the fast path', async () => {
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
    expect(body.model).toBe('GLM-4.6V')
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
