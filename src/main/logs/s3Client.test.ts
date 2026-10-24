import { describe, expect, it } from 'vitest'
import { createFakeS3 } from './fakeS3'
import { createS3Client, signRequest } from './s3Client'

// AWS's published Signature Version 4 examples for S3 (header-based auth,
// "Examples: Signature Calculations"): the expected signatures are AWS's,
// not recomputed here.
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
}
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('signRequest', () => {
  it("signs AWS's GET Object example", () => {
    const authorization = signRequest(credentials, {
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
    })
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it("signs AWS's PUT Object example, its key's $ encoded", () => {
    const authorization = signRequest(credentials, {
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-content-sha256': '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
        'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
    })
    expect(authorization).toContain('SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,')
    expect(authorization).toContain('Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
  })
})

describe('createS3Client', () => {
  function client(pageSize?: number) {
    const s3 = createFakeS3({ bucket: 'logs', pageSize })
    const bucket = createS3Client({
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'logs',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      fetch: s3.fetch,
    })
    return { s3, bucket }
  }

  it('puts, heads, gets and deletes an object by key', async () => {
    const { s3, bucket } = client()
    await bucket.put('kiosk/ask-images/a b.png', new TextEncoder().encode('png!'))
    expect(await bucket.head('kiosk/ask-images/a b.png')).toEqual({ size: 4 })
    expect(new TextDecoder().decode(await bucket.get('kiosk/ask-images/a b.png'))).toBe('png!')
    await bucket.delete('kiosk/ask-images/a b.png')
    expect(await bucket.head('kiosk/ask-images/a b.png')).toBeNull()
    expect(s3.objects.size).toBe(0)
  })

  it('lists every page under a prefix', async () => {
    const { s3, bucket } = client(2)
    for (const name of ['a', 'b', 'c', 'd', 'e']) s3.seed(`kiosk/${name}.jsonl`, name, new Date(Date.UTC(2026, 9, 1)))
    s3.seed('den/x.jsonl', 'xx', new Date(Date.UTC(2026, 9, 2)))

    const kiosk = await bucket.list('kiosk/')
    expect(kiosk.map((o) => o.key)).toEqual(['kiosk/a.jsonl', 'kiosk/b.jsonl', 'kiosk/c.jsonl', 'kiosk/d.jsonl', 'kiosk/e.jsonl'])
    expect(kiosk[0]).toEqual({ key: 'kiosk/a.jsonl', size: 1, lastModified: new Date(Date.UTC(2026, 9, 1)) })
    expect((await bucket.list('')).length).toBe(6)
  })

  it('throws with the status when the store refuses', async () => {
    const { bucket } = client()
    await expect(bucket.get('missing')).rejects.toThrow(/404/)
  })
})
