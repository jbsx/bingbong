import { describe, expect, it } from 'vitest'
import { FakeBrowser, FakeClock, FakeVision, RecordingTts, ScriptedLlm } from '../testing/doubles'
import { AUTO_VISION_DESCRIBE_MS, VISION_DEADLINE_NUDGE, VisionDeadlineError } from '../ports/vision'
import type { PipelineEvent } from './events'
import type { ToolContext } from './tool'
import { AUTO_VISION_COOLDOWN_MS, createBrowserTools } from './browserTools'
import { createCommandPipeline } from './createCommandPipeline'
import { createLookTool } from './visionGroundingTools'

async function run(browser: FakeBrowser, vision: FakeVision, turns: ConstructorParameters<typeof ScriptedLlm>[0]) {
  const llm = new ScriptedLlm(turns)
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: [...createBrowserTools(browser, vision), createLookTool(browser, vision)],
  })
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute('finish the task')) events.push(event)
  return { events, llm }
}

describe('automatic page vision through the command pipeline', () => {
  it('describes the screenshot after a click reports no observable change', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.description = 'A transparent consent overlay is blocking the controls.'
    const { llm } = await run(browser, vision, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 1 } }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])

    expect(vision.describeRequests).toHaveLength(1)
    expect(llm.requests[1]?.toolResults[0]?.outcome).toEqual({
      ok: true,
      result:
        'clicked [1]: urlChanged=false dialogOpen=false; no observable change\n' +
        'Auto-vision (no observable change): A transparent consent overlay is blocking the controls.',
    })
  })

  it('describes the screenshot after two consecutive near-identical read_page ref sets', async () => {
    const browser = new FakeBrowser()
    browser.readPage = async () => '[1] First button\n[2] Second button\n[3] Third button'
    const vision = new FakeVision()
    vision.description = 'A transparent consent overlay is blocking the controls.'
    const { llm } = await run(browser, vision, [
      { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'r2', name: 'read_page', args: {} }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])

    expect(vision.describeRequests).toHaveLength(1)
    expect(llm.requests[2]?.toolResults.at(-1)?.outcome).toMatchObject({
      ok: true,
      result: expect.stringContaining('Auto-vision (repeated near-identical page reads)'),
    })
  })

  it('describes the screenshot when a browser action fails with a stale ref', async () => {
    const browser = new FakeBrowser()
    browser.click = async () => {
      throw new Error('ref 99 not found — the page may have changed, run read_page to refresh refs')
    }
    const vision = new FakeVision()
    vision.description = 'A transparent consent overlay is blocking the controls.'
    const { llm } = await run(browser, vision, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 99 } }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])

    expect(vision.describeRequests).toHaveLength(1)
    expect(llm.requests[1]?.toolResults[0]?.outcome).toEqual({
      ok: false,
      error:
        'ref 99 not found — the page may have changed, run read_page to refresh refs\n' +
        'Auto-vision (stale ref): A transparent consent overlay is blocking the controls.',
    })
  })

  it('shares thirty calls between automatic vision and look, and refusals consume nothing', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.description = 'A transparent consent overlay is blocking the controls.'
    const lookCalls = Array.from({ length: 30 }, (_, index) => ({ id: `l${index}`, name: 'look', args: {} }))
    const { llm } = await run(browser, vision, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 1 } }, ...lookCalls] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])

    expect(vision.describeRequests).toHaveLength(30)
    expect(browser.screenshotCalls).toBe(30)
    const outcomes = llm.requests[1]?.toolResults.map((result) => result.outcome) ?? []
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, error: 'vision call limit (30) reached for this run' },
    ])
  })

  it('asks for a shorter deadline than a model-requested Look', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    await run(browser, vision, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'click', args: { ref: 1 } },
          { id: 'l1', name: 'look', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])

    const [autoRequest, lookRequest] = vision.describeRequests
    expect(autoRequest?.lookCapMs).toBe(AUTO_VISION_DESCRIBE_MS)
    expect(lookRequest?.lookCapMs).toBeUndefined()
  })

  /** Direct click-tool execution against a hand-built run context. */
  function clickHarness(vision: FakeVision): {
    execute(): Promise<unknown>
    executeOn(context: ToolContext): Promise<unknown>
    advanceCooldown(): void
    freshContext(): ToolContext
  } {
    const click = createBrowserTools(new FakeBrowser(), vision).find((tool) => tool.name === 'click')!
    const call = { id: 'c1', name: 'click', args: { ref: 1 } }
    const clock = new FakeClock()
    const context: ToolContext = { clock, acquireVision: () => ({ ok: true }) }
    return {
      execute: () => click.execute(call, context),
      executeOn: (other) => click.execute(call, other),
      advanceCooldown: () => clock.advance(AUTO_VISION_COOLDOWN_MS),
      freshContext: () => ({ clock: new FakeClock(), acquireVision: () => ({ ok: true }) }),
    }
  }

  it('cools down per run: repeats during one slow patch skip the vision wait', async () => {
    const vision = new FakeVision()
    const harness = clickHarness(vision)

    const first = String(await harness.execute())
    const second = String(await harness.execute())
    expect(vision.describeRequests).toHaveLength(1)
    expect(first).toContain('Auto-vision (no observable change):')
    expect(second).toContain('Auto-vision (no observable change) skipped')

    // The cooldown expires and auto-vision fires again…
    harness.advanceCooldown()
    await harness.execute()
    expect(vision.describeRequests).toHaveLength(2)
    // …and a fresh run (its own context) never cooled down.
    await harness.executeOn(harness.freshContext())
    expect(vision.describeRequests).toHaveLength(3)
  })

  it('keeps a missed advisory deadline a one-line note — never a nudge — and cools down after it', async () => {
    const vision = new FakeVision()
    vision.failWith = new VisionDeadlineError(3_200, 'first-token')
    const harness = clickHarness(vision)

    const first = String(await harness.execute())
    expect(first).toBe(
      'clicked [1]: urlChanged=false dialogOpen=false; no observable change\n' +
        'Auto-vision failed (no observable change): Vision request did not begin answering within 3200ms',
    )
    expect(first).not.toContain(VISION_DEADLINE_NUDGE)

    const second = String(await harness.execute())
    expect(vision.describeRequests).toHaveLength(1)
    expect(second).toContain('skipped')
  })
})
