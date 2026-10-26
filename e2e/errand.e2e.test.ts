import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'

// The Errand (#467, ADR 0095) through the app: a two-step goal on a
// fixture page, driven by a scripted Planner stand-in (as /v1/systemone
// stands in for Jev) behind BINGBONG_PLANNER_BASE_URL. Step one types the
// comment; step two clicks the button that would post it, which the
// stand-in calls `stays` — the hard policy makes it `leaves` by its label,
// so it is said back, the harness answers the confirm `no`
// (BINGBONG_CONFIRM_ANSWER, as the goal gate does), and nothing is posted.
// The Planner then ends the Errand in its own sentence.

/** The scripted Planner: each answer read off the card it is shown, by the refs' own lines. */
function startPlannerStandIn(): Promise<{ url: string; calls: string[]; close(): Promise<void> }> {
  const calls: string[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      const user = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages.find((message) => message.role === 'user')?.content ?? ''
      calls.push(user)
      const field = /^\[(\d+)\] \S+ "Add a comment/m.exec(user)?.[1]
      const button = /^\[(\d+)\] button "Comment"/m.exec(user)?.[1]
      const answer =
        calls.length === 1
          ? { next: 'act', action: { kind: 'type', ref: Number(field), text: 'this is great' }, class: 'stays', why: 'write the comment' }
          : calls.length === 2
            ? { next: 'act', action: { kind: 'click', ref: Number(button) }, class: 'stays', why: 'post the comment' }
            : { next: 'done', sentence: user.includes('the person said no') ? 'I did not post the comment: you said no.' : 'The comment is posted.' }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ model: 'stand-in', choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((done) => server.close(() => done())) })
    })
  })
}

describe('errand e2e: a two-step goal whose send is said back and refused', () => {
  let harness: Harness
  let fixture: FixtureServer
  let standIn: Awaited<ReturnType<typeof startPlannerStandIn>>
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-errand-'))
    fixture = await startFixtureServer()
    standIn = await startPlannerStandIn()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      env: { BINGBONG_ERRAND: '1', BINGBONG_CONFIRM_ANSWER: 'no', BINGBONG_PLANNER_BASE_URL: standIn.url, BINGBONG_PLANNER_API_KEY: 'stand-in', BINGBONG_PLANNER_MODEL: 'stand-in' },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    const url = fixture.url('/errand')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await standIn?.close().catch(() => {})
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('types the comment, says the send back, is answered no, posts nothing, and ends in the Planner\'s own sentence', async () => {
    const since = harness.cliMark()
    harness.cliWrite('errand comment "this is great" on this video')
    await harness.waitForCliOutput(/^said: "I did not post the comment: you said no\."$/, { since }).catch((error: unknown) => {
      throw new Error(`${String(error)}\nthe harness printed:\n${harness.cliOutput().slice(since)}\nthe Planner was asked ${standIn.calls.length} times`)
    })
    const output = harness.cliOutput().slice(since)
    expect(output).toMatch(/^confirm: This will comment: this is great\. Yes or no\?$/m)
    expect(output).toMatch(/^answered: no$/m)
    // Aloud only the outcome: neither step said a line of its own.
    expect(output.match(/^said: /gm)).toHaveLength(1)
    expect(await harness.paneEval<string>(`document.getElementById('comment').value`)).toBe('this is great')
    expect(await harness.paneEval<string | null>('window.__posted')).toBeNull()
    expect(standIn.calls).toHaveLength(3)
    // The Planner saw the refusal as the person's answer before it ended.
    expect(standIn.calls[2]).toMatch(/the person said no \("no"\): it was not done/)
  }, 60_000)
})
