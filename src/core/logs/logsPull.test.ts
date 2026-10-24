import { describe, expect, it } from 'vitest'
import { planLogsPull } from './logsPull'

const dotEnv = [
  'TYPESAFE_API_KEY=sk-secret',
  'BINGBONG_LOG_BUCKET=kachow',
  'BINGBONG_LOG_BUCKET_ENDPOINT=https://account.r2.cloudflarestorage.com',
  'BINGBONG_LOG_BUCKET_ACCESS_KEY_ID=id',
  'BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY=secret',
].join('\n')

describe('planLogsPull', () => {
  it("pulls the kiosk's folder to kiosk-logs/kiosk by default", () => {
    expect(planLogsPull([], dotEnv, {})).toMatchObject({
      machine: 'kiosk',
      dir: 'kiosk-logs/kiosk',
      settings: { bucket: 'kachow', endpoint: 'https://account.r2.cloudflarestorage.com' },
    })
  })

  it('takes the machine and the folder from the arguments', () => {
    expect(planLogsPull(['den', '/tmp/den-logs'], dotEnv, {})).toMatchObject({ machine: 'den', dir: '/tmp/den-logs' })
  })

  it('lets the process environment win over the root .env', () => {
    expect(planLogsPull([], dotEnv, { BINGBONG_LOG_BUCKET: 'other' })).toMatchObject({ settings: { bucket: 'other' } })
  })

  it('names the missing settings instead of running', () => {
    expect(planLogsPull([], 'BINGBONG_LOG_BUCKET=kachow', {})).toEqual({
      missing: ['BINGBONG_LOG_BUCKET_ENDPOINT', 'BINGBONG_LOG_BUCKET_ACCESS_KEY_ID', 'BINGBONG_LOG_BUCKET_SECRET_ACCESS_KEY'],
    })
  })
})
