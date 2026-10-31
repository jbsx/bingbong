import { connect } from 'node:net'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'

// A default launch reaches no real host (#533). The model prefetch stops at its
// seam, so a launch that skips the wrapper still downloads nothing; the wrapper
// cuts the route for everything else, and this file says the cut is real.

const PREFETCH_WINDOW_MS = 5_000

describe('a default launch stays home', () => {
  let harness: Harness
  let launched: number

  beforeAll(async () => {
    launched = Date.now()
    harness = await startHarness()
  })

  afterAll(async () => {
    await harness?.quit()
  })

  it('asks the fixture for its models within 5 s and starts no download', async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, launched + PREFETCH_WINDOW_MS - Date.now())))

    expect(harness.fixture.modelFetchHits()).toBeGreaterThanOrEqual(1)
    // Nothing at all, not only no `.part`: a small file (Smart Turn is 8.7 MB) can finish and be renamed inside the window.
    const models = await readdir(join(harness.userDataDir, 'models'), { recursive: true }).catch(() => [] as string[])
    expect(models).toEqual([])
  })

  it.runIf(process.env.BINGBONG_E2E_NO_NETWORK)('has no route to a public address', async () => {
    const failure = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const socket = connect(53, '1.1.1.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve(null)
      })
      socket.once('error', resolve)
    })

    expect(failure?.code).toBe('ENETUNREACH')
  })
})
