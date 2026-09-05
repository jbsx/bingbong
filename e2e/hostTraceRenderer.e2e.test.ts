import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// The renderer's Host Trace records (#187, ADR 0031). The unit suite
// proves what main is willing to write; this proves the other half — that
// the seams actually fire in a running app, from both Session-bearing
// pages, and that what lands on disk is ids and counts. A record set that
// is correct in principle and never emitted answers no bug report.

const SCRIPT: AssistantTurn[] = [{ kind: 'answer', speak: 'Done.', display: 'The answer.' }]

/** Every renderer-owned record kind and exactly the keys it may carry. */
const RENDERER_RECORD_KEYS: Record<string, readonly string[]> = {
  feed_cleared: ['cause', 'entries', 'surface'],
  feed_panel: ['mode', 'open', 'surface'],
  evidence_rendered: ['answered', 'received', 'rendered', 'surface'],
  session_readopt: ['adopted', 'adoptedGeneration', 'adoptedSessionId', 'source', 'surface'],
}

/** The stamp every host record carries, whoever produced it. */
const STAMPED_KEYS = ['at', 'kind', 'sessionId', 'v']

interface HostRecord {
  kind: string
  surface?: string
  [key: string]: unknown
}

async function readHostTrace(userDataDir: string): Promise<HostRecord[]> {
  const logsDir = join(userDataDir, 'logs')
  const files = (await readdir(logsDir)).filter((name) => /^host-trace-.*\.jsonl$/.test(name)).sort()
  const records: HostRecord[] = []
  for (const file of files) {
    const text = await readFile(join(logsDir, file), 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim() !== '') records.push(JSON.parse(line) as HostRecord)
    }
  }
  return records
}

describe('the renderer Host Trace records e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture.close()
  })

  it('lands every renderer seam on disk, as ids and counts, from both pages (#187)', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-host-trace-'))
    const app = await startHarness({
      fixture,
      userDataDir,
      env: { BINGBONG_HOST_TRACE: '1', BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT) },
    })
    try {
      // A Session, an open panel, and one answered command: enough for
      // both pages to have loaded, re-adopted, read evidence and seen the
      // panel's open state.
      await app.ensurePanelOpen()
      await app.submitCommand('hello')
      await waitFor(
        () =>
          app
            .overlayEval<boolean>(`!!document.querySelector('.feed-entry')`)
            .then((seen) => (seen ? true : undefined)),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // A real unhandled failure in the page — thrown, not dispatched, so
      // it travels the path a React error actually takes.
      await app.dashboardEval(`setTimeout(() => { throw new Error('e2e renderer boom') }, 0)`)

      const records = await waitFor(
        async () => {
          const seen = await readHostTrace(userDataDir)
          return seen.some((record) => record.kind === 'fault' && String(record.site).startsWith('renderer.'))
            ? seen
            : undefined
        },
        { timeoutMs: 10_000, intervalMs: 200 },
      )

      const kinds = new Set(records.map((record) => record.kind))
      // The five, all of them, from a single ordinary launch.
      expect(kinds).toContain('fault')
      expect(kinds).toContain('feed_cleared')
      expect(kinds).toContain('feed_panel')
      expect(kinds).toContain('evidence_rendered')
      expect(kinds).toContain('session_readopt')

      // Both Session-bearing pages report, and are told apart.
      const surfaces = new Set(records.filter((r) => r.surface !== undefined).map((r) => r.surface))
      expect(surfaces).toEqual(new Set(['dashboard', 'feed_panel']))

      const fault = records.find((record) => record.kind === 'fault' && String(record.site).startsWith('renderer.'))!
      expect(fault.site).toBe('renderer.dashboard.window.error')
      expect(String(fault.message)).toContain('e2e renderer boom')

      // The panel was open, and the record says so.
      expect(records.some((record) => record.kind === 'feed_panel' && record.open === true)).toBe(true)

      // Nothing the page said, nothing it rendered: every renderer record
      // carries only its declared fields plus main's own stamp.
      for (const record of records) {
        const allowed = RENDERER_RECORD_KEYS[record.kind]
        if (allowed === undefined) continue
        for (const key of Object.keys(record)) {
          expect([...allowed, ...STAMPED_KEYS]).toContain(key)
        }
      }
      // And the command's own text is nowhere in any of them.
      const rendererRecords = records.filter((record) => RENDERER_RECORD_KEYS[record.kind] !== undefined)
      expect(JSON.stringify(rendererRecords)).not.toContain('hello')
      expect(JSON.stringify(rendererRecords)).not.toContain('The answer.')
    } finally {
      await app.quit()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
