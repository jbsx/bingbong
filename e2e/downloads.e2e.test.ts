import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approveConfirmationScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, DOWNLOAD_PAYLOAD, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Download routing e2e: an agent click on a download link (risk-gated, user
// approves) must land the file in the bingbong downloads dir — never a save
// dialog, never elsewhere — and the completion must be spoken and displayed
// with the filename. BINGBONG_DOWNLOADS_DIR isolates the run from ~/Downloads.

// The /risky fixture's DOM order fixes the refs: [8] is the "Download probe"
// attachment link.
const DOWNLOAD_REF = 8

describe('download routing e2e', () => {
  let fixture: FixtureServer
  let harness: Harness
  let downloadsDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    downloadsDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-downloads-'))

    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/risky') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c3', name: 'click', args: { ref: DOWNLOAD_REF } }] },
      { kind: 'answer', speak: 'Downloading it now.', display: 'Download started.' },
    ]
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_DOWNLOADS_DIR: downloadsDir,
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
    if (downloadsDir) await rm(downloadsDir, { recursive: true, force: true }).catch(() => {})
  })

  it('asks, then routes the approved download and announces it by filename', async () => {
    expect(await harness.submitCommand('download the probe file')).toBe('submitted')
    await harness.waitForPaneUrl(fixture.url('/risky'))

    // The gate pauses on the download confirmation. It names the link's
    // href basename ("dl") — the Content-Disposition filename only surfaces
    // once the download itself starts.
    const prompt = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(
          `document.querySelector('.confirmation-prompt')?.textContent ?? ''`,
        )
        return text === '' ? undefined : text
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    expect(prompt).toBe('Download "dl"?')

    expect(await harness.dashboardEval<string>(approveConfirmationScript())).toBe('approved')

    // The file arrives inside the bingbong downloads dir, contents intact.
    const downloadPath = join(downloadsDir, 'probe.bin')
    await waitFor(() => readFile(downloadPath, 'utf-8').catch(() => undefined), {
      timeoutMs: 20000,
      intervalMs: 250,
    })
    expect(await readFile(downloadPath, 'utf-8')).toBe(DOWNLOAD_PAYLOAD)

    // The completion is announced with the filename — spoken and displayed.
    await waitFor(
      async () => {
        const transcript = await harness.overlayEval<string>(
          `Array.from(document.querySelectorAll('.feed-entry')).map((el) => el.textContent).join('\\n')`,
        )
        return transcript.includes('Download complete: probe.bin') && transcript.includes(downloadsDir)
          ? transcript
          : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
  })
})
