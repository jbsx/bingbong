import { describe, expect, it } from 'vitest'
import type { PageSnapshot } from '../browser/snapshot'
import type { VisionModel } from '../ports/vision'
import { FakeBrowser, FakeClock, FakeVision, RecordingTts, ScriptedLlm } from '../testing/doubles'
import { createCommandPipeline } from './createCommandPipeline'
import { createBrowserTools } from './browserTools'
import type { PipelineEvent } from './events'
import { createVisionGroundingTools } from './visionGroundingTools'

const snapshot: PageSnapshot = {
  url: 'https://fixture.test/',
  title: 'Fixture',
  viewport: { width: 800, height: 600, scrollY: 0, scrollHeight: 600 },
  dialogOpen: false,
  dialogText: '',
  textDigest: '',
  refs: [
    {
      ref: 1,
      kind: 'button',
      label: 'Play video',
      inputType: null,
      rect: { x: 300, y: 200, width: 80, height: 40 },
      href: null,
      downloadsFile: false,
      submitsForm: false,
      credentialField: false,
      paymentField: false,
      inForm: false,
      formHasCredential: false,
      formHasPayment: false,
    },
  ],
  totalVisible: 1,
  truncated: false,
}

async function runGrounding(browser: FakeBrowser, vision: VisionModel, target: string): Promise<PipelineEvent[]> {
  const llm = new ScriptedLlm([
    { kind: 'tool_calls', calls: [{ id: 'v1', name: 'ground_visual', args: { target } }] },
    { kind: 'answer', speak: 'Found it.', display: 'Found it.' },
  ])
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: createVisionGroundingTools(browser, vision),
  })
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(`find ${target}`)) events.push(event)
  return events
}

describe('vision grounding through the command pipeline', () => {
  it('resolves a DOM-labelled target without calling vision', async () => {
    const browser = new FakeBrowser()
    browser.snapshot = snapshot
    browser.screenshotBytes = new Uint8Array([1, 2, 3])
    const vision = new FakeVision()

    const events = await runGrounding(browser, vision, 'play video button')

    expect(vision.locateRequests).toHaveLength(0)
    expect(browser.screenshotCalls).toBe(0)
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'DOM match: use ref 1',
    })
  })

  it('maps a vision point back to an actionable live-page ref', async () => {
    const browser = new FakeBrowser()
    browser.snapshot = { ...snapshot, refs: [], totalVisible: 0 }
    browser.screenshotBytes = new Uint8Array([4, 5, 6])
    browser.pointRef = 23
    const vision = new FakeVision()
    vision.location = { x: 340, y: 220 }

    const events = await runGrounding(browser, vision, 'the play button in the video thumbnail')

    expect(vision.locateRequests).toEqual([
      {
        image: new Uint8Array([4, 5, 6]),
        target: 'the play button in the video thumbnail',
        viewport: snapshot.viewport,
      },
    ])
    expect(browser.refPoints).toEqual([{ x: 340, y: 220 }])
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'Vision match: use ref 23',
    })
  })

  it('lets the next model turn click the ref returned by grounding', async () => {
    const browser = new FakeBrowser()
    browser.snapshot = { ...snapshot, refs: [], totalVisible: 0 }
    browser.pointRef = 23
    const vision = new FakeVision()
    vision.location = { x: 340, y: 220 }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [{ id: 'g1', name: 'ground_visual', args: { target: 'the play icon' } }],
        },
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: '$grounded_ref' } }] },
        { kind: 'answer', speak: 'Clicked.', display: 'Clicked.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [...createBrowserTools(browser), ...createVisionGroundingTools(browser, vision)],
    })

    for await (const event of pipeline.execute('click the play icon')) {
      // Consume the command to completion.
      void event
    }

    expect(browser.clicks).toEqual([23])
  })

  it('enforces thirty actual fallback calls per orchestrator run', async () => {
    const browser = new FakeBrowser()
    browser.snapshot = { ...snapshot, refs: [], totalVisible: 0 }
    const vision = new FakeVision()
    const calls = Array.from({ length: 35 }, (_, index) => ({
      id: `v${index}`,
      name: 'ground_visual',
      args: { target: `unlabelled target ${index}` },
    }))
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: createVisionGroundingTools(browser, vision),
    })
    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('find many targets')) events.push(event)

    expect(vision.locateRequests).toHaveLength(30)
    expect(browser.screenshotCalls).toBe(30)
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toHaveLength(5)
    expect(events.find((event) => event.type === 'tool_result' && !event.ok)).toMatchObject({
      error: expect.stringMatching(/vision call limit \(30\)/),
    })
  })

  it('returns a page description through look on demand', async () => {
    const browser = new FakeBrowser()
    browser.screenshotBytes = new Uint8Array([7, 8, 9])
    const vision = new FakeVision()
    vision.descriptions = ['A sign-in modal blocks the article.']
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] },
        { kind: 'answer', speak: 'Seen.', display: 'Seen.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: createVisionGroundingTools(browser, vision),
    })
    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('what is blocking the page')) events.push(event)

    expect(vision.describeRequests).toEqual([
      {
        image: new Uint8Array([7, 8, 9]),
        prompt: expect.stringMatching(/current browser page/i),
      },
    ])
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'A sign-in modal blocks the article.',
    })
  })
})
