import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { dropBody } from './dropBody'

// The server answers with a body big enough to pause undici's parser, then closes (nodejs/undici#5360).
const BODY = Buffer.alloc(64 * 1024, 0x61)

let server: Server | undefined
afterEach(() => server?.close())

const closingServer = (): Promise<number> =>
  new Promise((resolve) => {
    server = createServer((socket) => {
      socket.on('error', () => {})
      socket.once('data', () => {
        socket.write(`HTTP/1.1 403 Forbidden\r\nContent-Length: ${BODY.length}\r\nConnection: close\r\n\r\n`)
        socket.write(BODY)
        socket.end()
      })
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
  })

describe('dropBody', () => {
  it('a body left unread on a closing connection throws nothing uncaught once dropped', async () => {
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => uncaught.push(error)
    process.on('uncaughtException', onUncaught)
    try {
      const response = await fetch(`http://127.0.0.1:${await closingServer()}/`)
      expect(response.status).toBe(403)
      await dropBody(response)
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      process.off('uncaughtException', onUncaught)
    }
    expect(uncaught).toEqual([])
  })

  it('a response with no body is a no-op', async () => {
    await expect(dropBody({ body: null })).resolves.toBeUndefined()
  })
})
