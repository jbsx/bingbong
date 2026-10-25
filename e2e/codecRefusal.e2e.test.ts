import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// A video codec the GPU cannot decode is not offered (#425). Xvfb has no
// GPU, so BINGBONG_GPU_CODECS stands in for the probe: a GPU that decodes
// VP9 and H.264, as the kiosk's does, and not AV1. A page in the pane, and
// a page embedded in it from another site, hear AV1 refused from their
// first script; VP9 keeps the browser's own answer.

describe('codec refusal e2e: a codec the GPU cannot decode is not offered', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ env: { BINGBONG_GPU_CODECS: 'vp9,vp8,h264,hevc' } })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  it('refuses AV1 at a page’s first script and in a frame embedded from another site', async () => {
    const url = harness.fixture.url(`/codec-probe?frame=${encodeURIComponent(harness.fixture.altUrl('/codec-probe'))}`)
    await harness.navigatePane(url)
    const top = await waitFor(async () => (await harness.paneEval<{ av1: boolean; vp9: boolean } | null>('window.__codecsAtParse ?? null')) ?? undefined, { timeoutMs: 10000, intervalMs: 100 })
    expect(top).toEqual({ av1: false, vp9: true })

    // The embed is its own site, so its own process: it posts what it heard to the page.
    const embedded = await waitFor(async () => (await harness.paneEval<{ av1: boolean; vp9: boolean } | null>('window.__embedCodecs ?? null')) ?? undefined, { timeoutMs: 10000, intervalMs: 100 })
    expect(embedded).toEqual({ av1: false, vp9: true })
  })
})
