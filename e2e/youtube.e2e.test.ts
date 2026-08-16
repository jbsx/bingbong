import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli, refOf } from './cliSupport'
import { waitFor } from './waitFor'

// Validation gate from the spec: "CDP snapshot + click reliability on YouTube
// specifically". Network- and region-dependent, so it only runs when asked:
//   BINGBONG_YOUTUBE_E2E=1 pnpm test:e2e
const YOUTUBE_HOME = 'https://www.youtube.com/'
const YOUTUBE_RESULTS = 'https://www.youtube.com/results?search_query=mechanical+keyboard'

async function readRefLines(harness: Harness): Promise<string[]> {
  const since = harness.cliMark()
  harness.cliWrite('read')
  await harness.waitForCliOutput(/^# /, { since })
  return harness
    .cliOutput()
    .split('\n')
    .filter((line) => /^\[\d+\] (button|link|input|media)/.test(line.replace(/^bingbong> /, '')))
}

// The EU consent wall renders below-the-fold inside a tp-yt-paper-dialog, so
// its buttons never make it into a viewport-bounded snapshot and the modal
// backdrop swallows synthetic clicks at visible coordinates. The wall is an
// environment precondition, not the behavior under test — dismiss it directly
// from the harness (the video-link click below still goes through the CLI's
// real ref-click path).
async function dismissConsentDialog(harness: Harness): Promise<void> {
  const clicked = await harness
    .paneEval<boolean>(`(() => {
      const buttons = [...document.querySelectorAll('button')]
      const accept = buttons.find((b) => /^Accept all$/m.test((b.textContent || '').trim()))
      const reject = buttons.find((b) => /^Reject all$/m.test((b.textContent || '').trim()))
      const target = accept || reject
      if (!target) return false
      target.click()
      return true
    })()`)
    .catch(() => false)
  if (!clicked) return

  await waitFor(
    async () => {
      const gone = await harness.paneEval<boolean>(
        `![...document.querySelectorAll('button')].some((b) => /^(Accept|Reject) all$/m.test((b.textContent || '').trim()))`,
      )
      return gone ? true : undefined
    },
    { timeoutMs: 15000, intervalMs: 250 },
  ).catch(() => {})
  // Let the SPA settle after the dialog closes.
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const SIDEBAR_LABELS =
  'YouTube|Home|Shorts|Subscriptions|You|History|Playlists|Trending|Music|Movies|Live|Gaming|News|Sport|Learning|Fashion|Beauty|Podcasts|Playables|Sign in|Settings|Report history'

// Real video results carry a per-video "Action menu"/"More actions" button
// right after the title link (plus "N:N Now playing" timestamp links); ad
// blocks carry a "My Ad Centre" button instead. Selecting on those markers
// keeps the gate from clicking ads, which open popups rather than /watch
// pages.
function selectVideoLinks(refs: string[]): string[] {
  const lines = refs.map((line) => line.replace(/^bingbong> /, ''))
  const selected: string[] = []
  lines.forEach((line, i) => {
    if (!/^\[\d+\] link "/.test(line)) return
    const label = line.slice(line.indexOf('"') + 1, -1)
    if (new RegExp(`^(?:${SIDEBAR_LABELS})`).test(label)) return
    if (lines.slice(i + 1, i + 3).some((l) => /button "My Ad Centre"/.test(l))) return
    const isTimestampLink = /^\d+:\d+/.test(label)
    if (!isTimestampLink && label.length < 25) return
    const isVideo =
      isTimestampLink || lines.slice(i + 1, i + 4).some((l) => /button "(Action menu|More actions)"/.test(l))
    if (isVideo) selected.push(line)
  })
  return selected
}

// Ad clicks can open popup windows (real windows sharing the session). They
// steal OS focus from the pane and would confuse later target lookups, so
// close anything that is neither the pane nor the dashboard, then re-focus.
async function closeStrayPopups(harness: Harness): Promise<void> {
  const { targetInfos } = await harness.cdp.send<{ targetInfos: { targetId: string; type: string }[] }>(
    'Target.getTargets',
  )
  const known = new Set([harness.paneTargetId(), harness.dashboardTargetId()].filter(Boolean) as string[])
  for (const target of targetInfos) {
    if (target.type === 'page' && !known.has(target.targetId)) {
      await harness.cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {})
    }
  }
  await harness.focusPane().catch(() => {})
}

describe.skipIf(!process.env.BINGBONG_YOUTUBE_E2E)('youtube validation gate (network)', () => {
  let harness: Harness
  let screenshotPath: string

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--browser-cli'], pipeStdio: true })
    await harness.waitForCliOutput(/bingbong browser harness/)
    screenshotPath = join(await mkdtemp(join(tmpdir(), 'bingbong-yt-')), 'gate.jpg')
  })

  afterAll(async () => {
    await harness?.quit()
    if (screenshotPath) await rm(screenshotPath, { recursive: true, force: true }).catch(() => {})
  })

  it('snapshots the youtube home page with numbered refs', async () => {
    await cli(harness, `navigate ${YOUTUBE_HOME}`, /^navigated: https:\/\/(www\.)?youtube\.com\//)
    await harness.waitForPaneUrl(YOUTUBE_HOME)
    await harness.focusPane()
    await dismissConsentDialog(harness)

    const refs = await waitFor(
      async () => {
        const lines = await readRefLines(harness)
        return lines.length >= 10 ? lines : undefined
      },
      { timeoutMs: 30000, intervalMs: 1500 },
    )

    expect(refs.length).toBeGreaterThanOrEqual(10)
    expect(refs.some((line) => / input(\[\w+\])? |button ".*Search/.test(line))).toBe(true)
    expect(refs.some((line) => line.includes('link "'))).toBe(true)
  })

  it('clicks a video link by ref on a search results page', async () => {
    await cli(harness, `navigate ${YOUTUBE_RESULTS}`, /^navigated: /)
    await harness.waitForPaneUrl(YOUTUBE_RESULTS)
    await harness.focusPane()
    await dismissConsentDialog(harness)

    // Video results sit below the ads on a short viewport — scroll down
    // (through the CLI's own scroll command) and re-read until real video
    // candidates enter the snapshot.
    let candidates: string[] = []
    const scrollDeadline = Date.now() + 45_000
    while (candidates.length === 0 && Date.now() < scrollDeadline) {
      const lines = await readRefLines(harness)
      candidates = selectVideoLinks(lines)
      if (candidates.length === 0) {
        await cli(harness, 'scroll down', /^scrolled down$/)
      }
    }
    expect(candidates.length).toBeGreaterThan(0)

    // Try candidates in order until one navigates — layout varies between
    // sessions, so the markers alone can't guarantee a first-try video link.
    // If a whole batch fails (ads/overlays ate the clicks), re-read after a
    // further scroll and try a fresh batch — the gate must not be a coin flip.
    let landed: string | undefined
    for (let batch = 0; batch < 3 && !landed; batch++) {
      if (batch > 0) {
        await cli(harness, 'scroll down', /^scrolled down$/)
        candidates = selectVideoLinks(await readRefLines(harness))
      }
      for (const candidate of candidates.slice(0, 5)) {
        const ref = refOf(candidate)
        await cli(harness, `click ${ref}`, new RegExp(`^clicked ref ${ref}$`))
        landed = await waitFor(
          async () => {
            const url = await harness.paneUrl()
            // Shorts results land on /shorts/<id> rather than /watch.
            return url && (url.includes('/watch') || url.includes('/shorts/')) ? url : undefined
          },
          { timeoutMs: 8000, intervalMs: 250 },
        ).catch(() => undefined)
        if (landed) break
        await closeStrayPopups(harness)
      }
    }

    expect(landed).toBeDefined()
  })

  it('captures a real screenshot of youtube', async () => {
    await cli(harness, `screenshot ${screenshotPath}`, new RegExp(`^saved screenshot to ${screenshotPath} \\(\\d+ bytes\\)$`))
    const bytes = await readFile(screenshotPath)
    expect(bytes.byteLength).toBeGreaterThan(10_000)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
  })

  it('quits cleanly', async () => {
    await cli(harness, 'quit', /^bye$/)
  })
})
