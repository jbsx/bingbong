import { describe, expect, it } from 'vitest'

// The vision records at their call sites (#186, ADR 0031): a Look, a
// ground_visual Locate and the auto-vision Describe each record what they
// asked and how it settled, with the ids the ToolContext had — so the
// same request lands in the Run Trace inside a Run and in the Host Trace
// outside one, decided by identity rather than by which tool it was.

import type { PageSnapshot } from '../browser/snapshot'
import { VisionDeadlineError } from '../ports/vision'
import { FakeBrowser, FakeClock, FakeVision } from '../testing/doubles'
import type { ToolCall } from '../ports/llm'
import type { VisionTraceEvent, VisionTraceIds } from '../trace/visionTrace'
import { createBrowserTools } from './browserTools'
import type { Tool, ToolContext } from './tool'
import { createLookTool, createVisionGroundingTools } from './visionGroundingTools'

const viewport = { width: 800, height: 600, scrollY: 0, scrollHeight: 600 }
const emptySnapshot: PageSnapshot = {
  url: 'https://fixture.test/',
  title: 'Fixture',
  viewport,
  dialogOpen: false,
  dialogText: '',
  textDigest: '',
  refs: [],
  totalVisible: 0,
  truncated: false,
}

interface Reported {
  event: VisionTraceEvent
  ids?: VisionTraceIds
}

function context(overrides: Partial<ToolContext> = {}): { ctx: ToolContext; reported: Reported[] } {
  const reported: Reported[] = []
  const clock = new FakeClock()
  const ctx: ToolContext = {
    clock,
    acquireVision: () => ({ ok: true }),
    traceVision: (event, ids) => reported.push({ event, ...(ids !== undefined ? { ids } : {}) }),
    ...overrides,
  }
  return { ctx, reported }
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: 'c1', name, args })

function tool(tools: Tool[], name: string): Tool {
  const found = tools.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`no ${name} tool`)
  return found
}

describe('look records', () => {
  it('records the request, its answer and the turn it happened in', async () => {
    const browser = new FakeBrowser()
    const vision = new FakeVision()
    vision.description = 'A cookie banner covers the page.'
    const { ctx, reported } = context({ turnId: 'turn-3' })

    await createLookTool(browser, vision).execute(call('look'), ctx)

    expect(reported).toEqual([
      {
        event: {
          kind: 'vision_request',
          capability: 'describe',
          reason: 'look',
          durationMs: 0,
          outcome: 'ok',
          answer: 'A cookie banner covers the page.',
          answerChars: 32,
        },
        ids: { turnId: 'turn-3' },
      },
    ])
  })

  it('records a missed Vision Deadline as a deadline, not a plain error, and rethrows', async () => {
    const vision = new FakeVision()
    vision.failWith = new VisionDeadlineError(8_000, 'first-token')
    const { ctx, reported } = context({ turnId: 'turn-3' })

    await expect(createLookTool(new FakeBrowser(), vision).execute(call('look'), ctx)).rejects.toThrow(VisionDeadlineError)

    expect(reported[0]?.event).toMatchObject({
      kind: 'vision_request',
      reason: 'look',
      outcome: 'deadline',
      message: expect.stringContaining('8000ms'),
    })
  })

  it('records an adapter failure as an error', async () => {
    const vision = new FakeVision()
    vision.failWith = new Error('Vision request failed (HTTP 502)')
    const { ctx, reported } = context({ turnId: 'turn-3' })

    await expect(createLookTool(new FakeBrowser(), vision).execute(call('look'), ctx)).rejects.toThrow('502')

    expect(reported[0]?.event).toMatchObject({ outcome: 'error', message: 'Vision request failed (HTTP 502)' })
  })

  it('names no turn outside a Run, so the record lands in the Host Trace', async () => {
    const { ctx, reported } = context()
    await createLookTool(new FakeBrowser(), new FakeVision()).execute(call('look'), ctx)
    expect(reported[0]?.ids).toEqual({})
  })

  it('records nothing at all when neither family is on', async () => {
    const { ctx, reported } = context({ traceVision: undefined, turnId: 'turn-3' })
    await createLookTool(new FakeBrowser(), new FakeVision()).execute(call('look'), ctx)
    expect(reported).toEqual([])
  })

  it('stamps the delegated worker whose Look it was', async () => {
    const { ctx, reported } = context({ turnId: 'turn-3', agentId: 'a-2' })
    await createLookTool(new FakeBrowser(), new FakeVision()).execute(call('look'), ctx)
    expect(reported[0]?.event).toMatchObject({ agentId: 'a-2' })
  })
})

describe('ground_visual records', () => {
  function groundingTools(): { tools: Tool[]; browser: FakeBrowser; vision: FakeVision } {
    const browser = new FakeBrowser()
    browser.snapshot = emptySnapshot
    browser.screenshotBytes = new Uint8Array([4, 5, 6])
    browser.pointRef = 23
    const vision = new FakeVision()
    vision.location = { x: 340, y: 220 }
    return { tools: createVisionGroundingTools(browser, vision), browser, vision }
  }

  it('records the budget grant and the Locate request, with the target it was given', async () => {
    const { tools } = groundingTools()
    const { ctx, reported } = context({ turnId: 'turn-3' })

    await tool(tools, 'ground_visual').execute(call('ground_visual', { target: 'the play button' }), ctx)

    expect(reported.map((entry) => entry.event)).toEqual([
      { kind: 'vision_budget', reason: 'ground_visual', granted: true },
      {
        kind: 'vision_request',
        capability: 'locate',
        reason: 'ground_visual',
        target: 'the play button',
        durationMs: 0,
        outcome: 'ok',
        answer: '340,220',
        answerChars: 7,
      },
    ])
  })

  it('records a budget refusal with the reason the model was given, and makes no request', async () => {
    const { tools } = groundingTools()
    const { ctx, reported } = context({
      turnId: 'turn-3',
      acquireVision: () => ({ ok: false, reason: 'vision call limit (3) reached for this run' }),
    })

    await expect(
      tool(tools, 'ground_visual').execute(call('ground_visual', { target: 'the play button' }), ctx),
    ).rejects.toThrow('vision call limit')

    expect(reported.map((entry) => entry.event)).toEqual([
      {
        kind: 'vision_budget',
        reason: 'ground_visual',
        granted: false,
        refusal: 'vision call limit (3) reached for this run',
      },
    ])
  })

  it('records nothing for a target the DOM resolved on its own', async () => {
    const browser = new FakeBrowser()
    browser.snapshot = {
      ...emptySnapshot,
      totalVisible: 1,
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
    }
    const tools = createVisionGroundingTools(browser, new FakeVision())
    const { ctx, reported } = context({ turnId: 'turn-3' })

    await tool(tools, 'ground_visual').execute(call('ground_visual', { target: 'play video button' }), ctx)

    expect(reported).toEqual([])
  })
})

describe('auto-vision records', () => {
  it('records the Look the pipeline fired itself, with the advisory cap it waited', async () => {
    const browser = new FakeBrowser()
    browser.click = async () => {
      throw new Error('ref 4 not found — the page may have changed, run read_page to refresh refs')
    }
    const vision = new FakeVision()
    vision.description = 'A consent dialog is open.'
    const tools = createBrowserTools(browser, vision)
    const { ctx, reported } = context({ turnId: 'turn-3' })

    // The stale-ref path rethrows with the auto-vision note attached; the
    // records are written either way, which is what this pins.
    await expect(tool(tools, 'click').execute(call('click', { ref: 4 }), ctx)).rejects.toThrow('Auto-vision (stale ref)')

    expect(reported.map((entry) => entry.event)).toEqual([
      { kind: 'vision_budget', reason: 'auto_vision', granted: true },
      {
        kind: 'vision_request',
        capability: 'describe',
        reason: 'auto_vision',
        capMs: 6_000,
        durationMs: 0,
        outcome: 'ok',
        answer: 'A consent dialog is open.',
        answerChars: 25,
      },
    ])
  })
})
