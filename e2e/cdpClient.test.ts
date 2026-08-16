import { describe, expect, it } from 'vitest'
import { CdpClient, type CdpSocket } from './cdpClient'

class FakeSocket implements CdpSocket {
  sent: string[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.onclose?.()
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  lastFrame(): { id: number; method: string; params?: unknown; sessionId?: string } {
    const raw = this.sent[this.sent.length - 1]
    if (!raw) throw new Error('no frames sent')
    return JSON.parse(raw)
  }
}

describe('CdpClient', () => {
  it('resolves a request with the result of the matching response id', async () => {
    const socket = new FakeSocket()
    const client = new CdpClient(socket)

    const pending = client.send<{ value: number }>('Runtime.evaluate', { expression: '1+1' })
    expect(socket.lastFrame()).toMatchObject({ id: 1, method: 'Runtime.evaluate' })
    socket.receive({ id: 1, result: { value: 2 } })

    await expect(pending).resolves.toEqual({ value: 2 })
  })

  it('correlates concurrent requests by id', async () => {
    const socket = new FakeSocket()
    const client = new CdpClient(socket)

    const first = client.send('Target.getTargets')
    const second = client.send('Browser.getVersion')
    socket.receive({ id: 2, result: { product: 'chrome' } })
    socket.receive({ id: 1, result: { targetInfos: [] } })

    await expect(first).resolves.toEqual({ targetInfos: [] })
    await expect(second).resolves.toEqual({ product: 'chrome' })
  })

  it('rejects when the response carries an error', async () => {
    const socket = new FakeSocket()
    const client = new CdpClient(socket)

    const pending = client.send('Runtime.evaluate')
    socket.receive({ id: 1, error: { code: -32601, message: "'Runtime.evaluate' wasn't found" } })

    await expect(pending).rejects.toThrow("'Runtime.evaluate' wasn't found")
  })

  it('includes sessionId in the frame when provided', async () => {
    const socket = new FakeSocket()
    const client = new CdpClient(socket)

    const pending = client.send('Runtime.evaluate', { expression: '1' }, 'SESSION-1')
    expect(socket.lastFrame()).toMatchObject({ sessionId: 'SESSION-1' })
    socket.receive({ id: 1, result: {} })
    await pending
  })

  it('dispatches events to registered handlers and supports unsubscribe', async () => {
    const socket = new FakeSocket()
    const client = new CdpClient(socket)

    const seen: unknown[] = []
    const off = client.on('Target.attachedToTarget', (params) => seen.push(params))
    socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 'S1' } })
    off()
    socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 'S2' } })

    expect(seen).toEqual([{ sessionId: 'S1' }])
  })

  it('rejects all pending requests when the socket closes', async () => {
    const socket = new FakeSocket()
    const client = new CdpClient(socket)

    const pending = client.send('Browser.close')
    socket.close()

    await expect(pending).rejects.toThrow('CDP socket closed')
  })
})
