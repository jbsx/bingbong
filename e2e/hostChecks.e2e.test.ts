import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The host checks (#419): an app started on a machine without aplay says so
// once, in the fault log and on the Settings page's "This computer".

const MISSING_APLAY = '/nonexistent/bin/aplay'

describe('host checks e2e', () => {
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-host-checks-'))
    harness = await startHarness({ userDataDir, env: { BINGBONG_APLAY_BIN: MISSING_APLAY } })
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('section[aria-label="this computer"]')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 250 })
    await harness.dashboardEval(`(() => { const details = document.querySelector('section[aria-label="this computer"] details'); if (!details.open) details.open = true })()`)
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('shows the missing aplay under This computer, with the count in its line', async () => {
    const text = await waitFor(
      async () => {
        const shown = await harness.dashboardEval<string>(`document.querySelector('section[aria-label="this computer"]').textContent`)
        return shown.includes('aplay is not installed') ? shown : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(text).toContain(`'${MISSING_APLAY}'`)
    expect(text).toContain('1 missing')
    expect(text).not.toContain('No display is set')
  })

  it('writes the same line to the fault log, once', async () => {
    const logsDir = join(userDataDir, 'logs')
    const faults = (await readdir(logsDir)).filter((name) => name.startsWith('faults-'))
    const lines = (await Promise.all(faults.map((name) => readFile(join(logsDir, name), 'utf8'))))
      .join('')
      .split('\n')
      .filter((line) => line.includes('"site":"app.hostChecks.'))
      .map((line) => JSON.parse(line) as { site: string; message: string })
    expect(lines.map((line) => line.site)).toEqual(['app.hostChecks.aplay'])
    expect(lines[0]!.message).toContain('aplay is not installed')
  })
})
