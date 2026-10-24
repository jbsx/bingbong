import { describe, expect, it } from 'vitest'
import { logBucketSettings, logBucketStartup, trimPlan } from './logBucket'

const complete = {
  BINGBONG_LOG_BUCKET: 'kachow',
  BINGBONG_LOG_BUCKET_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  BINGBONG_LOG_BUCKET_ACCESS_KEY_ID: 'id',
  BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY: 'secret',
}

describe('logBucketSettings', () => {
  it('reads the bucket, its endpoint and key, the machine and the marks', () => {
    expect(
      logBucketSettings({ ...complete, BINGBONG_LOG_MACHINE: 'kiosk', BINGBONG_LOG_BUCKET_HIGH_GB: '0.5', BINGBONG_LOG_BUCKET_LOW_GB: '0.25' }),
    ).toEqual({
      bucket: 'kachow',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      machine: 'kiosk',
      highBytes: 500_000_000,
      lowBytes: 250_000_000,
    })
  })

  it('defaults the marks to 8 and 7 GB and leaves the machine unset', () => {
    expect(logBucketSettings(complete)).toMatchObject({ machine: undefined, highBytes: 8e9, lowBytes: 7e9 })
  })

  it('names what is missing', () => {
    expect(logBucketSettings({ BINGBONG_LOG_BUCKET: 'kachow', BINGBONG_LOG_BUCKET_ACCESS_KEY_ID: ' ' })).toEqual({
      missing: ['BINGBONG_LOG_BUCKET_ENDPOINT', 'BINGBONG_LOG_BUCKET_ACCESS_KEY_ID', 'BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY'],
    })
  })
})

describe('logBucketStartup', () => {
  it('starts on a machine that names itself', () => {
    expect(logBucketStartup({ ...complete, BINGBONG_LOG_MACHINE: 'kiosk' })).toMatchObject({
      start: { machine: 'kiosk', bucket: 'kachow' },
      line: 'log bucket: copying the logs to kachow/kiosk/ every 5 minutes',
    })
  })

  it('stays silent with nothing set, and with keys but no machine (the dev PC pulls, never sends)', () => {
    expect(logBucketStartup({})).toEqual({})
    expect(logBucketStartup(complete)).toEqual({})
  })

  it('says once what is missing when the settings are partial', () => {
    expect(logBucketStartup({ BINGBONG_LOG_MACHINE: 'kiosk', BINGBONG_LOG_BUCKET: 'kachow' })).toEqual({
      line: 'log bucket: not copying; set BINGBONG_LOG_BUCKET_ENDPOINT, BINGBONG_LOG_BUCKET_ACCESS_KEY_ID, BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY',
    })
  })
})

describe('trimPlan', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, n))
  // 13,000 bytes: kiosk's ten 1,000-byte files (days 1..10) and den's 3,000.
  const objects = [
    ...Array.from({ length: 10 }, (_, i) => ({ key: `kiosk/perf-${i + 1}.jsonl`, size: 1000, lastModified: day(i + 1) })),
    { key: 'den/perf-old.jsonl', size: 3000, lastModified: day(0) },
  ]

  it("deletes this machine's oldest uploads until the bucket is under the low mark", () => {
    expect(trimPlan(objects, 'kiosk', 12_000, 7_500)).toEqual({
      totalBytes: 13_000,
      keys: ['kiosk/perf-1.jsonl', 'kiosk/perf-2.jsonl', 'kiosk/perf-3.jsonl', 'kiosk/perf-4.jsonl', 'kiosk/perf-5.jsonl', 'kiosk/perf-6.jsonl'],
    })
  })

  it('deletes nothing at or under the high mark', () => {
    expect(trimPlan(objects, 'kiosk', 13_000, 1_000)).toEqual({ totalBytes: 13_000, keys: [] })
  })

  it("never touches another machine's folder, even when its own cannot reach the low mark", () => {
    expect(trimPlan(objects, 'kiosk', 1_000, 500).keys).toHaveLength(10)
    expect(trimPlan(objects, 'kiosk', 1_000, 500).keys.every((key) => key.startsWith('kiosk/'))).toBe(true)
  })
})
