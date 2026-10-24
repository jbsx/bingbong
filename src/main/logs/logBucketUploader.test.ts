import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeS3, type FakeS3 } from './fakeS3'
import { createLogBucketUploader } from './logBucketUploader'
import { createS3Client } from './s3Client'

let logsDir: string
let s3: FakeS3
let clock: number

const HOUR = 3_600_000

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), 'log-bucket-'))
  clock = Date.UTC(2026, 9, 24, 12)
  s3 = createFakeS3({ bucket: 'kachow', now: () => new Date(clock) })
})
afterEach(() => rmSync(logsDir, { recursive: true, force: true }))

function write(relative: string, text: string): void {
  const path = join(logsDir, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function uploader(highGb = 8, lowGb = 7) {
  const client = createS3Client({ endpoint: 'https://r2.test', bucket: 'kachow', accessKeyId: 'id', secretAccessKey: 's', fetch: s3.fetch })
  return createLogBucketUploader({
    logsDir,
    machine: 'kiosk',
    highBytes: highGb * 1e9,
    lowBytes: lowGb * 1e9,
    client,
    now: () => clock,
  })
}

const keys = () => [...s3.objects.keys()].sort()
const text = (key: string) => new TextDecoder().decode(s3.objects.get(key)!.body)

describe('the Log Bucket uploader', () => {
  it("uploads every log, ask-images included, under this machine's folder", async () => {
    write('decision-1.jsonl', '{"a":1}\n')
    write('ask-images/ask-1.png', 'png')
    await uploader().copy()
    expect(keys()).toEqual(['kiosk/ask-images/ask-1.png', 'kiosk/decision-1.jsonl'])
  })

  it('sends only what changed since the last copy, never listing the bucket', async () => {
    write('decision-1.jsonl', '{"a":1}\n')
    write('perf-1.jsonl', '{"p":1}\n')
    const bucket = uploader()
    await bucket.copy()
    s3.requests.length = 0

    await bucket.copy()
    expect(s3.requests).toEqual([])

    write('decision-1.jsonl', '{"a":1}\n{"a":2}\n')
    await bucket.copy()
    expect(s3.requests).toEqual(['PUT kiosk/decision-1.jsonl'])
    expect(text('kiosk/decision-1.jsonl')).toBe('{"a":1}\n{"a":2}\n')
  })

  it('catches up at start with a HEAD per file, sending only what the bucket lacks', async () => {
    write('decision-1.jsonl', 'same')
    write('perf-1.jsonl', 'new')
    s3.seed('kiosk/decision-1.jsonl', 'same', new Date(clock - HOUR))
    await uploader().copy()
    expect(s3.requests.filter((r) => r.startsWith('PUT'))).toEqual(['PUT kiosk/perf-1.jsonl'])
  })

  it('never deletes what the kiosk purged', async () => {
    write('perf-old.jsonl', 'old')
    const bucket = uploader()
    await bucket.copy()
    rmSync(join(logsDir, 'perf-old.jsonl'))
    await bucket.copy()
    expect(keys()).toEqual(['kiosk/perf-old.jsonl'])
  })

  it('keeps copying the other files when one upload fails', async () => {
    write('a.jsonl', 'a')
    write('b.jsonl', 'b')
    const failing = createFakeS3({ bucket: 'kachow' })
    const realFetch = failing.fetch
    const flaky: typeof fetch = async (input, init) =>
      String(input).endsWith('/a.jsonl') && init?.method === 'PUT' ? new Response('boom', { status: 500 }) : realFetch(input, init)
    const client = createS3Client({ endpoint: 'https://r2.test', bucket: 'kachow', accessKeyId: 'id', secretAccessKey: 's', fetch: flaky })
    const bucket = createLogBucketUploader({ logsDir, machine: 'kiosk', highBytes: 8e9, lowBytes: 7e9, client, now: () => clock })

    const result = await bucket.copy()
    expect(result).toEqual({ uploaded: 1, failed: 1 })
    expect([...failing.objects.keys()]).toEqual(['kiosk/b.jsonl'])
  })

  it("the space check deletes this machine's oldest uploads past the high mark", async () => {
    for (let day = 1; day <= 4; day++) s3.seed(`kiosk/perf-${day}.jsonl`, 'x'.repeat(1000), new Date(Date.UTC(2026, 9, day)))
    s3.seed('den/perf.jsonl', 'x'.repeat(1000), new Date(Date.UTC(2026, 8, 1)))

    const result = await uploader(0.000_004, 0.000_003).trim()
    expect(result).toEqual({ totalBytes: 5000, deleted: 3 })
    expect(keys()).toEqual(['den/perf.jsonl', 'kiosk/perf-4.jsonl'])
  })

  it('each tick copies; the space check runs on the first and then once a day', async () => {
    write('perf-1.jsonl', 'p')
    const bucket = uploader()
    const lists = () => s3.requests.filter((r) => r.includes('list-type=2')).length

    await bucket.tick()
    expect(lists()).toBe(1)
    clock += 23 * HOUR
    await bucket.tick()
    expect(lists()).toBe(1)
    clock += 2 * HOUR
    await bucket.tick()
    expect(lists()).toBe(2)
    expect(keys()).toEqual(['kiosk/perf-1.jsonl'])
  })
})
