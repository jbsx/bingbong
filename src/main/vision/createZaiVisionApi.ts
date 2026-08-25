import { resolveModelEndpoint } from '../../core/agent/modelRouting'
import { VisionDeadlineError } from '../../core/ports/vision'
import type { VisionLocation, VisionModel } from '../../core/ports/vision'

/**
 * Direct chat-completions adapter for the vision role (ADR 0008). The Z.ai
 * MCP server hard-locks reasoning on, which costs ~7x latency on Describe
 * calls and crashes under a token cap; calling the same OpenAI-compatible
 * endpoint the orchestrator uses gives us every lever and drops the child
 * process, temp files, and stdio hop entirely. Requests stream so the
 * deadline can tell hung from slow (ADR 0016); streaming is otherwise an
 * implementation detail.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Answer-bounded output caps per capability (ADR 0008: fast vs precise paths). */
export const DESCRIBE_MAX_TOKENS = 128
export const LOCATE_MAX_TOKENS = 512

/** Per-capability whole-Look deadlines — safety nets against endpoint
 * variance, not targets. */
export const DESCRIBE_TIMEOUT_MS = 15_000
export const LOCATE_TIMEOUT_MS = 60_000
/** A Look that has not begun answering within this window is hung, not
 * slow — it fails immediately (ADR 0016). */
export const FIRST_TOKEN_TIMEOUT_MS = 8_000
/** Locate gets four times Describe's deadline; the env override scales both. */
const LOCATE_TO_DESCRIBE_RATIO = LOCATE_TIMEOUT_MS / DESCRIBE_TIMEOUT_MS
/** Upper bound on the seconds-style override: legacy milliseconds values
 * (e.g. 30000) must fall back to defaults, never become ~8-hour deadlines. */
const MAX_OVERRIDE_SECONDS = 600

export interface VisionTimeouts {
  describeMs: number
  locateMs: number
  firstTokenMs: number
}

/**
 * One env var (seconds) scales both whole-Look deadlines proportionally —
 * the override exists for debugging, not per-capability tuning. Non-positive,
 * non-numeric, or implausibly large values (legacy milliseconds) fall back
 * to the defaults. The time-to-first-token window scales down with a lowered
 * Describe cap (it can never exceed the whole-Look deadline it guards) but
 * never grows past its default: a hung request is hung at any cap size.
 */
export function resolveVisionTimeouts(env: Record<string, string | undefined>): VisionTimeouts {
  const raw = Number(env.BINGBONG_VISION_TIMEOUT_MS)
  const describeMs = Number.isFinite(raw) && raw > 0 && raw <= MAX_OVERRIDE_SECONDS ? raw * 1_000 : DESCRIBE_TIMEOUT_MS
  return {
    describeMs,
    locateMs: describeMs * LOCATE_TO_DESCRIBE_RATIO,
    firstTokenMs: Math.min(FIRST_TOKEN_TIMEOUT_MS, describeMs),
  }
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

/** One scripted env hook (e2e harness): parse and validate the script, keep the
 * queue for consumption, re-parsing when the env value changes. */
function createScriptedQueue<T>(name: string, exhaustedMessage: string, validate: (parsed: unknown) => parsed is T[]): {
  next(source: string): T
} {
  let source: string | undefined
  let queue: T[] = []
  return {
    next(raw: string): T {
      if (raw !== source) {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (!validate(parsed)) throw new Error(`${name} has the wrong shape`)
        queue = [...parsed]
        source = raw
      }
      const next = queue.shift()
      if (next === undefined) throw new Error(exhaustedMessage)
      return next
    },
  }
}

/**
 * Reads an OpenAI-compatible SSE stream, returning the accumulated content.
 * `onFirstToken` fires once — on the first model token of any kind (content
 * or reasoning) — because that is the evidence the exchange is generating
 * rather than hung (ADR 0016). Parses per the SSE event model: `data:` lines
 * of one event join with newlines before JSON parsing, so a payload the
 * provider split across lines is not silently dropped.
 */
async function readSseStream(response: Response, onFirstToken: () => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Vision response had no body')
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let content = ''
  let sawToken = false
  const dispatchEvent = (): void => {
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n').trim()
    dataLines = []
    if (payload === '' || payload === '[DONE]') return
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    const delta = (parsed as { choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[] })
      .choices?.[0]?.delta
    const text = typeof delta?.content === 'string' ? delta.content : ''
    const reasoning = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : ''
    if (!sawToken && (text !== '' || reasoning !== '')) {
      sawToken = true
      onFirstToken()
    }
    content += text
  }
  const consumeLine = (line: string): void => {
    // A blank line ends an event; a `data:` line feeds the current one. Per
    // the SSE spec, only a single leading space after the field name is
    // stripped. Comment (`:…`) and other fields are ignored.
    if (line === '') {
      dispatchEvent()
      return
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      consumeLine(buffer.slice(0, newline).replace(/\r$/, ''))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
  consumeLine(buffer.replace(/\r$/, ''))
  dispatchEvent()
  return content
}

export function createZaiVisionApi(deps: ZaiVisionApiDeps): VisionModel {
  const doFetch = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init))

  function timeouts(): VisionTimeouts {
    if (deps.timeoutMs) return deps.timeoutMs
    return resolveVisionTimeouts(deps.getEnv())
  }

  async function complete(
    image: Uint8Array,
    prompt: string,
    options: { thinking: 'enabled' | 'disabled'; maxTokens: number; timeoutMs: number; firstTokenMs: number },
  ): Promise<string> {
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
      // Streaming exists solely to make progress observable (ADR 0016): the
      // deadline can tell a hung request from a slowly generating one.
      stream: true,
    }
    // Streaming vision deadlines (ADR 0016): the exchange must begin
    // answering within the time-to-first-token window or it is hung and
    // fails immediately; once tokens flow, only the whole-Look cap bounds
    // the rest — total wall-clock never exceeds the per-capability cap.
    const firstTokenMs = Math.min(options.firstTokenMs, options.timeoutMs)
    let firstTokenSeen = false
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined
    let wholeLookTimer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const deadline = new Promise<never>((_, reject) => {
      firstTokenTimer = setTimeout(() => {
        if (!firstTokenSeen) reject(new VisionDeadlineError(firstTokenMs, 'first-token'))
      }, firstTokenMs)
      wholeLookTimer = setTimeout(() => reject(new VisionDeadlineError(options.timeoutMs)), options.timeoutMs)
    })
    const exchange = (async () => {
      const response = await doFetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Vision request failed (HTTP ${await readError(response)})`)
      const content = await readSseStream(response, () => {
        firstTokenSeen = true
        clearTimeout(firstTokenTimer)
      })
      if (content.trim() === '') {
        throw new Error('Vision model returned no content')
      }
      return content
    })()
    try {
      return await Promise.race([exchange, deadline])
    } finally {
      clearTimeout(firstTokenTimer)
      clearTimeout(wholeLookTimer)
      // Abort whether the exchange won or lost: the socket is freed and
      // spend stopped even if the loser is still pending.
      controller.abort()
    }
  }

  // Scripted test hooks (e2e harness): deterministic points/descriptions
  // instead of live model calls, mirroring the old MCP locator's hooks.
  const locationScript = createScriptedQueue(
    'BINGBONG_VISION_SCRIPT',
    'BINGBONG_VISION_SCRIPT ran out of points',
    (parsed): parsed is Record<string, unknown>[] => Array.isArray(parsed),
  )
  const descriptionScript = createScriptedQueue(
    'BINGBONG_VISION_DESCRIPTION_SCRIPT',
    'BINGBONG_VISION_DESCRIPTION_SCRIPT ran out of descriptions',
    (parsed): parsed is string[] => Array.isArray(parsed) && parsed.every((value) => typeof value === 'string'),
  )

  return {
    async locate(request) {
      const script = deps.getEnv().BINGBONG_VISION_SCRIPT?.trim()
      if (script) {
        const next = locationScript.next(script)
        return parsePoint(JSON.stringify(next), request.viewport.width, request.viewport.height)
      }

      const { locateMs, firstTokenMs } = timeouts()
      const answer = await complete(
        request.image,
        `Locate ${JSON.stringify(request.target)} in this browser screenshot. ` +
          `The viewport is ${request.viewport.width}x${request.viewport.height} CSS pixels. ` +
          'Return only JSON with the center point in viewport pixels: {"x": number, "y": number}.',
        { thinking: 'enabled', maxTokens: LOCATE_MAX_TOKENS, timeoutMs: locateMs, firstTokenMs },
      )
      return parsePoint(answer, request.viewport.width, request.viewport.height)
    },
    async describe(request) {
      const script = deps.getEnv().BINGBONG_VISION_DESCRIPTION_SCRIPT?.trim()
      if (script) return descriptionScript.next(script)

      const { describeMs, firstTokenMs } = timeouts()
      // Advisory budget (#106, ADR 0016): a caller-supplied cap can only
      // shrink the Look — clamped to the configured cap — and the Vision
      // Deadline (first-token window) keeps the default 8:15 ratio to it
      // (never above the configured window), so a hung advisory request
      // dies proportionally sooner.
      const capMs = request.lookCapMs === undefined ? describeMs : Math.min(request.lookCapMs, describeMs)
      const advisoryFirstTokenMs = Math.min(firstTokenMs, Math.round((capMs * FIRST_TOKEN_TIMEOUT_MS) / DESCRIBE_TIMEOUT_MS))
      return complete(request.image, request.prompt, {
        thinking: 'disabled',
        maxTokens: DESCRIBE_MAX_TOKENS,
        timeoutMs: capMs,
        firstTokenMs: request.lookCapMs === undefined ? firstTokenMs : advisoryFirstTokenMs,
      })
    },
  }
}
