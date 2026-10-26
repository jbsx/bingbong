import type { Transcriber } from '../../core/ports/stt'

// The cloud ear (#463, ADR 0019 as amended 2026-10-26): ElevenLabs Scribe
// v2 Realtime over its websocket, a seven-day trial behind `sttEngine`.
// One socket per Utterance: 16 kHz PCM in as the frames arrive, partials
// out to the Hearing phase as Parakeet's are (ADR 0094), and a manual
// commit at the Endpoint whose committed transcript is the final. Parakeet
// stays loaded behind it: any fault, or no committed transcript within
// 1.5 s of the Endpoint, hands the same Utterance's PCM to Parakeet
// (grill ruling 9) — the fallback code keeps, not a second ear.

/** The realtime endpoint (docs: api-reference/speech-to-text/v-1-speech-to-text-realtime). */
export const ELEVENLABS_REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'

/**
 * How long after the Endpoint the committed transcript may take before
 * Parakeet hears the line instead. A guess (grill ruling 9): the dev-PC
 * replay saw ~0.4–0.6 s; the live `stt` span settles it.
 */
export const CLOUD_COMMIT_TIMEOUT_MS = 1_500

/** Frames batched into one audio message: 4 × 32 ms. */
const FRAMES_PER_CHUNK = 4
const FRAME_SAMPLES = 512

/** The socket surface the ear needs; the default is Node's own WebSocket. */
export interface EarSocket {
  send(data: string): void
  close(): void
}

export interface EarSocketEvents {
  open(): void
  message(data: string): void
  /** The socket closed or failed; `detail` says how. */
  closed(detail: string): void
}

export type OpenEarSocket = (url: string, headers: Readonly<Record<string, string>>, events: EarSocketEvents) => EarSocket

export interface ElevenLabsTranscriberDeps {
  apiKey: string
  /** The realtime endpoint; a stand-in server's in e2e (BINGBONG_ELEVENLABS_URL). */
  url?: string
  /** The keyterms for the Utterance about to be heard, read at each socket open (grill ruling 8). */
  keyterms?: () => readonly string[]
  /** Parakeet, warm: hears the line when the cloud cannot. Absent, a cloud fault rejects the final. */
  fallback?: Transcriber
  /** A cloud fault that sent the line to the fallback: the `voice.ear.cloud` record. */
  onFault?: (error: Error) => void
  openSocket?: OpenEarSocket
  commitTimeoutMs?: number
}

/** A transcriber that also says which engine heard its last final, and how much audio it sent (the usage tally, grill ruling 11). */
export interface CloudTranscriber extends Transcriber {
  /** The engine whose words the last finish() resolved with: the cloud, or the fallback. */
  readonly engine: string
  readonly sentMs: number
}

const ERROR_TYPES = new Set([
  'error',
  'auth_error',
  'quota_exceeded',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'input_error',
  'invalid_request',
  'chunk_size_exceeded',
  'insufficient_audio_activity',
  'transcriber_error',
])

/** Node's WebSocket (undici) takes request headers as a second-argument option, which the DOM typing does not know. */
export const openNodeSocket: OpenEarSocket = (url, headers, events) => {
  const Socket = globalThis.WebSocket as unknown as new (url: string, options: { headers: Readonly<Record<string, string>> }) => WebSocket
  const socket = new Socket(url, { headers })
  let done = false
  const closed = (detail: string): void => {
    if (done) return
    done = true
    events.closed(detail)
  }
  socket.addEventListener('open', () => events.open())
  socket.addEventListener('message', (event) => events.message(typeof event.data === 'string' ? event.data : String(event.data)))
  socket.addEventListener('error', () => closed('socket error'))
  socket.addEventListener('close', (event) => closed(`closed ${String(event.code)}${event.reason ? ` ${event.reason}` : ''}`))
  return {
    send: (data) => {
      if (socket.readyState === 1) socket.send(data)
    },
    close: () => {
      done = true
      socket.close()
    },
  }
}

function toPcm16Base64(samples: Float32Array): string {
  const bytes = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!))
    bytes.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), i * 2)
  }
  return bytes.toString('base64')
}

interface Connection {
  socket: EarSocket
  open: boolean
  queue: string[]
  /** Committed segments so far (the model also commits on its own after ~36 s). */
  committed: string[]
  commitSent: boolean
  fault: string | null
  settle: ((outcome: { text: string } | { fault: string }) => void) | null
}

export function createElevenLabsTranscriber(deps: ElevenLabsTranscriberDeps): CloudTranscriber {
  const openSocket = deps.openSocket ?? openNodeSocket
  const commitTimeoutMs = deps.commitTimeoutMs ?? CLOUD_COMMIT_TIMEOUT_MS
  const listeners = new Set<(text: string) => void>()
  let connection: Connection | null = null
  let capturing = false
  let pending: Float32Array[] = []
  let sentSamples = 0
  let lastEngine = 'elevenlabs'
  let lastSentMs = 0

  function url(): string {
    const query = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'manual', language_code: 'en' })
    for (const term of deps.keyterms?.() ?? []) query.append('keyterms', term)
    return `${deps.url ?? ELEVENLABS_REALTIME_URL}?${query.toString()}`
  }

  function faultOn(conn: Connection, detail: string): void {
    if (conn.fault !== null) return
    conn.fault = detail
    conn.settle?.({ fault: detail })
  }

  function connect(): Connection {
    if (connection !== null) return connection
    const conn: Connection = { socket: { send: () => {}, close: () => {} }, open: false, queue: [], committed: [], commitSent: false, fault: null, settle: null }
    connection = conn
    conn.socket = openSocket(url(), { 'xi-api-key': deps.apiKey }, {
      open() {
        conn.open = true
        for (const message of conn.queue) conn.socket.send(message)
        conn.queue = []
      },
      message(data) {
        let message: { message_type?: string; text?: string; error?: string }
        try {
          message = JSON.parse(data) as typeof message
        } catch (error) {
          // A message the ear cannot read is the cloud's fault: Parakeet hears the line, and the fault record says why.
          faultOn(conn, `unreadable message: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const type = message.message_type ?? ''
        if (type === 'partial_transcript') {
          const text = (message.text ?? '').trim()
          if (connection === conn && capturing && !conn.commitSent && text !== '') for (const listener of listeners) listener(text)
        } else if (type === 'committed_transcript') {
          conn.committed.push((message.text ?? '').trim())
          if (conn.commitSent) conn.settle?.({ text: conn.committed.filter((text) => text !== '').join(' ') })
        } else if (ERROR_TYPES.has(type) || message.error !== undefined) {
          faultOn(conn, `${type || 'error'}: ${message.error ?? ''}`.trim())
        }
      },
      closed(detail) {
        // A socket opened at the listen that closes before any speech is let go; the next capture opens another.
        if (connection === conn && !capturing && !conn.commitSent) connection = null
        else faultOn(conn, detail)
      },
    })
    return conn
  }

  function send(conn: Connection, message: string): void {
    if (conn.open) conn.socket.send(message)
    else conn.queue.push(message)
  }

  function sendAudio(conn: Connection, samples: Float32Array): void {
    if (samples.length === 0) return
    sentSamples += samples.length
    send(conn, JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: toPcm16Base64(samples), commit: false, sample_rate: 16_000 }))
  }

  function flush(conn: Connection): void {
    if (pending.length === 0) return
    const samples = new Float32Array(pending.length * FRAME_SAMPLES)
    let offset = 0
    for (const frame of pending) {
      samples.set(frame, offset)
      offset += frame.length
    }
    pending = []
    sendAudio(conn, samples.subarray(0, offset))
  }

  function drop(): void {
    capturing = false
    pending = []
    sentSamples = 0
    const conn = connection
    connection = null
    conn?.socket.close()
  }

  function begin(preRoll?: Float32Array): void {
    // A socket already carrying a committed Utterance is spent: one socket per Utterance.
    if (connection !== null && connection.commitSent) drop()
    capturing = true
    pending = []
    sentSamples = 0
    const conn = connect()
    if (preRoll !== undefined) sendAudio(conn, preRoll)
  }

  async function heardByFallback(pcm: Float32Array, reason: string): Promise<string> {
    const error = new Error(`the cloud ear did not hear the line: ${reason}`)
    if (deps.fallback === undefined) throw error
    deps.onFault?.(error)
    lastEngine = deps.fallback.engine ?? 'parakeet'
    return deps.fallback.finish(pcm)
  }

  return {
    get engine() {
      return lastEngine
    },
    get sentMs() {
      return lastSentMs
    },
    listenOpened() {
      // The socket opens at the wake word (grill ruling 7): its handshake runs while the owner starts to speak. A guess; the `stt` span settles it.
      if (connection === null && deps.apiKey !== '') connect()
    },
    begin,
    push(frame) {
      if (!capturing || connection === null) return
      pending.push(frame)
      if (pending.length >= FRAMES_PER_CHUNK) flush(connection)
    },
    onPartial(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async finish(pcm) {
      lastEngine = 'elevenlabs'
      if (!capturing || connection === null) begin()
      const conn = connection!
      flush(conn)
      // What the Endpoint carries past the frames pushed: its own frame. The trailing silence the endpointer trimmed was already sent.
      if (pcm.length > sentSamples) sendAudio(conn, pcm.subarray(sentSamples))
      lastSentMs = Math.round(sentSamples / 16)
      capturing = false
      if (conn.fault !== null) {
        drop()
        return heardByFallback(pcm, conn.fault)
      }
      const outcome = await new Promise<{ text: string } | { fault: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ fault: `no committed transcript ${commitTimeoutMs} ms after the Endpoint` }), commitTimeoutMs)
        conn.settle = (result) => {
          clearTimeout(timer)
          conn.settle = null
          resolve(result)
        }
        conn.commitSent = true
        send(conn, JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16_000 }))
        if (conn.fault !== null) conn.settle({ fault: conn.fault })
      })
      // The socket closes at the Endpoint (grill ruling 7, a guess).
      if (connection === conn) drop()
      else conn.socket.close()
      if ('fault' in outcome) return heardByFallback(pcm, outcome.fault)
      return outcome.text
    },
    cancel() {
      // A listen that closes under the final's wait leaves that wait to finish(); the transcript is dropped by the session.
      if (connection?.commitSent === true) return
      drop()
    },
    prepare: async () => {
      await deps.fallback?.prepare?.()
    },
  }
}
