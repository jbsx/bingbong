// The Log Bucket (#418): the app copies its logs to the owner's R2 bucket
// so they outlive the 7-day purge and can be read while the dev PC is off.
// This is its policy, pure: which settings arm it, and which uploads the
// daily space check deletes. The uploader and `pnpm logs:pull` are in
// src/main/logs.

export interface LogBucketSettings {
  readonly bucket: string
  /** `https://<account-id>.r2.cloudflarestorage.com` */
  readonly endpoint: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /**
   * This machine's folder, `<bucket>/<machine>/`. Only a machine that names
   * itself uploads: the dev PC holds the same keys to pull, never to send.
   */
  readonly machine: string | undefined
  /** Over this (the whole bucket), the space check deletes... */
  readonly highBytes: number
  /** ...this machine's oldest uploads until the bucket is under this. */
  readonly lowBytes: number
}

/** How often the logs are copied. */
export const COPY_INTERVAL_MINUTES = 5

const REQUIRED = [
  'BINGBONG_LOG_BUCKET',
  'BINGBONG_LOG_BUCKET_ENDPOINT',
  'BINGBONG_LOG_BUCKET_ACCESS_KEY_ID',
  'BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY',
] as const

// Decimal GB: below R2's binary GB, so the free tier is never the closer edge.
function gigabytes(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim())
  return Math.round((value?.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback) * 1e9)
}

export function logBucketSettings(env: Record<string, string | undefined>): LogBucketSettings | { missing: string[] } {
  const missing = REQUIRED.filter((name) => !env[name]?.trim())
  if (missing.length > 0) return { missing }
  const value = (name: string) => env[name]!.trim()
  return {
    bucket: value('BINGBONG_LOG_BUCKET'),
    endpoint: value('BINGBONG_LOG_BUCKET_ENDPOINT'),
    accessKeyId: value('BINGBONG_LOG_BUCKET_ACCESS_KEY_ID'),
    secretAccessKey: value('BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY'),
    machine: env.BINGBONG_LOG_MACHINE?.trim() || undefined,
    highBytes: gigabytes(env.BINGBONG_LOG_BUCKET_HIGH_GB, 8),
    lowBytes: gigabytes(env.BINGBONG_LOG_BUCKET_LOW_GB, 7),
  }
}

/**
 * What the app does at boot: start copying on a machine that names itself,
 * and say so in one line; say once what is missing when the settings are
 * partial; stay silent otherwise (no settings, or the dev PC's pull-only keys).
 */
export function logBucketStartup(env: Record<string, string | undefined>): {
  start?: LogBucketSettings & { machine: string }
  line?: string
} {
  const settings = logBucketSettings(env)
  if ('missing' in settings) {
    const touched = Object.keys(env).some((name) => name.startsWith('BINGBONG_LOG_') && env[name]?.trim())
    return touched ? { line: `log bucket: not copying; set ${settings.missing.join(', ')}` } : {}
  }
  const { machine } = settings
  if (machine === undefined) return {}
  return {
    start: { ...settings, machine },
    line: `log bucket: copying the logs to ${settings.bucket}/${machine}/ every ${COPY_INTERVAL_MINUTES} minutes`,
  }
}

export interface BucketObject {
  readonly key: string
  readonly size: number
  /** Upload time, which the listing carries without a request per object. */
  readonly lastModified: Date
}

/**
 * The space check. The whole bucket holds only logs (owner, 2026-10-24), so
 * its size is the free tier's measure. Over the high mark, this machine's
 * oldest uploads go until the bucket is under the low mark; another
 * machine's folder is never touched. No age rule: logs stay while there is room.
 */
export function trimPlan(
  objects: readonly BucketObject[],
  machine: string,
  highBytes: number,
  lowBytes: number,
): { totalBytes: number; keys: string[] } {
  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0)
  if (totalBytes <= highBytes) return { totalBytes, keys: [] }
  const own = objects
    .filter((object) => object.key.startsWith(`${machine}/`))
    .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime() || a.key.localeCompare(b.key))
  const keys: string[] = []
  let remaining = totalBytes
  for (const object of own) {
    if (remaining < lowBytes) break
    keys.push(object.key)
    remaining -= object.size
  }
  return { totalBytes, keys }
}
