import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { VisionDescribeRequest, VisionLocateRequest } from '../../core/ports/vision'
import {
  createZaiVisionLocator,
  DEFAULT_VISION_TIMEOUT_MS,
  resolveVisionTimeoutMs,
  type VisionMcpSession,
  type VisionMcpSessionFactory,
} from './createZaiVisionLocator'

const request: VisionLocateRequest = {
  image: new Uint8Array([1, 2, 3]),
  target: 'the play button in the thumbnail',
  viewport: { width: 800, height: 600, scrollY: 0, scrollHeight: 600 },
}

const describeRequest: VisionDescribeRequest = {
  image: new Uint8Array([4, 5, 6]),
  prompt: 'Describe anything blocking progress.',
}

const configuredEnv = {
  BINGBONG_VISION_BASE_URL: 'https://api.z.ai/api/paas/v4',
  BINGBONG_VISION_MODEL: 'glm-4.6v',
  BINGBONG_VISION_API_KEY: 'secret-value',
}

describe('createZaiVisionLocator', () => {
  it('calls the discovered MCP image tool with a temporary screenshot and parses its point', async () => {
    let imagePath = ''
    let spawnedEnv: Record<string, string> | undefined
    let closed = 0
    const factory: VisionMcpSessionFactory = async (env) => {
      spawnedEnv = env
      const session: VisionMcpSession = {
        listTools: async () => ['ui_to_artifact', 'analyze_image'],
        async callTool(name, args) {
          expect(name).toBe('analyze_image')
          imagePath = String(args.image_source)
          expect(new Uint8Array(await readFile(imagePath))).toEqual(request.image)
          expect(args.prompt).toContain(request.target)
          expect(args.prompt).toContain('800x600')
          return '```json\n{"x": 340, "y": 220}\n```'
        },
        async close() {
          closed += 1
        },
      }
      return session
    }
    const locator = createZaiVisionLocator({
      getEnv: () => ({
        BINGBONG_VISION_BASE_URL: 'https://api.z.ai/api/paas/v4',
        BINGBONG_VISION_MODEL: 'glm-4.6v',
        BINGBONG_VISION_API_KEY: 'secret-value',
      }),
      createSession: factory,
    })

    await expect(locator.locate(request)).resolves.toEqual({ x: 340, y: 220 })
    expect(spawnedEnv).toMatchObject({
      Z_AI_API_KEY: 'secret-value',
      Z_AI_BASE_URL: 'https://api.z.ai/api/paas/v4/',
      Z_AI_VISION_MODEL: 'glm-4.6v',
    })
    // A successful call keeps the session for reuse (closed on failure/timeout instead).
    expect(closed).toBe(0)
    await expect(access(imagePath)).rejects.toThrow()
  })

  it('rejects malformed or out-of-viewport MCP answers', async () => {
    const answers = ['not json', '{"x": 900, "y": 20}']
    const locator = createZaiVisionLocator({
      getEnv: () => ({
        BINGBONG_VISION_BASE_URL: 'https://api.z.ai/api/paas/v4',
        BINGBONG_VISION_MODEL: 'glm-4.6v',
        BINGBONG_VISION_API_KEY: 'secret-value',
      }),
      createSession: async () => ({
        listTools: async () => ['analyze_image'],
        callTool: async () => answers.shift() ?? '',
        close: async () => {},
      }),
    })

    await expect(locator.locate(request)).rejects.toThrow(/valid JSON point/)
    await expect(locator.locate(request)).rejects.toThrow(/outside the viewport/)
  })

  it('returns the MCP image analysis as a plain-text page description', async () => {
    let imagePath = ''
    const locator = createZaiVisionLocator({
      getEnv: () => ({
        BINGBONG_VISION_BASE_URL: 'https://api.z.ai/api/paas/v4',
        BINGBONG_VISION_MODEL: 'glm-4.6v',
        BINGBONG_VISION_API_KEY: 'secret-value',
      }),
      createSession: async () => ({
        listTools: async () => ['analyze_image'],
        async callTool(name, args) {
          expect(name).toBe('analyze_image')
          imagePath = String(args.image_source)
          expect(new Uint8Array(await readFile(imagePath))).toEqual(describeRequest.image)
          expect(args.prompt).toBe(describeRequest.prompt)
          return 'A cookie consent overlay covers the page.'
        },
        close: async () => {},
      }),
    })

    await expect(locator.describe(describeRequest)).resolves.toBe('A cookie consent overlay covers the page.')
    await expect(access(imagePath)).rejects.toThrow()
  })

  it('supports scripted descriptions for deterministic e2e runs', async () => {
    const locator = createZaiVisionLocator({
      getEnv: () => ({
        BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify(['First page state.', 'Second page state.']),
      }),
    })

    await expect(locator.describe(describeRequest)).resolves.toBe('First page state.')
    await expect(locator.describe(describeRequest)).resolves.toBe('Second page state.')
    await expect(locator.describe(describeRequest)).rejects.toThrow('ran out of descriptions')
  })

  it('times out a stuck MCP exchange, closes the session, and still removes the screenshot', async () => {
    let closed = 0
    let imagePath = ''
    const locator = createZaiVisionLocator({
      getEnv: () => ({ ...configuredEnv }),
      timeoutMs: 25,
      createSession: async () => ({
        listTools: async () => ['analyze_image'],
        async callTool(_name, args) {
          imagePath = String(args.image_source)
          return new Promise<string>(() => {})
        },
        async close() {
          closed += 1
        },
      }),
    })

    await expect(locator.describe(describeRequest)).rejects.toThrow('Vision request timed out after 25ms')
    expect(closed).toBe(1)
    await expect(access(imagePath)).rejects.toThrow()
  })

  it('spawns a fresh session on the call after a timed-out exchange', async () => {
    let spawns = 0
    let hang = true
    const factory: VisionMcpSessionFactory = async () => {
      spawns += 1
      const session: VisionMcpSession = {
        listTools: async () => ['analyze_image'],
        callTool: () => (hang ? new Promise<string>(() => {}) : Promise.resolve('Recovered state.')),
        close: async () => {},
      }
      return session
    }
    const locator = createZaiVisionLocator({
      getEnv: () => ({ ...configuredEnv }),
      timeoutMs: 25,
      createSession: factory,
    })

    await expect(locator.describe(describeRequest)).rejects.toThrow(/timed out/)
    hang = false
    await expect(locator.describe(describeRequest)).resolves.toBe('Recovered state.')
    expect(spawns).toBe(2)
  })

  it('honours BINGBONG_VISION_TIMEOUT_MS from the environment', async () => {
    const locator = createZaiVisionLocator({
      getEnv: () => ({ ...configuredEnv, BINGBONG_VISION_TIMEOUT_MS: '20' }),
      createSession: async () => ({
        listTools: async () => ['analyze_image'],
        callTool: () => new Promise<string>(() => {}),
        close: async () => {},
      }),
    })

    await expect(locator.locate(request)).rejects.toThrow('Vision request timed out after 20ms')
  })

  it('reuses one MCP session across calls instead of spawning per call', async () => {
    let spawns = 0
    let closed = 0
    let calls = 0
    const factory: VisionMcpSessionFactory = async () => {
      spawns += 1
      const session: VisionMcpSession = {
        listTools: async () => ['analyze_image'],
        async callTool() {
          calls += 1
          return `description ${calls}`
        },
        async close() {
          closed += 1
        },
      }
      return session
    }
    const locator = createZaiVisionLocator({ getEnv: () => ({ ...configuredEnv }), createSession: factory })

    await expect(locator.describe(describeRequest)).resolves.toBe('description 1')
    await expect(locator.describe(describeRequest)).resolves.toBe('description 2')
    expect(spawns).toBe(1)
    expect(calls).toBe(2)
    expect(closed).toBe(0)
  })

  it('does not let a successful call\'s elapsed timeout signal kill the cached session', async () => {
    let spawns = 0
    let closed = 0
    const factory: VisionMcpSessionFactory = async () => {
      spawns += 1
      const session: VisionMcpSession = {
        listTools: async () => ['analyze_image'],
        callTool: () => Promise.resolve('Quick state.'),
        async close() {
          closed += 1
        },
      }
      return session
    }
    const locator = createZaiVisionLocator({
      getEnv: () => ({ ...configuredEnv }),
      timeoutMs: 25,
      createSession: factory,
    })

    await expect(locator.describe(describeRequest)).resolves.toBe('Quick state.')
    // Let the (already satisfied) AbortSignal fire past a healthy call.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(closed).toBe(0)
    // The stale signal must not sabotage a later exchange reusing the session.
    await expect(locator.describe(describeRequest)).resolves.toBe('Quick state.')
    expect(spawns).toBe(1)
    expect(closed).toBe(0)
  })

  it('closes a session whose call fails and spawns a replacement next call', async () => {
    let spawns = 0
    let closed = 0
    const factory: VisionMcpSessionFactory = async () => {
      spawns += 1
      const mine = spawns
      const session: VisionMcpSession = {
        listTools: async () => ['analyze_image'],
        callTool: () =>
          mine === 1 ? Promise.reject(new Error('stream reset')) : Promise.resolve('Second attempt.'),
        async close() {
          closed += 1
        },
      }
      return session
    }
    const locator = createZaiVisionLocator({ getEnv: () => ({ ...configuredEnv }), createSession: factory })

    await expect(locator.describe(describeRequest)).rejects.toThrow('stream reset')
    expect(closed).toBe(1)
    await expect(locator.describe(describeRequest)).resolves.toBe('Second attempt.')
    expect(spawns).toBe(2)
    expect(closed).toBe(1)
  })

  it('re-keys the cached session when the configured endpoint changes', async () => {
    let spawns = 0
    let closed = 0
    const spawnedKeys: string[] = []
    const factory: VisionMcpSessionFactory = async (env) => {
      spawns += 1
      spawnedKeys.push(env.Z_AI_API_KEY)
      const session: VisionMcpSession = {
        listTools: async () => ['analyze_image'],
        callTool: async () => 'A cookie consent overlay covers the page.',
        async close() {
          closed += 1
        },
      }
      return session
    }
    const env = { ...configuredEnv }
    const locator = createZaiVisionLocator({ getEnv: () => env, createSession: factory })

    await expect(locator.describe(describeRequest)).resolves.toBe('A cookie consent overlay covers the page.')
    env.BINGBONG_VISION_API_KEY = 'rotated-key'
    await expect(locator.describe(describeRequest)).resolves.toBe('A cookie consent overlay covers the page.')
    expect(spawns).toBe(2)
    expect(spawnedKeys).toEqual(['secret-value', 'rotated-key'])
    expect(closed).toBe(1)
  })

  it('resolves the vision timeout from the explicit override, then the environment, then the default', () => {
    expect(resolveVisionTimeoutMs(50, {})).toBe(50)
    expect(resolveVisionTimeoutMs(50, { BINGBONG_VISION_TIMEOUT_MS: '1234' })).toBe(50)
    expect(resolveVisionTimeoutMs(undefined, { BINGBONG_VISION_TIMEOUT_MS: '1234' })).toBe(1234)
    expect(resolveVisionTimeoutMs(undefined, {})).toBe(DEFAULT_VISION_TIMEOUT_MS)
  })

  it('ignores non-positive or non-numeric BINGBONG_VISION_TIMEOUT_MS values', () => {
    for (const raw of ['0', '-5', 'abc', '']) {
      expect(resolveVisionTimeoutMs(undefined, { BINGBONG_VISION_TIMEOUT_MS: raw })).toBe(DEFAULT_VISION_TIMEOUT_MS)
    }
  })
})
