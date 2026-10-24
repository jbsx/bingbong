import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeS3 } from '../../core/testing/fakeS3'
import { pullLogs } from './pullLogs'
import { createS3Client } from './s3Client'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'logs-pull-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('pullLogs', () => {
  it("copies one machine's folder into a logs dir, ask-images included, sending only what it lacks", async () => {
    const s3 = createFakeS3({ bucket: 'kachow' })
    const uploaded = new Date(Date.UTC(2026, 9, 24, 12))
    s3.seed('kiosk/decision-1.jsonl', '{"a":1}\n', uploaded)
    s3.seed('kiosk/ask-images/ask-1.png', 'png', uploaded)
    s3.seed('kiosk/perf-1.jsonl', 'same', uploaded)
    s3.seed('den/perf-1.jsonl', 'not mine', uploaded)
    writeFileSync(join(dir, 'perf-1.jsonl'), 'same')
    mkdirSync(join(dir, 'ask-images'))
    const client = createS3Client({ endpoint: 'https://r2.test', bucket: 'kachow', accessKeyId: 'id', secretAccessKey: 's', fetch: s3.fetch })

    expect(await pullLogs(client, 'kiosk', dir)).toEqual({ pulled: 2, kept: 1 })
    expect(readFileSync(join(dir, 'decision-1.jsonl'), 'utf8')).toBe('{"a":1}\n')
    expect(readFileSync(join(dir, 'ask-images', 'ask-1.png'), 'utf8')).toBe('png')
    expect(statSync(join(dir, 'decision-1.jsonl')).mtime).toEqual(uploaded)
    expect(s3.requests.filter((r) => r.startsWith('GET kiosk/'))).toEqual(['GET kiosk/ask-images/ask-1.png', 'GET kiosk/decision-1.jsonl'])
  })

  it('refuses a key that would land outside the folder', async () => {
    const s3 = createFakeS3({ bucket: 'kachow' })
    s3.seed('kiosk/../escape.jsonl', 'x', new Date())
    const client = createS3Client({ endpoint: 'https://r2.test', bucket: 'kachow', accessKeyId: 'id', secretAccessKey: 's', fetch: s3.fetch })
    await expect(pullLogs(client, 'kiosk', dir)).rejects.toThrow(/refusing key/)
  })
})
