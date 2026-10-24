import { describe, expect, it } from 'vitest'
import { planLogsPull } from './logsPull'

const dotEnv = [
  'TYPESAFE_API_KEY=sk-secret',
  'BINGBONG_LOG_BUCKET=bingbong-logs',
  'RCLONE_CONFIG_R2_TYPE=s3',
  'RCLONE_CONFIG_R2_PROVIDER=Cloudflare',
].join('\n')

describe('planLogsPull', () => {
  it("copies the kiosk's folder to kiosk-logs/kiosk by default", () => {
    const plan = planLogsPull([], dotEnv, {})
    expect(plan).toEqual({
      remote: 'r2:bingbong-logs/kiosk/',
      dir: 'kiosk-logs/kiosk',
      argv: ['copy', 'r2:bingbong-logs/kiosk/', 'kiosk-logs/kiosk'],
      env: {
        BINGBONG_LOG_BUCKET: 'bingbong-logs',
        RCLONE_CONFIG_R2_TYPE: 's3',
        RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
      },
    })
  })

  it('takes the machine and the folder from the arguments', () => {
    const plan = planLogsPull(['den', '/tmp/den-logs'], dotEnv, {})
    expect(plan).toMatchObject({ dir: '/tmp/den-logs', argv: ['copy', 'r2:bingbong-logs/den/', '/tmp/den-logs'] })
  })

  it('lets the process environment win over the root .env', () => {
    const plan = planLogsPull([], dotEnv, { BINGBONG_LOG_BUCKET: 'other-bucket', PATH: '/bin' })
    expect(plan).toMatchObject({ argv: ['copy', 'r2:other-bucket/kiosk/', 'kiosk-logs/kiosk'] })
  })

  it('names the missing settings instead of running', () => {
    expect(planLogsPull([], 'TYPESAFE_API_KEY=sk-secret', {})).toEqual({
      missing: ['BINGBONG_LOG_BUCKET', 'RCLONE_CONFIG_R2_TYPE'],
    })
  })
})
