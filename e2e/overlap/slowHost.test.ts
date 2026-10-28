import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { forwardedTo, openSlowHost, readsHeld, type SlowHost } from './slowHost'

describe('the slow host (#504): the held lines\' asks time out, every other ask reaches the host', () => {
  let host: SlowHost | null = null
  let target: ReturnType<typeof createServer> | null = null
  afterEach(async () => {
    await host?.close()
    await new Promise((resolve) => (target === null ? resolve(null) : target.close(resolve)))
  })

  it('reads the held words anywhere in the body, case ignored', () => {
    expect(readsHeld('{"state":"The user\'s words: \\"Open the weather\\""}', ['open the weather'])).toBe(true)
    expect(readsHeld('{"state":"play radiohead"}', ['open the weather'])).toBe(false)
    expect(readsHeld('anything', [' '])).toBe(false)
  })

  it('forwards to the host\'s own path', () => {
    expect(forwardedTo('https://inference.baseten.co', '/v1/systemone')).toBe('https://inference.baseten.co/v1/systemone')
    expect(forwardedTo('https://example.com/api/', '/v1/systemone')).toBe('https://example.com/api/v1/systemone')
  })

  it('passes an ask through, and holds one for a held line until the asker gives up', async () => {
    const seen: string[] = []
    target = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      request.on('end', () => {
        seen.push(`${request.method} ${request.url} ${request.headers.authorization} ${body}`)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      })
    })
    await new Promise<void>((resolve) => target!.listen(0, '127.0.0.1', resolve))
    const port = (target.address() as { port: number }).port
    host = await openSlowHost(`http://127.0.0.1:${port}`, ['open the weather'])
    const passed = await fetch(`${host.url}/v1/systemone`, { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{"state":"play radiohead"}' })
    expect(await passed.json()).toEqual({ ok: true })
    expect(seen).toEqual(['POST /v1/systemone Bearer k {"state":"play radiohead"}'])
    const held = fetch(`${host.url}/v1/systemone`, { method: 'POST', body: '{"state":"open the weather"}', signal: AbortSignal.timeout(150) })
    await expect(held).rejects.toThrow()
    expect(seen).toHaveLength(1)
    expect([host.held(), host.passed()]).toEqual([1, 1])
  })
})
