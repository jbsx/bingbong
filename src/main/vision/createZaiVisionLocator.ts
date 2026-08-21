import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolveModelEndpoint } from '../../core/agent/modelRouting'
import type { VisionLocation, VisionModel } from '../../core/ports/vision'

export interface VisionMcpSession {
  listTools(): Promise<string[]>
  callTool(name: string, args: Record<string, unknown>): Promise<string>
  close(): Promise<void>
}

export type VisionMcpSessionFactory = (
  env: Record<string, string>,
  signal?: AbortSignal,
) => Promise<VisionMcpSession>

export interface ZaiVisionLocatorDeps {
  getEnv(): Record<string, string | undefined>
  createSession?: VisionMcpSessionFactory
  /** Test override; BINGBONG_VISION_TIMEOUT_MS and the default apply otherwise. */
  timeoutMs?: number
}

/** Ceiling for one full vision MCP exchange (spawn/handshake + tool call). */
export const DEFAULT_VISION_TIMEOUT_MS = 30_000

export function resolveVisionTimeoutMs(
  override: number | undefined,
  env: Record<string, string | undefined>,
): number {
  if (typeof override === 'number') return override
  const raw = Number(env.BINGBONG_VISION_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VISION_TIMEOUT_MS
}

interface SessionEntry {
  session: VisionMcpSession
  toolName: string
  key: string
}

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

async function createMcpSession(env: Record<string, string>, signal?: AbortSignal): Promise<VisionMcpSession> {
  const require = createRequire(import.meta.url)
  const serverPath = require.resolve('@z_ai/mcp-server')
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
    stderr: 'pipe',
  })
  // An undrained stderr pipe fills its OS buffer and deadlocks the child server,
  // so keep the pipe flowing even though the output is discarded.
  transport.stderr?.on('data', () => {})
  const client = new Client({ name: 'bingbong-vision', version: '0.1.0' })
  await client.connect(transport, signal ? { signal } : undefined)
  return {
    async listTools() {
      const result = await client.listTools()
      return result.tools.map((tool) => tool.name)
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args })
      if ('isError' in result && result.isError) {
        throw new Error('Vision MCP tool reported an error')
      }
      const content = (result as { content?: unknown }).content
      if (!Array.isArray(content)) throw new Error('Vision MCP tool returned no content')
      return content
        .filter((part): part is { type: 'text'; text: string } =>
          typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text)
        .join('\n')
    },
    close: () => client.close(),
  }
}

function parsePoint(answer: string, width: number, height: number): VisionLocation {
  const object = answer.match(/\{[\s\S]*?\}/)?.[0]
  let parsed: unknown
  try {
    parsed = object ? JSON.parse(object) : undefined
  } catch {
    parsed = undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Vision MCP did not return a valid JSON point')
  }
  const { x, y } = parsed as Record<string, unknown>
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new Error('Vision MCP did not return a valid JSON point')
  }
  if (x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error('Vision MCP point is outside the viewport')
  }
  return { x: Math.round(x), y: Math.round(y) }
}

export function createZaiVisionLocator(deps: ZaiVisionLocatorDeps): VisionModel {
  const createSession = deps.createSession ?? createMcpSession
  let scriptSource: string | undefined
  let scriptedLocations: unknown[] = []
  let descriptionScriptSource: string | undefined
  let scriptedDescriptions: unknown[] = []
  let cached: SessionEntry | undefined

  function dropSession(): void {
    const entry = cached
    cached = undefined
    if (entry) void entry.session.close().catch(() => {})
  }

  async function acquireSession(signal: AbortSignal): Promise<SessionEntry> {
    const env = deps.getEnv()
    const endpoint = resolveModelEndpoint(env, 'vision')
    const key = `${endpoint.baseUrl}\n${endpoint.model}\n${endpoint.apiKey}`
    if (cached?.key === key) return cached
    dropSession()
    const session = await createSession(
      {
        ...inheritedEnv(),
        Z_AI_API_KEY: endpoint.apiKey,
        Z_AI_BASE_URL: `${endpoint.baseUrl.replace(/\/+$/, '')}/`,
        Z_AI_VISION_MODEL: endpoint.model,
      },
      signal,
    )
    const tools = await session.listTools()
    const toolName = tools.find((name) => name === 'analyze_image')
    if (!toolName) {
      void session.close().catch(() => {})
      throw new Error('Vision MCP server does not expose analyze_image')
    }
    cached = { session, toolName, key }
    return cached
  }

  async function analyze(image: Uint8Array, prompt: string): Promise<string> {
    const timeoutMs = resolveVisionTimeoutMs(deps.timeoutMs, deps.getEnv())
    const signal = AbortSignal.timeout(timeoutMs)
    const dir = await mkdtemp(join(tmpdir(), 'bingbong-vision-'))
    const imagePath = join(dir, 'page.jpg')
    try {
      await writeFile(imagePath, image)
      // The whole exchange — session reuse or spawn, plus the tool call — must
      // fit the deadline; a stuck call force-closes the session instead of
      // stalling the assistant run forever.
      let settled = false
      const exchange = (async () => {
        const entry = await acquireSession(signal)
        try {
          return await entry.session.callTool(entry.toolName, { image_source: imagePath, prompt })
        } catch (error) {
          if (cached === entry) dropSession()
          throw error
        }
      })().finally(() => {
        settled = true
      })
      const timeout = new Promise<never>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            // AbortSignal.timeout fires on schedule even after a success —
            // only act when the exchange genuinely missed the deadline.
            if (settled) return
            dropSession()
            reject(new Error(`Vision request timed out after ${timeoutMs}ms`))
          },
          { once: true },
        )
      })
      return await Promise.race([exchange, timeout])
    } finally {
      try {
        await rm(dir, { recursive: true, force: true })
      } catch {
        // best effort — a lingering temp dir never blocks the answer
      }
    }
  }

  return {
    async locate(request) {
      const env = deps.getEnv()
      const script = env.BINGBONG_VISION_SCRIPT?.trim()
      if (script) {
        if (script !== scriptSource) {
          let parsed: unknown
          try {
            parsed = JSON.parse(script)
          } catch (error) {
            throw new Error(`BINGBONG_VISION_SCRIPT is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
          }
          if (!Array.isArray(parsed)) throw new Error('BINGBONG_VISION_SCRIPT must be an array of points')
          scriptedLocations = [...parsed]
          scriptSource = script
        }
        const next = scriptedLocations.shift()
        if (next === undefined) throw new Error('BINGBONG_VISION_SCRIPT ran out of points')
        return parsePoint(JSON.stringify(next), request.viewport.width, request.viewport.height)
      }

      const answer = await analyze(
        request.image,
        `Locate ${JSON.stringify(request.target)} in this browser screenshot. ` +
          `The viewport is ${request.viewport.width}x${request.viewport.height} CSS pixels. ` +
          'Return only JSON with the center point in viewport pixels: {"x": number, "y": number}.',
      )
      return parsePoint(answer, request.viewport.width, request.viewport.height)
    },
    async describe(request) {
      const env = deps.getEnv()
      const script = env.BINGBONG_VISION_DESCRIPTION_SCRIPT?.trim()
      if (script) {
        if (script !== descriptionScriptSource) {
          let parsed: unknown
          try {
            parsed = JSON.parse(script)
          } catch (error) {
            throw new Error(`BINGBONG_VISION_DESCRIPTION_SCRIPT is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
          }
          if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
            throw new Error('BINGBONG_VISION_DESCRIPTION_SCRIPT must be an array of strings')
          }
          scriptedDescriptions = [...parsed]
          descriptionScriptSource = script
        }
        const next = scriptedDescriptions.shift()
        if (next === undefined) throw new Error('BINGBONG_VISION_DESCRIPTION_SCRIPT ran out of descriptions')
        return String(next)
      }
      return analyze(request.image, request.prompt)
    },
  }
}
