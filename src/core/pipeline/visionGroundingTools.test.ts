import { describe, expect, it } from 'vitest'
import type { PageSnapshot } from '../browser/snapshot'
import type { VisionModel } from '../ports/vision'
import { FakeBrowser, FakeClock, FakeVision, RecordingTts, ScriptedLlm } from '../testing/doubles'
import { createCommandPipeline } from './createCommandPipeline'
import { createBrowserTools } from './browserTools'
import type { PipelineEvent } from './events'
import type { ToolTraceEvent } from '../trace/visionTrace'
import { createVisionGroundingTools } from './visionGroundingTools'

const snapshot: PageSnapshot = {
  url: 'https://fixture.test/',
  title: 'Fixture',
  viewport: { width: 800, height: 600, scrollY: 0, scrollHeight: 600 },
  dialogOpen: false,
  dialogText: '',
  textDigest: '',
  textBlocks: [],
  textLength: 0,
  textCut: false,
  viewportText: [],
  refs: [
    {
      ref: 1,
      kind: 'button',
      label: 'Play video',
      inputType: null,
      rect: { x: 300, y: 200, width: 80, height: 40 },
      src: null,
      href: null,
      downloadsFile: false,
      submitsForm: false,
      credentialField: false,
      paymentField: false,
      inForm: false,
      formHasCredential: false,
      formHasPayment: false,
      searchField: false,
      formHasSearch: false,
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
  it('describes its fresh DOM grounding with no read_page prerequisite', () => {
    const description = createVisionGroundingTools(new FakeBrowser(), new FakeVision())[0].description

    expect(description).toMatch(/fresh DOM grounding/i)
    expect(description).toMatch(/without requiring read_page/i)
  })

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

  it('answers a question from the screenshot with a larger response cap', async () => {
    const browser = new FakeBrowser()
    browser.screenshotBytes = new Uint8Array([7, 8, 9])
    const vision = new FakeVision()
    vision.descriptions = ['Solo Leveling, Omniscient Reader.']
    const tools = createVisionGroundingTools(browser, vision)
    const look = tools.find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')

    await look.execute(
      { id: 'l1', name: 'look', args: { question: 'Which titles are in the top row?' } },
      { clock: new FakeClock() },
    )

    expect(look.parameters?.question).toMatchObject({ type: 'string', required: false })
    expect(look.description).toMatch(/text|tables|chart labels|image content/i)
    expect(vision.describeRequests).toEqual([
      {
        image: new Uint8Array([7, 8, 9]),
        prompt: expect.stringMatching(
          /answer only from the screenshot[\s\S]*transcribe text exactly as it appears[\s\S]*say "not legible"[\s\S]*Which titles are in the top row\?/i,
        ),
        maxTokens: 512,
      },
    ])
  })

  it('magnifies a requested region of the viewport for a questioned Look (#195)', async () => {
    const browser = new FakeBrowser()
    browser.screenshotBytes = new Uint8Array([7, 8, 9])
    const vision = new FakeVision()
    vision.descriptions = ['Solo Leveling, Omniscient Reader.']
    const trace: ToolTraceEvent[] = []
    const tools = createVisionGroundingTools(browser, vision)
    const look = tools.find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')

    const answer = await look.execute(
      { id: 'l1', name: 'look', args: { question: 'Which titles are in the S tier row?', region: '0, 0, 100, 20' } },
      { clock: new FakeClock(), traceVision: (event) => trace.push(event) },
    )

    // The answer ends with the region and the zoom it got, and — below the
    // cap — that a smaller region is magnified more; the trace keeps the
    // vision answer alone.
    expect(answer).toBe(
      'Solo Leveling, Omniscient Reader.\n\n[region 0,0,100,20 shown at 3x; a smaller region is magnified more, up to 4x]',
    )
    expect(look.parameters?.region).toMatchObject({ type: 'string', required: false })
    expect(look.parameters?.region?.description).toMatch(/left,top,width,height/)
    expect(look.description).toMatch(/region/i)
    expect(browser.screenshotRequests).toEqual([{ region: { left: 0, top: 0, width: 1, height: 0.2 }, scale: 3 }])
    expect(vision.describeRequests).toEqual([
      {
        image: new Uint8Array([7, 8, 9]),
        prompt: expect.stringMatching(
          /^Answer only from the screenshot[\s\S]*say "not legible"[\s\S]*magnified[\s\S]*0% to 100%[\s\S]*0% to 20%[\s\S]*3x[\s\S]*Question: Which titles are in the S tier row\?$/i,
        ),
        maxTokens: 512,
      },
    ])
    expect(trace).toEqual([
      expect.objectContaining({
        kind: 'vision_request',
        capability: 'describe',
        reason: 'look',
        question: 'Which titles are in the S tier row?',
        region: '0,0,100,20',
        regionShown: '0,0,100,20',
        scale: 3,
        outcome: 'ok',
        answer: 'Solo Leveling, Omniscient Reader.',
      }),
    ])
  })

  it('tells the model a larger region is shrunk to a quarter, after the cap (#236)', () => {
    const look = createVisionGroundingTools(new FakeBrowser(), new FakeVision()).find((candidate) => candidate.name === 'look')
    expect(look?.parameters?.region?.description).toMatch(
      /At most a quarter of the viewport — a larger region is shrunk around its centre to a quarter; smaller regions are magnified more/,
    )
  })

  it('shows an oversize region shrunk around its centre, naming the clamp to the orchestrator alone (#236)', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.descriptions = ['Watch 42mm, Titanium.']
    const trace: ToolTraceEvent[] = []
    const look = createVisionGroundingTools(browser, vision).find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')

    const answer = await look.execute(
      { id: 'l1', name: 'look', args: { question: 'What does the spec row say?', region: '0,55,100,30' } },
      { clock: new FakeClock(), traceVision: (event) => trace.push(event) },
    )

    expect(answer).toBe(
      'Watch 42mm, Titanium.\n\n[region 0,55,100,30 clamped to 5,57,91,27 (at most a quarter of the viewport) shown at 3x; a smaller region is magnified more, up to 4x]',
    )
    expect(browser.screenshotRequests).toEqual([{ region: { left: 0.05, top: 0.57, width: 0.91, height: 0.27 }, scale: 3 }])
    // The vision model is told the crop it is looking at, and nothing of
    // what was asked.
    const prompt = vision.describeRequests[0]?.prompt ?? ''
    expect(prompt).toContain('from 5% to 96% of the viewport width and from 57% to 84% of its height, shown at 3x')
    expect(prompt).not.toMatch(/clamp|0,55,100,30|quarter/)
    expect(trace).toEqual([
      expect.objectContaining({ kind: 'vision_request', region: '0,55,100,30', regionShown: '5,57,91,27', scale: 3 }),
    ])
  })

  it('names a region clipped to the viewport as the part inside it (#236)', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.descriptions = ['Checkout.']
    const look = createVisionGroundingTools(browser, vision).find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')

    const answer = await look.execute(
      { id: 'l1', name: 'look', args: { question: 'What is the button label?', region: '50,50,100,100' } },
      { clock: new FakeClock() },
    )

    expect(answer).toBe(
      'Checkout.\n\n[region 50,50,100,100 clamped to 50,50,50,50 (the part inside the viewport) shown at 3x; a smaller region is magnified more, up to 4x]',
    )
    expect(browser.screenshotRequests).toEqual([{ region: { left: 0.5, top: 0.5, width: 0.5, height: 0.5 }, scale: 3 }])
  })

  it('admits a Look unless its region names no place or has no question to answer (#236, ADR 0046)', () => {
    const look = createVisionGroundingTools(new FakeBrowser(), new FakeVision()).find((candidate) => candidate.name === 'look')
    if (!look?.admit) throw new Error('look declares no admission step')

    expect(look.admit({})).toEqual({ ok: true })
    expect(look.admit({ question: 'What is on screen?' })).toEqual({ ok: true })
    expect(look.admit({ question: 'What is on screen?', region: '0,0,100,100' })).toEqual({ ok: true })
    expect(look.admit({ region: '0,0,100,20' })).toEqual({ ok: false, reason: expect.stringMatching(/needs a 'question'/) })
    expect(look.admit({ question: 'What is on screen?', region: 'top' })).toEqual({
      ok: false,
      reason: expect.stringMatching(/left,top,width,height/),
    })
    expect(look.admit({ question: 'What is on screen?', region: '100,0,20,20' })).toEqual({
      ok: false,
      reason: expect.stringMatching(/left,top,width,height/),
    })
  })

  it("keeps what the adapter observed on the Look's own record, and records nothing when nothing traces (#204)", async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.descriptions = ['A cookie banner covers the page.', 'A cookie banner covers the page.']
    vision.observation = {
      ending: 'answered',
      firstTokenLimitMs: 8_000,
      wholeLookLimitMs: 15_000,
      model: 'GLM-4.6V',
      maxTokens: 128,
      thinking: 'disabled',
      responseAtMs: 180,
      responseStatus: 200,
      firstByteAtMs: 240,
      firstContentAtMs: 260,
      firstTokenKind: 'content',
      streamEndAtMs: 900,
      settledAtMs: 901,
      bytesRead: 512,
      streamEvents: 6,
      progressEvents: 5,
      malformedEvents: 0,
      sawDone: true,
      reasoningChars: 0,
      contentChars: 32,
    }
    const trace: ToolTraceEvent[] = []
    const look = createVisionGroundingTools(browser, vision).find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')

    await look.execute(
      { id: 'l1', name: 'look', args: {} },
      { clock: new FakeClock(), traceVision: (event) => trace.push(event) },
    )

    expect(trace).toEqual([expect.objectContaining({ kind: 'vision_request', outcome: 'ok', attempt: vision.observation })])

    // The same Look with nothing tracing: the answer is identical and no
    // record exists at all — diagnostics stay opt-in (ADR 0031).
    const answer = await look.execute({ id: 'l2', name: 'look', args: {} }, { clock: new FakeClock() })
    expect(answer).toBe('A cookie banner covers the page.')
    expect(trace).toHaveLength(1)
  })

  it('states a region at the zoom cap without inviting a smaller one (#195)', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.descriptions = ['The Boxer, The Greatest E.']
    const look = createVisionGroundingTools(browser, vision).find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')

    const answer = await look.execute(
      { id: 'l1', name: 'look', args: { question: 'Which titles are in the S tier row?', region: '26,0,20,10' } },
      { clock: new FakeClock() },
    )

    expect(browser.screenshotRequests[0]?.scale).toBe(4)
    expect(answer).toBe('The Boxer, The Greatest E.\n\n[region 26,0,20,10 shown at 4x]')
  })

  it('refuses a region without a question, and a malformed region, before any capture (#195)', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    const look = createVisionGroundingTools(browser, vision).find((candidate) => candidate.name === 'look')
    if (!look) throw new Error('look tool is missing')
    const context = { clock: new FakeClock() }

    await expect(look.execute({ id: 'l1', name: 'look', args: { region: '0,0,100,20' } }, context)).rejects.toThrow(
      /question/,
    )
    await expect(
      look.execute({ id: 'l2', name: 'look', args: { question: 'What is in the top row?', region: 'top' } }, context),
    ).rejects.toThrow(/left,top,width,height/)

    expect(browser.screenshotCalls).toBe(0)
    expect(vision.describeRequests).toEqual([])
  })

  it('charges questioned and unasked Looks equally to the Vision Budget', async () => {
    const vision = new FakeVision()
    vision.descriptions = ['Page state.', 'Top-row titles.']
    const trace: ToolTraceEvent[] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            { id: 'l1', name: 'look', args: {} },
            { id: 'l2', name: 'look', args: { question: 'Which titles are in the top row?' } },
          ],
        },
        { kind: 'answer', speak: 'Seen.', display: 'Seen.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: createVisionGroundingTools(new FakeBrowser(), vision),
      traceVision: (event) => trace.push(event),
    })

    for await (const event of pipeline.execute('inspect the page')) void event

    expect(trace.filter((event) => event.kind === 'vision_budget')).toEqual([
      { kind: 'vision_budget', reason: 'look', granted: true },
      { kind: 'vision_budget', reason: 'look', granted: true },
    ])
    expect(vision.describeRequests).toHaveLength(2)
  })

  it('describes Locate as returning a ref rather than readable text', () => {
    const tools = createVisionGroundingTools(new FakeBrowser(), new FakeVision())
    const grounding = tools.find((candidate) => candidate.name === 'ground_visual')

    expect(grounding?.description).toMatch(/returns?.*ref|return.*ref/i)
    expect(grounding?.description).toMatch(/look.*question/i)
  })
})
