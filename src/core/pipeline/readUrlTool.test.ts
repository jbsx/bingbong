import { describe, expect, it } from 'vitest'
import { createReadUrlTool } from './readUrlTool'

// read_url: the fetch leg of research subagents — pull a page, render HTML to
// a bounded text excerpt for the workhorse model. Non-HTML (JSON, plain text)
// passes through, still bounded.

const CTX = { clock: { now: () => 0, setTimer: () => () => {} } }

function okResponse(body: string, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

describe('read_url tool', () => {
  it('fetches an HTML page and returns a text excerpt with its title', async () => {
    const urls: string[] = []
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return okResponse('<html><head><title>Keyboards</title></head><body><h1>Keyboards</h1><p>Nice ones.</p></body></html>')
    }) as typeof fetch

    const tool = createReadUrlTool({ fetchFn })
    const result = (await tool.execute({ id: 'c1', name: 'read_url', args: { url: 'https://x.test/keyboards' } }, CTX)) as string

    expect(urls).toEqual(['https://x.test/keyboards'])
    expect(result).toContain('https://x.test/keyboards')
    expect(result).toContain('Keyboards')
    expect(result).toContain('Nice ones.')
  })

  it('passes non-HTML content through, bounded', async () => {
    const fetchFn = (async () => okResponse('{"a": 1}', 'application/json')) as typeof fetch
    const tool = createReadUrlTool({ fetchFn })

    const result = (await tool.execute({ id: 'c1', name: 'read_url', args: { url: 'https://x.test/data.json' } }, CTX)) as string
    expect(result).toContain('{"a": 1}')
  })

  it('throws a readable error for HTTP failures', async () => {
    const fetchFn = (async () => new Response('nope', { status: 404 })) as typeof fetch
    const tool = createReadUrlTool({ fetchFn })

    await expect(
      tool.execute({ id: 'c1', name: 'read_url', args: { url: 'https://x.test/missing' } }, CTX),
    ).rejects.toThrow(/404/)
  })

  it('throws a readable error for network failures', async () => {
    const fetchFn = (async () => {
      throw new Error('fetch failed')
    }) as typeof fetch
    const tool = createReadUrlTool({ fetchFn })

    await expect(
      tool.execute({ id: 'c1', name: 'read_url', args: { url: 'https://down.test' } }, CTX),
    ).rejects.toThrow(/down\.test/)
  })

  it('rejects non-string or empty urls', async () => {
    const tool = createReadUrlTool({ fetchFn: (async () => okResponse('<p>x</p>')) as typeof fetch })
    await expect(tool.execute({ id: 'c1', name: 'read_url', args: {} }, CTX)).rejects.toThrow(/url/)
  })
})
