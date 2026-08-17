import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { VisionLocateRequest } from '../../core/ports/vision'
import {
  createZaiVisionLocator,
  type VisionMcpSession,
  type VisionMcpSessionFactory,
} from './createZaiVisionLocator'

const request: VisionLocateRequest = {
  image: new Uint8Array([1, 2, 3]),
  target: 'the play button in the thumbnail',
  viewport: { width: 800, height: 600, scrollY: 0, scrollHeight: 600 },
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
    expect(closed).toBe(1)
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
})
