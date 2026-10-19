import { describe, expect, it } from 'vitest'
import { briefWriterEnvKeys, resolveBriefWriterRouting } from './briefWriterRouting'

describe('resolveBriefWriterRouting', () => {
  it('arms GLM on Z.ai with ZAI_API_KEY alone', () => {
    expect(resolveBriefWriterRouting({ ZAI_API_KEY: ' zk ' })).toEqual({ baseUrl: 'https://api.z.ai/api/coding/paas/v4', model: 'GLM-5.3', apiKey: 'zk' })
  })

  it('takes its own key, base URL and model over the defaults', () => {
    expect(
      resolveBriefWriterRouting({
        ZAI_API_KEY: 'zk',
        BINGBONG_NEWS_WRITER_API_KEY: 'own',
        BINGBONG_NEWS_WRITER_BASE_URL: 'https://example.com/v1/',
        BINGBONG_NEWS_WRITER_MODEL: 'GLM-5.3-flash',
      }),
    ).toEqual({ baseUrl: 'https://example.com/v1', model: 'GLM-5.3-flash', apiKey: 'own' })
  })

  it('reads the key from a named env var, never falling back when that one is unset', () => {
    expect(resolveBriefWriterRouting({ BINGBONG_NEWS_WRITER_API_KEY_ENV: 'MY_KEY', MY_KEY: 'mine' })?.apiKey).toBe('mine')
    expect(resolveBriefWriterRouting({ BINGBONG_NEWS_WRITER_API_KEY_ENV: 'MY_KEY', ZAI_API_KEY: 'zk' })).toBeNull()
  })

  it('is off with no key', () => {
    expect(resolveBriefWriterRouting({})).toBeNull()
  })

  it('names every var it reads, for the hermetic harness', () => {
    expect(briefWriterEnvKeys()).toEqual(expect.arrayContaining(['ZAI_API_KEY', 'BINGBONG_NEWS_WRITER_API_KEY']))
  })
})
