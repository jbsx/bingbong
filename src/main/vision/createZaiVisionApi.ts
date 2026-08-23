import { resolveModelEndpoint } from '../../core/agent/modelRouting'
import type { VisionLocation, VisionModel } from '../../core/ports/vision'

/**
 * Direct chat-completions adapter for the vision role (ADR 0008). The Z.ai MCP
 * server hard-locks reasoning on, which costs ~7x latency on Describe calls
 * and crashes under a token cap; calling the same OpenAI-compatible endpoint
 * the orchestrator uses gives us every lever and drops the child process,
 * temp files, and stdio hop entirely.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Answer-bounded output caps per capability (ADR 0008: fast vs precise paths). */
export const DESCRIBE_MAX_TOKENS = 128
export const LOCATE_MAX_TOKENS = 512

/** Per-capability deadlines — safety nets against endpoint variance, not targets. */
export const DESCRIBE_TIMEOUT_MS = 15_000
export const LOCATE_TIMEOUT_MS = 60_000

export interface VisionTimeouts {
  describeMs: number
  locateMs: number
}

/**
 * One env var scales both deadlines proportionally — the override exists for
 * debugging, not per-capability tuning. Non-positive or non-numeric values
 * fall back to the defaults.
 */
export function resolveVisionTimeouts(env: Record<string, string | undefined>): VisionTimeouts {
  const raw = Number(env.BINGBONG_VISION_TIMEOUT_MS)
  if (!Number.isFinite(raw) || raw <= 0) return { describeMs: DESCRIBE_TIMEOUT_MS, locateMs: LOCATE_TIMEOUT_MS }
  return { describeMs: raw * 1_000, locateMs: raw * 4_000 }
}

export interface ZaiVisionApiDeps {
  getEnv(): Record<string, string | undefined>
  /** Test override; global fetch is used otherwise. */
  fetch?: FetchLike
  /** Test override for both deadlines; env var and defaults apply otherwise. */
  timeoutMs?: VisionTimeouts
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
    throw new Error('Vision model did not return a valid JSON point')
  }
  const { x, y } = parsed as Record<string, unknown>
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new Error('Vision model did not return a valid JSON point')
  }
  if (x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error('Vision model point is outside the viewport')
  }
  return { x: Math.round(x), y: Math.round(y) }
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  const excerpt = body.slice(0, 200).replace(/\s+/g, ' ').trim()
  return excerpt ? `${response.status}: ${excerpt}` : String(response.status)
}

export function createZaiVisionApi(deps: ZaiVisionApiDeps): VisionModel {
  const doFetch = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init))

  // Scripted test hooks (e2e harness): deterministic points/descriptions
  // instead of live model calls, mirroring the old MCP locator's hooks.
  let scriptSource: string | undefined
  let scriptedLocations: unknown[] = []
  let descriptionScriptSource: string | undefined
  let scriptedDescriptions: unknown[] = []

  function timeouts(): VisionTimeouts {
    if (deps.timeoutMs) return deps.timeoutMs
    return resolveVisionTimeouts(deps.getEnv())
  }

  async function complete(image: Uint8Array, prompt: string, options: { thinking: 'enabled' | 'disabled'; maxTokens: number; timeoutMs: number }): Promise<string> {
    const endpoint = resolveModelEndpoint(deps.getEnv(), 'vision')
    const body = {
      model: endpoint.model,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(image).toString('base64')}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      thinking: { type: options.thinking },
      max_tokens: options.maxTokens,
      stream: false,
    }
    const response = await Promise.race([
      doFetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
        body: JSON.stringify(body),
      }),
      new Promise<never>((_, reject) => {
        if (typeof AbortSignal.timeout === 'function') {
          const signal = AbortSignal.timeout(options.timeoutMs)
          signal.addEventListener('abort', () => reject(new Error(`Vision request timed out after ${options.timeoutMs}ms`)), { once: true })
        }
      }),
    ])
    if (!response.ok) throw new Error(`Vision request failed (HTTP ${await readError(response)})`)
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('Vision model returned no content')
    }
    return content
  }

  return {
    async locate(request) {
      const script = deps.getEnv().BINGBONG_VISION_SCRIPT?.trim()
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

      const { locateMs } = timeouts()
      const answer = await complete(
        request.image,
        `Locate ${JSON.stringify(request.target)} in this browser screenshot. ` +
          `The viewport is ${request.viewport.width}x${request.viewport.height} CSS pixels. ` +
          'Return only JSON with the center point in viewport pixels: {"x": number, "y": number}.',
        { thinking: 'enabled', maxTokens: LOCATE_MAX_TOKENS, timeoutMs: locateMs },
      )
      return parsePoint(answer, request.viewport.width, request.viewport.height)
    },
    async describe(request) {
      const script = deps.getEnv().BINGBONG_VISION_DESCRIPTION_SCRIPT?.trim()
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

      const { describeMs } = timeouts()
      return complete(request.image, request.prompt, { thinking: 'disabled', maxTokens: DESCRIBE_MAX_TOKENS, timeoutMs: describeMs })
    },
  }
}
