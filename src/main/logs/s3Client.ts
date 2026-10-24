import { createHash, createHmac } from 'node:crypto'

// The Log Bucket's S3 client (#418): the five calls the uploader and
// `pnpm logs:pull` make on an S3-compatible store (Cloudflare R2), signed
// with AWS Signature Version 4 over `fetch`. No SDK and no rclone: node's
// own crypto signs, so nothing is added to the app or to the kiosk.

export interface S3Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** R2 signs as `auto`. */
  readonly region: string
}

export interface SignableRequest {
  readonly method: string
  readonly url: URL
  /** Lower-case names; must carry `x-amz-date` and `x-amz-content-sha256`. */
  readonly headers: Readonly<Record<string, string>>
}

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding, as SigV4 wants it: everything but unreserved escaped. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** The `Authorization` header for a request (host is taken from the URL). */
export function signRequest(credentials: S3Credentials, request: SignableRequest): string {
  const amzDate = request.headers['x-amz-date']
  const day = amzDate.slice(0, 8)
  const headers: Record<string, string> = { ...request.headers, host: request.url.host }
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')
  const path = request.url.pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join('/')
  const query = [...request.url.searchParams]
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .sort()
    .join('&')
  const canonical = [
    request.method,
    path,
    query,
    ...names.map((name) => `${name}:${headers[name].trim()}`),
    '',
    signedHeaders,
    headers['x-amz-content-sha256'],
  ].join('\n')
  const scope = `${day}/${credentials.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
}

export interface S3ClientOptions {
  /** e.g. `https://<account-id>.r2.cloudflarestorage.com`; the bucket goes in the path. */
  readonly endpoint: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region?: string
  readonly fetch?: typeof fetch
  /** Each request's bound. */
  readonly timeoutMs?: number
}

export interface S3Object {
  readonly key: string
  readonly size: number
  /** When the object was uploaded. */
  readonly lastModified: Date
}

export interface S3Client {
  put(key: string, body: Uint8Array): Promise<void>
  /** The object's size, or null when there is none. */
  head(key: string): Promise<{ size: number } | null>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
  /** Every object under the prefix, all pages. */
  list(prefix: string): Promise<S3Object[]>
}

const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const tag = (xml: string, name: string): string | undefined => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]

export function createS3Client(options: S3ClientOptions): S3Client {
  const doFetch = options.fetch ?? fetch
  const credentials: S3Credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region ?? 'auto',
  }
  const base = options.endpoint.replace(/\/+$/, '')

  async function send(method: string, key: string, query: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const path = key === '' ? '' : `/${key.split('/').map(uriEncode).join('/')}`
    const url = new URL(`${base}/${uriEncode(options.bucket)}${path}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const headers: Record<string, string> = {
      'x-amz-content-sha256': sha256(body ?? ''),
      'x-amz-date': amzDate,
    }
    const authorization = signRequest(credentials, { method, url, headers })
    return doFetch(url, {
      method,
      headers: { ...headers, authorization },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    })
  }

  async function ok(response: Response, what: string): Promise<Response> {
    if (response.ok) return response
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(`log bucket: ${what} → ${response.status} ${detail}`.trim())
  }

  return {
    async put(key, body) {
      await ok(await send('PUT', key, {}, body), `PUT ${key}`)
    },
    async head(key) {
      const response = await send('HEAD', key)
      if (response.status === 404) return null
      await ok(response, `HEAD ${key}`)
      return { size: Number(response.headers.get('content-length') ?? 0) }
    },
    async get(key) {
      const response = await ok(await send('GET', key), `GET ${key}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    async delete(key) {
      await ok(await send('DELETE', key), `DELETE ${key}`)
    },
    async list(prefix) {
      const objects: S3Object[] = []
      let token: string | undefined
      do {
        const query: Record<string, string> = { 'list-type': '2', prefix }
        if (token !== undefined) query['continuation-token'] = token
        const xml = await (await ok(await send('GET', '', query), `LIST ${prefix}`)).text()
        for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          objects.push({
            key: unescapeXml(tag(entry, 'Key') ?? ''),
            size: Number(tag(entry, 'Size') ?? 0),
            lastModified: new Date(tag(entry, 'LastModified') ?? 0),
          })
        }
        token = tag(xml, 'IsTruncated') === 'true' ? unescapeXml(tag(xml, 'NextContinuationToken') ?? '') : undefined
      } while (token)
      return objects
    },
  }
}
