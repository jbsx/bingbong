import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    // The same preload hands every frame the media-types watch the playback record names a codec by.
    expect(await harness.paneEval<string>('typeof window.__bingbongMediaTypes?.codecOf')).toBe('function')

    // The embed is its own site, so its own process: it posts what it heard to the page.
    const embedded = await waitFor(async () => (await harness.paneEval<{ av1: boolean; vp9: boolean } | null>('window.__embedCodecs ?? null')) ?? undefined, { timeoutMs: 10000, intervalMs: 100 })
    expect(embedded).toEqual({ av1: false, vp9: true })
  })
})

// The real probe, with no stand-in, under the kiosk's own launch: `--kiosk`
// and its .env's non-secret lines. Under Xvfb the GPU is software, so
// powerEfficient is false for every family and nothing is refused; the probe
// must still settle and say so, in the journal line and in the perf log's
// boot milestones. 2026-10-26: the kiosk's line was there every boot; it was
// `journalctl --user -u bingbong` that missed it, since Chromium moves the
// main process into its own app-<name>-<pid>.scope. The milestone is read
// from the pulled logs, whatever the journal is filtered by.
describe('codec probe e2e: the real probe settles and says so', () => {
  let harness: Harness | undefined
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-codec-probe-'))
    harness = await startHarness({
      userDataDir,
      pipeStdio: true,
      launchArgs: ['--kiosk'],
      env: {
        BINGBONG_GPU_CODECS: undefined,
        BINGBONG_RUN_TRACE: '1',
        BINGBONG_HOST_TRACE: '1',
        BINGBONG_DECISION_IMAGES: 'false',
        BINGBONG_DECISION_TIMEOUT_MS: '3000',
        BINGBONG_AUDIO_DUMP: '1',
        BINGBONG_BROWSER_SUBSPANS: '1',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('prints the [codecs] line from the GPU’s own answer', async () => {
    const line = await harness!.waitForCliOutput(/\[codecs\]/)
    expect(line).toMatch(/^\[codecs\] decoded on the GPU: none; refused to pages: none \(probe \d+ ms\)$/)
  })

  it('marks the settle as a boot milestone in the perf log', async () => {
    const logsDir = join(userDataDir, 'logs')
    const milestones = async (): Promise<string[]> => {
      const files = (await readdir(logsDir).catch(() => [] as string[])).filter((name) => name.startsWith('perf-'))
      const text = (await Promise.all(files.map((name) => readFile(join(logsDir, name), 'utf8')))).join('')
      return text
        .split('\n')
        .filter((line) => line.includes('"stage":"boot"'))
        .map((line) => String((JSON.parse(line) as { detail?: { milestone?: unknown } }).detail?.milestone))
    }
    const marked = await waitFor(async () => {
      const all = await milestones()
      return all.some((m) => m.startsWith('codecs-')) ? all : undefined
    }, { timeoutMs: 20000, intervalMs: 250 })
    expect(marked).toContain('codecs-answer')
  })
})
