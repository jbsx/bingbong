// An in-memory S3 bucket behind a `fetch` double: the Log Bucket's tests
// (#418) drive the real client through it. Path-style requests only
// (`<endpoint>/<bucket>/<key>`), the five calls the client makes, and
// ListObjectsV2 paged at `pageSize` so pagination is exercised. Every
// request is recorded, so a test can count what would be billed.

export interface FakeObject {
  body: Uint8Array
  lastModified: Date
}

export interface FakeS3 {
  readonly objects: Map<string, FakeObject>
  readonly requests: string[]
  readonly fetch: typeof fetch
  /** Put an object directly, as if uploaded at `lastModified`. */
  seed(key: string, body: string, lastModified: Date): void
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function createFakeS3(options: { bucket: string; pageSize?: number; now?: () => Date }): FakeS3 {
  const objects = new Map<string, FakeObject>()
  const requests: string[] = []
  const pageSize = options.pageSize ?? 1000
  const now = options.now ?? (() => new Date())

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    if (!headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 ')) return new Response('unsigned', { status: 403 })
    const [, bucket, ...rest] = url.pathname.split('/')
    if (bucket !== options.bucket) return new Response('NoSuchBucket', { status: 404 })
    const key = rest.map(decodeURIComponent).join('/')
    requests.push(`${method} ${key}${url.search}`)

    if (method === 'GET' && key === '' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const after = url.searchParams.get('continuation-token') ?? ''
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort()
      const page = keys.slice(0, pageSize)
      const truncated = keys.length > page.length
      const contents = page
        .map((k) => {
          const object = objects.get(k)!
          return `<Contents><Key>${escapeXml(k)}</Key><LastModified>${object.lastModified.toISOString()}</LastModified><Size>${object.body.length}</Size></Contents>`
        })
        .join('')
      const next = truncated ? `<NextContinuationToken>${escapeXml(page[page.length - 1])}</NextContinuationToken>` : ''
      return new Response(`<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`)
    }
    const object = objects.get(key)
    if (method === 'PUT') {
      const body = new Uint8Array(await new Response(init?.body).arrayBuffer())
      objects.set(key, { body, lastModified: now() })
      return new Response(null, { status: 200 })
    }
    if (method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    if (!object) return new Response(method === 'HEAD' ? null : 'NoSuchKey', { status: 404 })
    const meta = { 'content-length': String(object.body.length), 'last-modified': object.lastModified.toUTCString() }
    if (method === 'HEAD') return new Response(null, { status: 200, headers: meta })
    if (method === 'GET') return new Response(new Uint8Array(object.body), { status: 200, headers: meta })
    return new Response('MethodNotAllowed', { status: 405 })
  }

  return {
    objects,
    requests,
    fetch: fakeFetch as typeof fetch,
    seed(key, body, lastModified) {
      objects.set(key, { body: new TextEncoder().encode(body), lastModified })
    },
  }
}
