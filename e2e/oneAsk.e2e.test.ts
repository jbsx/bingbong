import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { feedText } from './feed'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The one ask lands (#477, ADR 0076 as amended). The guard of every Early
// Fire, 429/timeout and "Help." line in the Failed Lines ledger the issue
// claimed: the scripted ear streams partials of a spoken line, and two
// /v1/systemone stand-ins serve the Decision Model — the live one answers
// every ask 429, the Fallback Host answers. Nothing fires on a partial, the
// one ask is made at the Endpoint and answered by the second host after the
// 429, and a typed "Help." with the ear's full stop shows the help.

interface StandIn {
  readonly url: string
  /** The state text of every ask it was sent. */
  readonly states: string[]
  close(): Promise<void>
}

/** A /v1/systemone host that answers every ask 429, or picks `show_idle` surely, recording what it was asked. */
async function startDecisionStandIn(answer: 'rate-limited' | 'show-idle'): Promise<StandIn> {
  const states: string[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    request.on('end', () => {
      const { state, questions } = JSON.parse(body) as { state: string; questions: Record<string, { type: string; criteria?: Record<string, string> }> }
      states.push(state)
      if (answer === 'rate-limited') {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'rate limited' } }))
        return
      }
      const answers = Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type !== 'choice') return [key, { type: 'noul', noul: 0.05 }]
          const labels = Object.keys(question.criteria ?? {})
          const choice = key === 'action' && labels.includes('show_idle') ? 'show_idle' : labels.includes('none') ? 'none' : labels[0]!
          const rest = (1 - 0.95) / Math.max(1, labels.length - 1)
          return [key, { type: 'choice', choice, confidence: 0.95, probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 0.95 : rest])) }]
        }),
      )
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ answers, model: 'stand-in-2' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, states, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

const SPEECH = 0.95
const SILENCE = 0.01
const run = (value: number, frames: number): number[] => Array.from({ length: frames }, () => value)

const LINE = 'Go to the idle screen.'
/** The partials the ear streams before the Endpoint: each one the stand-in would read as `show_idle` surely, were it asked. */
const PARTIALS = ['go to the', 'go to the idle', 'go to the idle screen']

describe('one ask (#477): no fire on a partial, the next host after a 429, "Help." with the ear\'s full stop', () => {
  let harness: Harness
  let fixture: FixtureServer
  let live: StandIn
  let fallback: StandIn
  let userDataDir: string

  const shows = (selector: string): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('${selector}')`)
  const feed = async (frames: number): Promise<void> => {
    await harness.dashboardEval<string>(`(() => {
      for (let i = 0; i < ${frames}; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
      return 'fed'
    })()`)
  }

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-one-ask-'))
    fixture = await startFixtureServer()
    live = await startDecisionStandIn('rate-limited')
    fallback = await startDecisionStandIn('show-idle')
    harness = await startHarness({
      userDataDir,
      fixture,
      env: {
        BINGBONG_DECISION_BASE_URL: live.url,
        BINGBONG_DECISION_API_KEY: 'stand-in',
        BINGBONG_DECISION_MODEL: 'stand-in',
        // The Fallback Host: its own base URL, its key by the name of the env var that holds it.
        BINGBONG_DECISION_FALLBACKS: `stand-in-2|${fallback.url}|STAND_IN_2_KEY`,
        STAND_IN_2_KEY: 'stand-in-2',
        BINGBONG_WAKE_ENGINE: 'node',
        // Three quiet chunks, one hot chunk, quiet for good.
        BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.01, 0.01, 0.99, 0.01]),
        // Speech for the wake's gate, then the one Utterance, ended by silence.
        BINGBONG_VAD_SCRIPT: JSON.stringify([...run(SPEECH, 12), ...run(SPEECH, 40), ...run(SILENCE, 80)]),
        BINGBONG_STT_SCRIPT: JSON.stringify([{ text: LINE, partials: PARTIALS }]),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await live?.close()
    await fallback?.close()
    await fixture?.close()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('fires nothing on a partial, asks once at the Endpoint, and is answered by the second host after the first answered 429', async () => {
    await harness.navigatePane(fixture.url('/'))
    await waitFor(async () => ((await shows('.url-input')) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await shows('.idle-screen')).toBe(false)

    // The wake: the ear goes listening.
    await feed(12)
    await waitFor(async () => ((await harness.dashboardEval<{ listening: boolean }>('window.bingbong.voice.getState()')).listening ? true : undefined), { timeoutMs: 30000, intervalMs: 100 })
    // The Utterance, its partials streamed as it is spoken, then the silence that ends it.
    await feed(200)

    await waitFor(async () => ((await shows('.idle-screen')) ? true : undefined), { timeoutMs: 20000, intervalMs: 100 })
    // One ask, at the Endpoint: the live host saw it once (and refused it), the Fallback Host once (and answered). No partial was asked.
    expect(live.states).toHaveLength(1)
    expect(fallback.states).toHaveLength(1)
    expect(live.states[0]).toContain(`"${LINE}"`)
    expect(fallback.states[0]).toBe(live.states[0])
    for (const partial of PARTIALS) expect(live.states[0]).not.toContain(`"${partial}"`)
  })

  it('a typed "Help." shows the help', async () => {
    await harness.submitCommand('Help.')
    const text = await waitFor(
      async () => {
        const shown = await feedText(harness)
        return shown.includes('a line is one command') ? shown : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(text).toContain('help                     this text')
    // The grammar read it: no host was asked.
    expect(live.states).toHaveLength(1)
    expect(fallback.states).toHaveLength(1)
  })
})
