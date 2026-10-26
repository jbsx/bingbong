import { createHash } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

// A stand-in for ElevenLabs' realtime speech-to-text socket (#463), as
// /v1/systemone is stood in for Jev: the app's cloud ear connects to it by
// BINGBONG_ELEVENLABS_URL. It answers the first audio with a partial, and
// the commit with the committed words — or, scripted to fail, with an
// error event. A WebSocket server on node:http alone (RFC 6455's handshake
// and text frames), since the repo carries no socket library.

export interface EarSession {
  url: string
  headers: IncomingHttpHeaders
  /** When the socket opened, and when its first audio came (epoch ms). */
  openedAt: number
  firstAudioAt: number | null
  audioBytes: number
  committed: boolean
}

export interface EarStandIn {
  /** The realtime endpoint to name in BINGBONG_ELEVENLABS_URL. */
  readonly url: string
  readonly sessions: EarSession[]
  /** What the next sessions answer: the partial at the first audio, then the commit's words or an error event. */
  script: { partial: string; committed: string } | { partial: string; error: string }
  close(): Promise<void>
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
  return Buffer.concat([header, payload])
}

/** Client frames, unmasked, from a growing buffer; returns the opcode/payload pairs read and what is left. */
function readFrames(buffer: Buffer): { frames: { opcode: number; payload: Buffer }[]; rest: Buffer } {
  const frames: { opcode: number; payload: Buffer }[] = []
  let offset = 0
  for (;;) {
    if (buffer.length - offset < 2) break
    const opcode = buffer[offset]! & 0x0f
    const masked = (buffer[offset + 1]! & 0x80) !== 0
    let length = buffer[offset + 1]! & 0x7f
    let at = offset + 2
    if (length === 126) {
      if (buffer.length < at + 2) break
      length = buffer.readUInt16BE(at)
      at += 2
    } else if (length === 127) {
      if (buffer.length < at + 8) break
      length = Number(buffer.readBigUInt64BE(at))
      at += 8
    }
    const mask = masked ? buffer.subarray(at, at + 4) : null
    if (masked) at += 4
    if (buffer.length < at + length) break
    const payload = Buffer.from(buffer.subarray(at, at + length))
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i]! ^= mask[i % 4]!
    frames.push({ opcode, payload })
    offset = at + length
  }
  return { frames, rest: buffer.subarray(offset) }
}

export async function startElevenLabsStandIn(): Promise<EarStandIn> {
  const sessions: EarSession[] = []
  const sockets = new Set<Duplex>()
  const standIn = {
    script: { partial: 'Scroll', committed: 'Scroll down.' } as EarStandIn['script'],
  }
  const server: Server = createServer((_request, response) => {
    response.writeHead(426)
    response.end()
  })
  server.on('upgrade', (request, socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const accept = createHash('sha1')
      .update(`${String(request.headers['sec-websocket-key'])}${GUID}`)
      .digest('base64')
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'))
    const session: EarSession = { url: request.url ?? '', headers: request.headers, openedAt: Date.now(), firstAudioAt: null, audioBytes: 0, committed: false }
    sessions.push(session)
    const script = standIn.script
    const send = (message: object): void => {
      if (!socket.destroyed) socket.write(textFrame(JSON.stringify(message)))
    }
    send({ message_type: 'session_started', session_id: `stand-in-${sessions.length}`, config: {} })
    let pending: Buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      const read = readFrames(Buffer.concat([pending, chunk]))
      pending = read.rest
      for (const frame of read.frames) {
        if (frame.opcode === 0x8) {
          socket.end()
          return
        }
        if (frame.opcode !== 0x1) continue
        const message = JSON.parse(frame.payload.toString('utf8')) as { audio_base_64: string; commit: boolean }
        const bytes = Buffer.from(message.audio_base_64, 'base64').length
        if (bytes > 0 && session.firstAudioAt === null) {
          session.firstAudioAt = Date.now()
          send({ message_type: 'partial_transcript', text: script.partial })
        }
        session.audioBytes += bytes
        if (message.commit) {
          session.committed = true
          if ('error' in script) send({ message_type: 'quota_exceeded', error: script.error })
          else send({ message_type: 'committed_transcript', text: script.committed })
        }
      }
    })
    socket.on('error', () => socket.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return Object.assign(standIn, {
    url: `ws://127.0.0.1:${port}/v1/speech-to-text/realtime`,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  })
}
