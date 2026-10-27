import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The Appliance Card (#485) on the app's own road: a /v1/systemone stand-in
// serves the Decision Model (#458's recipe) and reads which card it was
// asked — the Appliance Card's state opens "The user spoke to the
// appliance". A media line fires on the Appliance ask alone, by kind on the
// playing element, with no page collect between the Endpoint and the fire;
// a line about the page reads `page` there and goes on to the page card's
// ask, whose click fires.

interface Ask {
  readonly state: string
  readonly options: Record<string, unknown>
}

interface StandIn {
  readonly url: string
  readonly asks: Ask[]
  close(): Promise<void>
}

/** Answers the Appliance Card by `appliance` and the page card by `page`, each a label picked off its options; every other Choice `none`, or its first. */
async function startDecisionStandIn(pick: { appliance: (options: string[]) => string; page: (options: Record<string, unknown>) => string; amount?: string }): Promise<StandIn> {
  const asks: Ask[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    request.on('end', () => {
      const { state, questions } = JSON.parse(body) as { state: string; questions: Record<string, { type: string; criteria?: Record<string, unknown> }> }
      const options = questions.action?.criteria ?? {}
      asks.push({ state, options })
      const onAppliance = state.startsWith('The user spoke to the appliance')
      const answers = Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type !== 'choice') return [key, { type: 'noul', noul: 0.05 }]
          const labels = Object.keys(question.criteria ?? {})
          const choice = key === 'action' ? (onAppliance ? pick.appliance(labels) : pick.page(options)) : key === 'amount' && pick.amount !== undefined ? pick.amount : labels.includes('none') ? 'none' : labels[0]!
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
  return { url: `http://127.0.0.1:${port}`, asks, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

/** The labels of the page card's clicks whose line names the words. */
const clickNaming = (options: Record<string, unknown>, words: string): string => Object.entries(options).find(([label, line]) => label.startsWith('click-') && String(line).includes(words))?.[0] ?? 'none'

async function records(userDataDir: string, prefix: string): Promise<Record<string, unknown>[]> {
  const logs = join(userDataDir, 'logs')
  const files = (await readdir(logs).catch(() => [] as string[])).filter((name) => name.startsWith(prefix))
  return (await Promise.all(files.map((name) => readFile(join(logs, name), 'utf8'))))
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('the Appliance Card (#485): a media line fires on the small ask, a page line goes on to the page card', () => {
  let harness: Harness
  let fixture: FixtureServer
  let host: StandIn
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-appliance-card-'))
    fixture = await startFixtureServer()
    host = await startDecisionStandIn({
      appliance: (labels) => (labels.includes('media-volume') && host.asks.length === 1 ? 'media-volume' : 'page'),
      page: (options) => clickNaming(options, 'Second page'),
      amount: 'down-step',
    })
    harness = await startHarness({
      userDataDir,
      fixture,
      // No sound card under Xvfb: muted, the fixture's video plays.
      launchArgs: ['--mute-audio'],
      env: { BINGBONG_DECISION_BASE_URL: host.url, BINGBONG_DECISION_API_KEY: 'stand-in', BINGBONG_DECISION_MODEL: 'stand-in' },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await host?.close()
    await fixture?.close()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('a media line fires on the Appliance ask alone, on the playing element by kind, with no page collect between the Endpoint and the fire', async () => {
    // The app's own navigate, an exact line (no host asked): the page it opens may play.
    await harness.submitCommand(`navigate ${fixture.url('/native-video')}`)
    await harness.waitForPaneUrl(fixture.url('/native-video'))
    await waitFor(async () => ((await harness.paneEval<number>(`document.querySelector('video')?.currentTime ?? 0`)) > 0.5 ? true : undefined), { timeoutMs: 15_000, intervalMs: 100 })
    expect(host.asks).toHaveLength(0)
    const volume = await harness.paneEval<number>(`document.querySelector('video').volume`)
    await harness.submitCommand('turn it down a bit')
    await waitFor(async () => ((await harness.paneEval<number>(`document.querySelector('video').volume`)) < volume ? true : undefined), { timeoutMs: 15_000, intervalMs: 100 })
    expect(host.asks).toHaveLength(1)
    expect(host.asks[0]!.state).toContain('The user spoke to the appliance')
    expect(host.asks[0]!.state).not.toContain('Refs (number')
    const decision = (await records(userDataDir, 'decision-')).find((record) => record.transcript === 'turn it down a bit')
    expect(decision).toMatchObject({ verb: 'media', card: 'appliance', mediaOp: { op: 'volume' } })
    const spans = await records(userDataDir, 'perf-')
    expect(spans.filter((span) => span.turnId === decision!.turnId && span.stage === 'browser-collect')).toEqual([])
  })

  it('`page` goes on to the page card\'s ask, whose click fires', async () => {
    const before = host.asks.length
    await harness.submitCommand('the link to the next one')
    await harness.waitForPaneUrl(fixture.url('/second'))
    expect(host.asks.slice(before, before + 2).map((ask) => ask.state.split('\n')[0]!.slice(0, 31))).toEqual(['The user spoke to the appliance', 'The user spoke to a web browser'])
    const decision = (await records(userDataDir, 'decision-')).find((record) => record.transcript === 'the link to the next one' && record.verb === 'click')
    expect(decision).toMatchObject({ card: 'page', appliance: { chose: 'page' } })
  })
})
