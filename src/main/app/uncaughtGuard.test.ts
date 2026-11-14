import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createUncaughtGuard, isUndiciPausedAssertion } from './uncaughtGuard'

// The real error, raised by Node's own undici: a 64 KiB body left unread on a closing connection (nodejs/undici#5360).
const realPausedAssertion = (): Promise<unknown> =>
  new Promise((resolve) => {
    const body = Buffer.alloc(64 * 1024, 0x61)
    const server = createServer((socket) => {
      socket.on('error', () => {})
      socket.once('data', () => {
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`)
        socket.write(body)
        socket.end()
      })
    })
    const listeners = process.listeners('uncaughtException')
    process.removeAllListeners('uncaughtException')
    process.once('uncaughtException', (error) => {
      for (const listener of listeners) process.on('uncaughtException', listener)
      server.close()
      resolve(error)
    })
    server.listen(0, '127.0.0.1', () => {
      void fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`)
    })
  })

describe('the uncaught guard', () => {
  it("knows undici's paused-parser assertion and logs it without a dialog", async () => {
    const error = await realPausedAssertion()
    expect(isUndiciPausedAssertion(error)).toBe(true)
    const reported: string[] = []
    const boxes: string[] = []
    createUncaughtGuard({ report: (where) => reported.push(where), showErrorBox: (title) => boxes.push(title) })(error)
    expect(reported).toEqual(['app.undiciPaused'])
    expect(boxes).toEqual([])
  })

  it('shows every other exception as Electron would', () => {
    const boxes: string[] = []
    const reported: string[] = []
    createUncaughtGuard({ report: (where) => reported.push(where), showErrorBox: (title, content) => boxes.push(`${title}|${content.split('\n')[1]}`) })(new TypeError('boom'))
    expect(boxes).toEqual(['A JavaScript error occurred in the main process|TypeError: boom'])
    expect(reported).toEqual([])
  })

  it('an assertion from anywhere else is not the known one', () => {
    const error = Object.assign(new Error('assert(!this.paused)'), { code: 'ERR_ASSERTION' })
    expect(isUndiciPausedAssertion(error)).toBe(false)
  })
})
