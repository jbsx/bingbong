import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startUsageStandIn, type UsageStandIn } from './usageStandIn'
import { waitFor } from './waitFor'

// The Idle Screen's kept answers (core/idle/idleCache): a card draws what it
// showed last the moment the screen comes up, and swaps in the fresh answer
// when it lands. Here the AI Usage card's rings, after a restart, while the
// dashboard takes the poll and answers nothing.

describe('idle screen e2e: kept answers', () => {
  let harness: Harness | undefined
  let usage: UsageStandIn
  let userDataDir: string

  const rings = (): Promise<number> => harness!.dashboardEval<number>(`document.querySelectorAll('.idle-home[data-card="usage"] .usage-ring-item').length`)

  beforeAll(async () => {
    usage = await startUsageStandIn(2)
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-kept-'))
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ usageDashboard: usage.settings }), 'utf8')
  })

  afterAll(async () => {
    await harness?.quit()
    await usage?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('draws the last usage rings after a restart while the dashboard has not answered', async () => {
    harness = await startHarness({ userDataDir, wakeFromBootIdle: false, launchArgs: ['--mute-audio'] })
    await waitFor(async () => ((await rings()) > 0 ? true : undefined), { timeoutMs: 15000, intervalMs: 250 })
    await harness.quit()
    harness = undefined

    usage.hold(true)
    harness = await startHarness({ userDataDir, wakeFromBootIdle: false, launchArgs: ['--mute-audio'] })
    const drawn = await waitFor(async () => ((await rings()) > 0 ? await rings() : undefined), { timeoutMs: 5000, intervalMs: 100 })
    expect(drawn).toBe(2)
  })
})
