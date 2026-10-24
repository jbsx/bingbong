import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The Log Bucket sidecar's script (#418), driven against a local rclone
// remote: `r2:` is configured as type `local`, so the bucket is a folder
// and no R2 credentials are needed. Skips when rclone is not installed.

const SCRIPT = join(import.meta.dirname, '..', 'docker', 'log-bucket.sh')
const hasRclone = spawnSync('rclone', ['version'], { stdio: 'ignore' }).status === 0

let root: string
let bucket: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'log-bucket-'))
  bucket = join(root, 'bucket')
  mkdirSync(bucket)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Write `bytes` bytes at `path`, last modified `ageHours` ago. */
function file(path: string, bytes: number, ageHours: number): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'x'.repeat(bytes))
  const when = new Date(Date.now() - ageHours * 3_600_000)
  utimesSync(path, when, when)
}

function envFile(lines: string[]): string {
  const path = join(root, 'config.env')
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

function run(mode: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('sh', [SCRIPT, mode], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: root, ...env },
    timeout: 30_000,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function configured(extra: string[] = []): Record<string, string> {
  return {
    BINGBONG_LOG_ENV_FILE: envFile([
      `BINGBONG_LOG_BUCKET=${bucket}`,
      'RCLONE_CONFIG_R2_TYPE=local',
      ...extra,
    ]),
    BINGBONG_LOG_MACHINE: 'kiosk',
    BINGBONG_LOG_SOURCE: join(root, 'logs'),
  }
}

function listed(dir: string): string[] {
  return execFileSync('find', [dir, '-type', 'f'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((path) => path.slice(dir.length + 1))
    .sort()
}

describe.skipIf(!hasRclone)('log-bucket.sh trim', () => {
  it("deletes only this machine's oldest files, down under the low mark", () => {
    // 10 kiosk files of 1000 bytes, 1..10 days old, and another machine's
    // 3000 bytes: 13,000 in the bucket. High 12,000, low 7,500 (in GB).
    for (let day = 1; day <= 10; day++) file(join(bucket, 'kiosk', `perf-${day}.jsonl`), 1000, day * 24)
    file(join(bucket, 'kiosk', 'ask-images', 'old.png'), 0, 30 * 24)
    file(join(bucket, 'other', 'perf-old.jsonl'), 3000, 60 * 24)

    const result = run('trim', configured(['BINGBONG_LOG_BUCKET_HIGH_GB=0.000012', 'BINGBONG_LOG_BUCKET_LOW_GB=0.0000075']))
    expect(result.status, result.stderr).toBe(0)

    // 13,000 → under 7,500 means 7 kiosk files go (13,000 − 6,000 = 7,000):
    // the 30-day image (0 bytes) and the six oldest logs, days 10 to 5.
    expect(listed(bucket)).toEqual([
      'kiosk/perf-1.jsonl',
      'kiosk/perf-2.jsonl',
      'kiosk/perf-3.jsonl',
      'kiosk/perf-4.jsonl',
      'other/perf-old.jsonl',
    ])
  })

  it('deletes nothing while the bucket is under the high mark', () => {
    for (let day = 1; day <= 3; day++) file(join(bucket, 'kiosk', `perf-${day}.jsonl`), 1000, day * 24)

    const result = run('trim', configured(['BINGBONG_LOG_BUCKET_HIGH_GB=0.000004', 'BINGBONG_LOG_BUCKET_LOW_GB=0.000001']))
    expect(result.status, result.stderr).toBe(0)
    expect(readdirSync(join(bucket, 'kiosk'))).toHaveLength(3)
  })

  it('fails, deleting nothing, when the bucket cannot be measured', () => {
    const env = configured(['BINGBONG_LOG_BUCKET_HIGH_GB=0', 'BINGBONG_LOG_BUCKET_LOW_GB=0'])
    const result = run('trim', { ...env, BINGBONG_LOG_BUCKET: join(root, 'missing') })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toMatch(/could not measure/)
  })
})

describe.skipIf(!hasRclone)('log-bucket.sh copy', () => {
  it("copies the last hour's files, ask-images included, and deletes nothing in the bucket", () => {
    const logs = join(root, 'logs')
    file(join(logs, 'decision-1.jsonl'), 10, 0.1)
    file(join(logs, 'ask-images', 'ask-1.png'), 10, 0.1)
    file(join(logs, 'perf-old.jsonl'), 10, 2)
    // Purged on the kiosk after 7 days, kept in the bucket.
    file(join(bucket, 'kiosk', 'perf-purged.jsonl'), 10, 8 * 24)

    const result = run('copy', configured())
    expect(result.status, result.stderr).toBe(0)
    expect(listed(bucket)).toEqual(['kiosk/ask-images/ask-1.png', 'kiosk/decision-1.jsonl', 'kiosk/perf-purged.jsonl'])
  })
})

describe.skipIf(!hasRclone)('log-bucket.sh settings', () => {
  it('loads only the log-bucket lines of the Env File, never a model key', () => {
    const env = configured([
      'export TYPESAFE_API_KEY=sk-secret',
      'BINGBONG_DECISION_API_KEY="sk-other"',
      'RCLONE_CONFIG_R2_PROVIDER="Cloudflare"',
    ])
    const result = run('env', env)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`BINGBONG_LOG_BUCKET=${bucket}`)
    expect(result.stdout).toContain('RCLONE_CONFIG_R2_PROVIDER=Cloudflare')
    expect(result.stdout).not.toContain('sk-secret')
    expect(result.stdout).not.toContain('sk-other')
  })

  it('idles with one log line when the bucket is not configured', () => {
    const result = spawnSync('sh', [SCRIPT, 'run'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', BINGBONG_LOG_ENV_FILE: envFile(['TYPESAFE_API_KEY=sk-secret']) },
      timeout: 1500,
    })
    // Still asleep when the timeout kills it: no exit, so no restart loop.
    expect(result.signal).toBe('SIGTERM')
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(result.stdout).toMatch(/not configured/)
  })
})
