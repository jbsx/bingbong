import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import { FakeBrowser } from '../../core/testing/doubles'
import { createDirectCommandRunner } from './commandRunner'

function harness() {
  const browser = new FakeBrowser()
  const events: PipelineEvent[] = []
  const screenshots: string[] = []
  let now = 1_000
  let turns = 0
  const runner = createDirectCommandRunner({
    browser,
    publish: (event) => events.push(event),
    now: () => now++,
    mintTurnId: () => `turn-${++turns}`,
    screenshotDir: () => '/shots',
    saveScreenshot: async (path) => {
      screenshots.push(path)
    },
  })
  return { browser, events, screenshots, runner }
}

describe('the direct command runner', () => {
  it('runs a CLI-grammar command against the browser and publishes the turn as events', async () => {
    const { browser, events, runner } = harness()
    expect(await runner.run('navigate youtube.com')).toBe(true)
    expect(browser.navigations).toEqual(['youtube.com'])
    expect(events.map((event) => event.type)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'display', 'done'])
    expect(events[0]).toMatchObject({ type: 'command', turnId: 'turn-1', text: 'navigate youtube.com' })
    expect(events[2]).toMatchObject({ type: 'tool_call', name: 'navigate', args: { url: 'youtube.com' } })
    expect(events[5]).toMatchObject({ type: 'done', turnId: 'turn-1', outcome: 'done' })
    expect(runner.getState()).toBe('idle')
  })

  it('adopts the voice turn id it is given and flags a truncated utterance', async () => {
    const { events, runner } = harness()
    await runner.run('read', 'voice-7', true)
    expect(events[0]).toMatchObject({ type: 'command', turnId: 'voice-7' })
    expect(events[1]).toMatchObject({ type: 'error', turnId: 'voice-7' })
    expect(events.at(-1)).toMatchObject({ type: 'done', turnId: 'voice-7', outcome: 'done' })
  })

  it('refuses a blank command or one submitted while a run is active, publishing nothing for it', async () => {
    const { browser, events, runner } = harness()
    expect(await runner.run('   ')).toBe(false)
    expect(events).toEqual([])
    let release: () => void = () => {}
    browser.readPage = () => new Promise((resolve) => (release = () => resolve('<page>')))
    const first = runner.run('read')
    await Promise.resolve()
    expect(runner.getState()).toBe('running')
    expect(await runner.run('back')).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(events.filter((event) => event.type === 'command')).toHaveLength(1)
  })

  it('reports an unparseable command as a failed turn without touching the browser', async () => {
    const { browser, events, runner } = harness()
    await runner.run('open youtube and play something')
    expect(browser.navigations).toEqual([])
    expect(events.map((event) => event.type)).toEqual(['command', 'error', 'done'])
    expect(events[2]).toMatchObject({ type: 'done', outcome: 'failed' })
  })

  it('reports a browser failure as a failed tool result and a failed turn', async () => {
    const { browser, events, runner } = harness()
    browser.click = async () => {
      throw new Error('ref 9 is gone')
    }
    await runner.run('click 9')
    expect(events.map((event) => event.type)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'done'])
    expect(events[3]).toMatchObject({ type: 'tool_result', ok: false, error: 'ref 9 is gone' })
    expect(events[4]).toMatchObject({ type: 'done', outcome: 'failed' })
  })

  it('an abort during the action ends the turn cancelled, with no Card', async () => {
    const { browser, events, runner } = harness()
    let release: () => void = () => {}
    browser.scroll = () => new Promise((resolve) => (release = () => resolve('scrolled down')))
    const run = runner.run('scroll down')
    await Promise.resolve()
    expect(runner.abort()).toBe(true)
    release()
    await run
    expect(events.map((event) => event.type)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'status', 'done'])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    expect(runner.abort()).toBe(false)
  })

  it('saves a screenshot under the screenshot dir and names the file in the Card', async () => {
    const { events, screenshots, runner } = harness()
    await runner.run('screenshot')
    expect(screenshots).toEqual(['/shots/screenshot-1.jpg'])
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: 'screenshot saved: /shots/screenshot-1.jpg' })
  })
})
