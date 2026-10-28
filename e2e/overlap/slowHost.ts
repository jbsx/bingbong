import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

// The slow host (#504): a harness-only stand-in in front of the Decision
// Model's host, so a gate run can reach the road a slow host takes. Every
// ask that reads one of the held lines' words is held unanswered until the
// app gives it up at its own timeout (BINGBONG_DECISION_TIMEOUT_MS, never
// changed here), so that line's reading times out; every other ask goes to
// the host as it came. Off unless BINGBONG_OVERLAP_SLOW_HOST=1.

/** The switch: set to `1`, each run's asks for its lines after line 1 time out. */
export const SLOW_HOST_ENV_KEY = 'BINGBONG_OVERLAP_SLOW_HOST'

export interface SlowHost {
  /** The base URL the app is pointed at. */
  readonly url: string
  /** How many asks were held, and how many passed. */
  readonly held: () => number
  readonly passed: () => number
  close(): Promise<void>
}

/** Whether an ask's body reads one of the held lines: its words anywhere in it, case ignored. */
export function readsHeld(body: string, held: readonly string[]): boolean {
  const text = body.toLowerCase()
  return held.some((words) => words.trim() !== '' && text.includes(words.trim().toLowerCase()))
}

/** Where an ask to the stand-in goes on the host: the host's own path, then the ask's. */
export function forwardedTo(target: string, path: string): string {
  const base = new URL(target)
  return new URL(`${base.pathname.replace(/\/+$/, '')}${path}`, base.origin).href
}

const bodyOf = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })

/** The stand-in, on a free port on 127.0.0.1, forwarding to `target` (the host's base URL). */
export async function openSlowHost(target: string, held: readonly string[]): Promise<SlowHost> {
  let heldCount = 0
  let passedCount = 0
  const open = new Set<ServerResponse>()
  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await bodyOf(request)
      if (readsHeld(body.toString('utf8'), held)) {
        // Never answered: the app's own timeout ends it, as a host too slow to answer would.
        heldCount += 1
        open.add(response)
        response.on('close', () => open.delete(response))
        return
      }
      passedCount += 1
      const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) => (key === 'host' || key === 'content-length' || value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]])))
      try {
        const answer = await fetch(forwardedTo(target, request.url ?? '/'), { method: request.method ?? 'POST', headers, ...(body.length > 0 ? { body } : {}) })
        const bytes = Buffer.from(await answer.arrayBuffer())
        response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' })
        response.end(bytes)
      } catch (error) {
        response.writeHead(502, { 'content-type': 'text/plain' })
        response.end(String(error))
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the slow host has no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    held: () => heldCount,
    passed: () => passedCount,
    close: () =>
      new Promise((resolve) => {
        for (const response of open) response.destroy()
        server.close(() => resolve())
      }),
  }
}
