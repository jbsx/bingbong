import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { trimPlan } from '../../core/logs/logBucket.ts'
import { reportFault } from '../../core/trace/fault.ts'
import type { S3Client } from './s3Client.ts'

// The Log Bucket's uploader (#418), in the app's own main process: every
// five minutes the logs dir, ask-images included, is copied to
// `<bucket>/<machine>/`. Copied, never synced: the app's 7-day purge never
// deletes anything in the bucket. The bucket is never listed to decide what
// to send: at start each file is checked with a HEAD (the catch-up after
// downtime), and from then on only a file whose size or mtime changed since
// its last upload is sent, so the requests follow the writes, not the load.
// Once a day the space check measures the bucket and deletes this machine's
// oldest uploads past the high mark.

export const COPY_INTERVAL_MS = 5 * 60_000
const TRIM_INTERVAL_MS = 24 * 60 * 60_000

export interface LogBucketUploaderOptions {
  readonly logsDir: string
  readonly machine: string
  readonly highBytes: number
  readonly lowBytes: number
  readonly client: S3Client
  readonly now?: () => number
}

export interface LogBucketUploader {
  copy(): Promise<{ uploaded: number; failed: number }>
  trim(): Promise<{ totalBytes: number; deleted: number }>
  /** One scheduled round: the copy, and the space check when a day has passed. */
  tick(): Promise<void>
  /** Tick now and every five minutes until the returned stop is called. */
  start(): () => void
}

async function listFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    // No logs dir yet is nothing to copy; anything else is said.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reportFault('logs.bucket.list', error)
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

export function createLogBucketUploader(options: LogBucketUploaderOptions): LogBucketUploader {
  const { client, machine } = options
  const now = options.now ?? Date.now
  /** What was last uploaded (or found already there), by local path. */
  const sent = new Map<string, string>()
  let caughtUp = false
  let lastTrim: number | undefined

  async function copy(): Promise<{ uploaded: number; failed: number }> {
    let uploaded = 0
    let failed = 0
    for (const path of await listFiles(options.logsDir)) {
      const key = `${machine}/${relative(options.logsDir, path).split(sep).join('/')}`
      try {
        const info = await stat(path)
        const version = `${info.size}:${info.mtimeMs}`
        if (sent.get(path) === version) continue
        if (!caughtUp && !sent.has(path) && (await client.head(key))?.size === info.size) {
          sent.set(path, version)
          continue
        }
        await client.put(key, await readFile(path))
        sent.set(path, version)
        uploaded++
      } catch (error) {
        failed++
        reportFault('logs.bucket.copy', error)
      }
    }
    // A failed round keeps checking with HEADs: nothing is assumed sent.
    if (failed === 0) caughtUp = true
    return { uploaded, failed }
  }

  async function trim(): Promise<{ totalBytes: number; deleted: number }> {
    const plan = trimPlan(await client.list(''), machine, options.highBytes, options.lowBytes)
    for (const key of plan.keys) await client.delete(key)
    return { totalBytes: plan.totalBytes, deleted: plan.keys.length }
  }

  async function tick(): Promise<void> {
    await copy()
    const at = now()
    if (lastTrim !== undefined && at - lastTrim < TRIM_INTERVAL_MS) return
    lastTrim = at
    try {
      await trim()
    } catch (error) {
      reportFault('logs.bucket.trim', error)
    }
  }

  function start(): () => void {
    let stopped = false
    let timer: NodeJS.Timeout | undefined
    const round = () => {
      void tick().finally(() => {
        if (!stopped) timer = setTimeout(round, COPY_INTERVAL_MS)
      })
    }
    round()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }

  return { copy, trim, tick, start }
}
