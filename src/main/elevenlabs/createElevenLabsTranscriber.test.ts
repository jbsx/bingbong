import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transcriber } from '../../core/ports/stt'
import { CLOUD_COMMIT_TIMEOUT_MS, createElevenLabsTranscriber, type EarSocketEvents, type OpenEarSocket } from './createElevenLabsTranscriber'

// The cloud ear (#463): one socket per Utterance, partials to the Hearing
// phase, a manual commit at the Endpoint, and Parakeet behind it on any
// fault or a commit later than 1.5 s (grill ruling 9).

interface FakeSocket {
  url: string
  headers: Readonly<Record<string, string>>
  events: EarSocketEvents
  sent: { message_type: string; audio_base_64: string; commit: boolean }[]
  closed: boolean
}

function fakeSockets(): { open: OpenEarSocket; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = []
  return {
    sockets,
    open: (url, headers, events) => {
      const socket: FakeSocket = { url, headers, events, sent: [], closed: false }
      sockets.push(socket)
      return {
        send: (data) => socket.sent.push(JSON.parse(data) as FakeSocket['sent'][number]),
        close: () => {
          socket.closed = true
        },
      }
    },
  }
}

function fakeParakeet(text = 'parakeet words'): Transcriber & { finished: Float32Array[] } {
  const finished: Float32Array[] = []
  return {
    engine: 'parakeet',
    finished,
    begin: () => {},
    push: () => {},
    onPartial: () => () => {},
    finish: async (pcm) => {
      finished.push(pcm)
      return text
    },
    cancel: () => {},
    prepare: vi.fn(async () => {}),
  }
}

const frame = (value = 0.5): Float32Array => new Float32Array(512).fill(value)
const samplesSent = (socket: FakeSocket): number => socket.sent.reduce((sum, m) => sum + Buffer.from(m.audio_base_64, 'base64').length / 2, 0)
const reply = (socket: FakeSocket, message: object): void => socket.events.message(JSON.stringify(message))

describe('createElevenLabsTranscriber', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens at the listen with the key, the realtime model, manual commit and the keyterms', () => {
    const { open, sockets } = fakeSockets()
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, keyterms: () => ['Niyam', 'Tum Se Tum Tak'] })
    ear.listenOpened?.()
    expect(sockets).toHaveLength(1)
    const url = new URL(sockets[0]!.url)
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime')
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000')
    expect(url.searchParams.get('commit_strategy')).toBe('manual')
    expect(url.searchParams.getAll('keyterms')).toEqual(['Niyam', 'Tum Se Tum Tak'])
    // The list it was asked with, for the stt span (#471).
    expect(ear.keyterms).toEqual(['Niyam', 'Tum Se Tum Tak'])
    expect(sockets[0]!.headers['xi-api-key']).toBe('k')
    // Speech in the same listen rides the socket the wake opened.
    ear.begin()
    expect(sockets).toHaveLength(1)
  })

  it('sends the pre-roll, the frames and the Endpoint frame, then commits; the committed words are the final', async () => {
    const { open, sockets } = fakeSockets()
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: fakeParakeet() })
    const partials: string[] = []
    ear.onPartial((text) => partials.push(text))
    ear.begin(new Float32Array(5 * 512))
    for (let i = 0; i < 6; i += 1) ear.push(frame())
    const socket = sockets[0]!
    // Nothing goes out before the socket is open; the queue flushes on open.
    expect(socket.sent).toHaveLength(0)
    socket.events.open()
    reply(socket, { message_type: 'partial_transcript', text: 'Play Tum' })
    const final = ear.finish(new Float32Array(12 * 512))
    expect(socket.sent.at(-1)?.commit).toBe(true)
    expect(samplesSent(socket)).toBe(12 * 512)
    reply(socket, { message_type: 'committed_transcript', text: 'Play Tum Se Tum Tak by Niyam.' })
    await expect(final).resolves.toBe('Play Tum Se Tum Tak by Niyam.')
    expect(partials).toEqual(['Play Tum'])
    expect(ear.engine).toBe('elevenlabs')
    // The socket closes at the Endpoint (grill ruling 7).
    expect(socket.closed).toBe(true)
  })

  it('hands the same PCM to Parakeet on an error event, with a voice.ear.cloud fault', async () => {
    const { open, sockets } = fakeSockets()
    const parakeet = fakeParakeet()
    const faults: Error[] = []
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: parakeet, onFault: (error) => faults.push(error) })
    ear.begin()
    sockets[0]!.events.open()
    ear.push(frame())
    reply(sockets[0]!, { message_type: 'quota_exceeded', error: 'out of hours' })
    const pcm = new Float32Array(2048)
    await expect(ear.finish(pcm)).resolves.toBe('parakeet words')
    expect(parakeet.finished).toEqual([pcm])
    expect(faults[0]?.message).toContain('quota_exceeded')
    expect(ear.engine).toBe('parakeet')
  })

  it('hands the line to Parakeet when no committed transcript comes within 1.5 s of the Endpoint', async () => {
    const { open, sockets } = fakeSockets()
    const parakeet = fakeParakeet()
    const faults: Error[] = []
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: parakeet, onFault: (error) => faults.push(error) })
    ear.begin()
    sockets[0]!.events.open()
    const final = ear.finish(new Float32Array(2048))
    await vi.advanceTimersByTimeAsync(CLOUD_COMMIT_TIMEOUT_MS - 1)
    expect(parakeet.finished).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await expect(final).resolves.toBe('parakeet words')
    expect(faults[0]?.message).toContain('no committed transcript')
    // A commit that comes late changes nothing.
    reply(sockets[0]!, { message_type: 'committed_transcript', text: 'late' })
  })

  it('hands the line to Parakeet when the socket drops mid-Utterance', async () => {
    const { open, sockets } = fakeSockets()
    const parakeet = fakeParakeet()
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: parakeet, onFault: () => {} })
    ear.begin()
    sockets[0]!.events.closed('socket error')
    await expect(ear.finish(new Float32Array(1024))).resolves.toBe('parakeet words')
  })

  it('lets go a socket the listen opened that closed before any speech, and opens another', async () => {
    const { open, sockets } = fakeSockets()
    const faults: Error[] = []
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: fakeParakeet(), onFault: (error) => faults.push(error) })
    ear.listenOpened?.()
    sockets[0]!.events.closed('closed 1000')
    ear.begin()
    expect(sockets).toHaveLength(2)
    sockets[1]!.events.open()
    const final = ear.finish(new Float32Array(1024))
    reply(sockets[1]!, { message_type: 'committed_transcript', text: 'back' })
    await expect(final).resolves.toBe('back')
    expect(faults).toHaveLength(0)
  })

  it('opens a new socket for the next Utterance, and a blip closes its own', () => {
    const { open, sockets } = fakeSockets()
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open })
    ear.begin()
    ear.cancel()
    expect(sockets[0]!.closed).toBe(true)
    ear.begin()
    expect(sockets).toHaveLength(2)
  })

  it('a listen closing under the final leaves the wait to finish, with no fault', async () => {
    const { open, sockets } = fakeSockets()
    const faults: Error[] = []
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: fakeParakeet(), onFault: (error) => faults.push(error) })
    ear.begin()
    sockets[0]!.events.open()
    const final = ear.finish(new Float32Array(1024))
    ear.cancel()
    reply(sockets[0]!, { message_type: 'committed_transcript', text: 'stop' })
    await expect(final).resolves.toBe('stop')
    expect(faults).toHaveLength(0)
  })

  it('says how much audio each final sent, the fallback line included', async () => {
    const { open, sockets } = fakeSockets()
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: open, fallback: fakeParakeet(), onFault: () => {} })
    ear.begin()
    sockets[0]!.events.open()
    const final = ear.finish(new Float32Array(32_000))
    reply(sockets[0]!, { message_type: 'committed_transcript', text: 'x' })
    await final
    expect(ear.sentMs).toBe(2_000)
    ear.begin()
    sockets[1]!.events.closed('socket error')
    await ear.finish(new Float32Array(16_000))
    expect(ear.sentMs).toBe(1_000)
    expect(ear.engine).toBe('parakeet')
  })

  it('warms Parakeet at prepare: it stays loaded behind the cloud', async () => {
    const parakeet = fakeParakeet()
    const ear = createElevenLabsTranscriber({ apiKey: 'k', openSocket: fakeSockets().open, fallback: parakeet })
    await ear.prepare?.()
    expect(parakeet.prepare).toHaveBeenCalledOnce()
  })
})
