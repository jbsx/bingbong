import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The Idle Screen by a line (#458): the card offers it whenever it is not up,
// and a pick brings it up by the idle shortcut's road. The line's own turn
// goes on after the pick — its Answer, its status — and none of that may
// wake the screen it just brought up. A stand-in Decision Model on
// /v1/systemone picks `show_idle` surely, so no model is asked.

interface StandIn {
  readonly url: string
  /** The action options of every ask it answered. */
  readonly asked: string[][]
  close(): Promise<void>
}

async function startDecisionStandIn(): Promise<StandIn> {
  const asked: string[][] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    request.on('end', () => {
      const { questions } = JSON.parse(body) as { questions: Record<string, { type: string; criteria?: Record<string, string> }> }
      const answers = Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type !== 'choice') return [key, { type: 'noul', noul: 0.05 }]
          const labels = Object.keys(question.criteria ?? {})
          if (key === 'action') asked.push(labels)
          const choice = key === 'action' && labels.includes('show_idle') ? 'show_idle' : labels.includes('none') ? 'none' : labels[0]!
          const rest = (1 - 0.95) / Math.max(1, labels.length - 1)
          return [key, { type: 'choice', choice, confidence: 0.95, probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 0.95 : rest])) }]
        }),
      )
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ answers, model: 'stand-in' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, asked, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

describe('idle screen e2e: brought back by a line (#458)', () => {
  let harness: Harness
  let fixture: FixtureServer
  let standIn: StandIn
  let userDataDir: string

  const shows = (selector: string): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('${selector}')`)

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-by-voice-'))
    fixture = await startFixtureServer()
    standIn = await startDecisionStandIn()
    harness = await startHarness({
      userDataDir,
      fixture,
      env: { BINGBONG_DECISION_BASE_URL: standIn.url, BINGBONG_DECISION_API_KEY: 'stand-in', BINGBONG_DECISION_MODEL: 'stand-in' },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await standIn?.close()
    await fixture?.close()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('"go to the idle screen" over a page brings the Idle Screen up, and the rest of its turn leaves it up', async () => {
    await harness.navigatePane(fixture.url('/'))
    await waitFor(async () => ((await shows('.url-input')) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await shows('.idle-screen')).toBe(false)

    await harness.submitCommand('go to the idle screen')
    await waitFor(async () => ((await shows('.idle-screen')) ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
    // The screen came up mid-turn, so the line keeps its card through to Done.
    await waitFor(async () => ((await shows('.turn-card[data-state="done"]')) ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
    expect(standIn.asked[0]).toContain('show_idle')
    // The turn has ended (its Answer and its status have reached the dashboard), and the screen is still up.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await shows('.idle-screen')).toBe(true)
    expect(await harness.paneUrl()).toBe(fixture.url('/'))
  })
})
