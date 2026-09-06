import { resolveModelEndpoint } from '../../core/agent/modelRouting'
import { VisionDeadlineError } from '../../core/ports/vision'
import type {
  VisionAttemptEnding,
  VisionAttemptObservation,
  VisionAttemptObserver,
  VisionLocation,
  VisionModel,
} from '../../core/ports/vision'
import { reportFault } from '../../core/trace/fault'

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
  } catch (error) {
    reportFault('vision.createZaiVisionApi.parsePoint', error)
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

/**
 * The failure line for a non-2xx response, and how many bytes its body cost.
 * The count matters because this path reads the body itself rather than
 * through the instrumented stream (#204): without it the attempt would
 * record no bytes at all, and an absent first byte means "the body stayed
 * silent" — which would be a guess, and a wrong one.
 */
async function readError(response: Response): Promise<{ line: string; bytes: number }> {
  const body = await response.text().catch(() => '')
  const excerpt = body.slice(0, 200).replace(/\s+/g, ' ').trim()
  return {
    line: excerpt ? `${response.status}: ${excerpt}` : String(response.status),
    bytes: Buffer.byteLength(body),
  }
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
 * What one attempt observed happening on the wire (#204). The adapter turns
 * these into milestones; the reader stays a reader. `delta` is the signal the
 * Vision Deadline has always keyed off — an event carrying recognized
 * reasoning or content text — so recording it changes nothing about which
 * events satisfy the deadline, only whether anyone can see which ones did.
 */
export type VisionStreamSignal =
  /** A body chunk arrived. */
  | { readonly kind: 'bytes'; readonly bytes: number }
  /** A parsed event carried recognized generation text. */
  | { readonly kind: 'delta'; readonly reasoningChars: number; readonly contentChars: number }
  /** A parsed event carried no recognized reasoning or content. */
  | { readonly kind: 'unrecognized' }
  /** A payload this adapter could not parse. */
  | { readonly kind: 'malformed' }
  /** The `[DONE]` frame arrived. */
  | { readonly kind: 'done' }
  /** The body stream ended. */
  | { readonly kind: 'end' }

/**
 * Reads an OpenAI-compatible SSE stream, returning the accumulated content.
 * `onSignal` fires as the stream is consumed — the first `delta` is the
 * evidence the exchange is generating rather than hung (ADR 0016), and the
 * rest is what the attempt observed on the way (#204). Parses per the SSE
 * event model: `data:` lines of one event join with newlines before JSON
 * parsing, so a payload the provider split across lines is not silently
 * dropped.
 */
async function readSseStream(response: Response, onSignal: (signal: VisionStreamSignal) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Vision response had no body')
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let content = ''
  const dispatchEvent = (): void => {
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n').trim()
    dataLines = []
    if (payload === '') return
    if (payload === '[DONE]') {
      onSignal({ kind: 'done' })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch (error) {
      reportFault('vision.createZaiVisionApi.readSseStream', error)
      // Unrecognized stream content is a finding, not silence (#204).
      onSignal({ kind: 'malformed' })
      return
    }
    const delta = (parsed as { choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[] })
      .choices?.[0]?.delta
    const text = typeof delta?.content === 'string' ? delta.content : ''
    const reasoning = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : ''
    if (text === '' && reasoning === '') {
      onSignal({ kind: 'unrecognized' })
      return
    }
    onSignal({ kind: 'delta', reasoningChars: reasoning.length, contentChars: text.length })
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
    onSignal({ kind: 'bytes', bytes: value.byteLength })
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
  onSignal({ kind: 'end' })
  return content
}

/** The endpoint answered with a non-2xx status. Typed so the attempt record
 * can say so without reading its own message back (#204). */
class VisionHttpError extends Error {}

/** The stream completed carrying no answer content. */
class VisionEmptyCompletionError extends Error {}

/** What an attempt is asked to record about itself, beyond what it observes. */
interface AttemptRecorderInput {
  readonly firstTokenLimitMs: number
  readonly wholeLookLimitMs: number
  readonly requestedCapMs?: number | undefined
  readonly model: string
  readonly maxTokens: number
  readonly thinking: 'enabled' | 'disabled'
  /** Milliseconds since the request was sent. */
  since(): number
  readonly observe?: VisionAttemptObserver | undefined
}

interface AttemptRecorder {
  /** Response headers arrived. */
  response(status: number): void
  /** One thing the stream did. */
  signal(signal: VisionStreamSignal): void
  /** Whether the first-token window has been satisfied. */
  sawFirstToken(): boolean
  /** Reports the attempt once, at settlement. Later calls are ignored. */
  emit(ending: VisionAttemptEnding, message?: string): void
}

/**
 * Collects one attempt's milestones and reports them exactly once (#204).
 *
 * Once, because a Look that already failed its deadline can still have a
 * stream arrive behind it: the record describes the attempt as its caller
 * saw it settle, and a late frame cannot rewrite that. The report is a
 * snapshot for the same reason. Absent fields are absent on purpose — a
 * milestone that never happened is never guessed at.
 */
function createAttemptRecorder(input: AttemptRecorderInput): AttemptRecorder {
  let responseAtMs: number | undefined
  let responseStatus: number | undefined
  let firstByteAtMs: number | undefined
  let firstReasoningAtMs: number | undefined
  let firstContentAtMs: number | undefined
  let firstTokenKind: 'reasoning' | 'content' | undefined
  let streamEndAtMs: number | undefined
  let bytesRead = 0
  let streamEvents = 0
  let progressEvents = 0
  let malformedEvents = 0
  let sawDone = false
  let reasoningChars = 0
  let contentChars = 0
  let emitted = false
  return {
    response(status) {
      if (responseAtMs === undefined) responseAtMs = input.since()
      responseStatus = status
    },
    signal(signal) {
      switch (signal.kind) {
        case 'bytes':
          if (firstByteAtMs === undefined) firstByteAtMs = input.since()
          bytesRead += signal.bytes
          return
        case 'delta': {
          streamEvents += 1
          progressEvents += 1
          const at = input.since()
          // The kind that satisfied the window. An event carrying both is
          // credited to reasoning: providers emit it first, and the two
          // cannot be ordered inside one frame.
          if (firstTokenKind === undefined) firstTokenKind = signal.reasoningChars > 0 ? 'reasoning' : 'content'
          if (signal.reasoningChars > 0 && firstReasoningAtMs === undefined) firstReasoningAtMs = at
          if (signal.contentChars > 0 && firstContentAtMs === undefined) firstContentAtMs = at
          reasoningChars += signal.reasoningChars
          contentChars += signal.contentChars
          return
        }
        case 'unrecognized':
          streamEvents += 1
          return
        case 'malformed':
          malformedEvents += 1
          return
        case 'done':
          sawDone = true
          return
        case 'end':
          if (streamEndAtMs === undefined) streamEndAtMs = input.since()
      }
    },
    sawFirstToken() {
      return firstTokenKind !== undefined
    },
    emit(ending, message) {
      if (emitted) return
      emitted = true
      const observe = input.observe
      if (observe === undefined) return
      const observation: VisionAttemptObservation = {
        ending,
        firstTokenLimitMs: input.firstTokenLimitMs,
        wholeLookLimitMs: input.wholeLookLimitMs,
        ...(input.requestedCapMs === undefined ? {} : { requestedCapMs: input.requestedCapMs }),
        model: input.model,
        maxTokens: input.maxTokens,
        thinking: input.thinking,
        ...(responseAtMs === undefined ? {} : { responseAtMs }),
        ...(responseStatus === undefined ? {} : { responseStatus }),
        ...(firstByteAtMs === undefined ? {} : { firstByteAtMs }),
        ...(firstReasoningAtMs === undefined ? {} : { firstReasoningAtMs }),
        ...(firstContentAtMs === undefined ? {} : { firstContentAtMs }),
        ...(firstTokenKind === undefined ? {} : { firstTokenKind }),
        ...(streamEndAtMs === undefined ? {} : { streamEndAtMs }),
        settledAtMs: input.since(),
        bytesRead,
        streamEvents,
        progressEvents,
        malformedEvents,
        sawDone,
        reasoningChars,
        contentChars,
        ...(message === undefined ? {} : { message }),
      }
      try {
        observe(observation)
      } catch (error) {
        // A diagnostic must never fail the Look it describes.
        reportFault('vision.createZaiVisionApi.observe', error)
      }
    },
  }
}

/** How the attempt ended, from what it threw — never from its duration. */
function endingOf(error: unknown): VisionAttemptEnding {
  if (error instanceof VisionDeadlineError) {
    return error.phase === 'first-token' ? 'first_token_deadline' : 'whole_look_deadline'
  }
  if (error instanceof VisionHttpError) return 'http_error'
  if (error instanceof VisionEmptyCompletionError) return 'empty_completion'
  if (error instanceof Error && error.name === 'AbortError') return 'aborted'
  return 'stream_error'
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
    options: {
      thinking: 'enabled' | 'disabled'
      maxTokens: number
      timeoutMs: number
      firstTokenMs: number
      /** The advisory cap the caller asked for, before clamping (#204). */
      requestedCapMs?: number | undefined
      /** Where this attempt reports its milestones (#204). */
      observe?: VisionAttemptObserver | undefined
    },
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
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined
    let wholeLookTimer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    // The attempt's own record (#204). It observes; it never decides — the
    // deadlines below fire off the same first `delta` they always have.
    const startedAt = Date.now()
    const attempt = createAttemptRecorder({
      firstTokenLimitMs: firstTokenMs,
      wholeLookLimitMs: options.timeoutMs,
      requestedCapMs: options.requestedCapMs,
      model: endpoint.model,
      maxTokens: options.maxTokens,
      thinking: options.thinking,
      since: () => Date.now() - startedAt,
      observe: options.observe,
    })
    const deadline = new Promise<never>((_, reject) => {
      firstTokenTimer = setTimeout(() => {
        if (!attempt.sawFirstToken()) reject(new VisionDeadlineError(firstTokenMs, 'first-token'))
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
      attempt.response(response.status)
      if (!response.ok) {
        // Read in one call, not streamed: the first byte this records is the
        // moment the body became observable, which is what was observed.
        const failure = await readError(response)
        if (failure.bytes > 0) attempt.signal({ kind: 'bytes', bytes: failure.bytes })
        throw new VisionHttpError(`Vision request failed (HTTP ${failure.line})`)
      }
      const content = await readSseStream(response, (signal) => {
        attempt.signal(signal)
        if (signal.kind === 'delta') clearTimeout(firstTokenTimer)
      })
      if (content.trim() === '') {
        throw new VisionEmptyCompletionError('Vision model returned no content')
      }
      return content
    })()
    try {
      const answer = await Promise.race([exchange, deadline])
      attempt.emit('answered')
      return answer
    } catch (error) {
      attempt.emit(endingOf(error), error instanceof Error ? error.message : String(error))
      throw error
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
        {
          thinking: 'enabled',
          maxTokens: LOCATE_MAX_TOKENS,
          timeoutMs: locateMs,
          firstTokenMs,
          observe: request.observe,
        },
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
        maxTokens: request.maxTokens ?? DESCRIBE_MAX_TOKENS,
        timeoutMs: capMs,
        firstTokenMs: request.lookCapMs === undefined ? firstTokenMs : advisoryFirstTokenMs,
        requestedCapMs: request.lookCapMs,
        observe: request.observe,
      })
    },
  }
}
