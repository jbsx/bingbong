import type { SnapshotRef } from '../browser/snapshot'
import type { BrowserController, VisualGroundingController } from '../ports/browser'
import type { VisionDescriber, VisionModel } from '../ports/vision'
import type { ToolCall } from '../ports/llm'
import type { Tool, ToolContext } from './tool'
import { tracedVisionRequest } from '../trace/visionTrace'
import { traceVisionBudget, visionSeam } from './visionSeam'

const IGNORED_WORDS = new Set(['a', 'an', 'the', 'on', 'in', 'at', 'of'])
const LOOK_PROMPT =
  'Describe the current browser page. Focus on page state, popups, dialogs, overlays, consent prompts, errors, and anything that could block the requested task.'
const QUESTIONED_LOOK_PREAMBLE =
  'Answer only from the screenshot. Transcribe text exactly as it appears. Say "not legible" for anything you cannot read rather than guessing.'
const QUESTIONED_LOOK_MAX_TOKENS = 512

function targetArg(call: ToolCall): string {
  const value = call.args.target
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error("ground_visual: 'target' must be a non-empty string")
  }
  return value.trim()
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '' && !IGNORED_WORDS.has(word))
}

function domMatch(target: string, refs: SnapshotRef[]): SnapshotRef | undefined {
  const wanted = words(target)
  const matches = refs.filter((ref) => {
    const available = new Set(words(`${ref.label} ${ref.kind}`))
    return wanted.length > 0 && wanted.every((word) => available.has(word))
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function createLookTool(browser: BrowserController, vision: VisionDescriber): Tool {
  return {
    name: 'look',
    usesVision: true,
    acquisition: true,
    description:
      'Inspect a screenshot of the current browser page and return visible page state. Ask a question when you need to read text, tables, chart labels, or image content.',
    parameters: {
      question: { type: 'string', required: false, description: 'A specific question to answer from the screenshot.' },
    },
    async execute(call, context: ToolContext) {
      const rawQuestion = call.args.question
      const question = typeof rawQuestion === 'string' && rawQuestion.trim() !== '' ? rawQuestion.trim() : undefined
      // The Look's own record (#186): the Vision Budget was already spent
      // by the round (`usesVision`), so this covers the request alone.
      return tracedVisionRequest(
        visionSeam(context),
        { capability: 'describe', reason: 'look', ...(question !== undefined ? { question } : {}) },
        async () =>
          vision.describe({
            image: await browser.screenshot(),
            prompt: question === undefined ? LOOK_PROMPT : `${QUESTIONED_LOOK_PREAMBLE}\n\nQuestion: ${question}`,
            ...(question !== undefined ? { maxTokens: QUESTIONED_LOOK_MAX_TOKENS } : {}),
          }),
        (answer) => answer,
      )
    },
  }
}

export function createVisionGroundingTools(browser: BrowserController & VisualGroundingController, vision: VisionModel): Tool[] {
  return [
    {
      name: 'ground_visual',
      acquisition: true,
      description:
        'Resolve a visually described target and return a numbered ref, not readable text. It performs its own fresh DOM grounding without requiring read_page, then calls vision only when the DOM cannot identify one target. Use look with a question to read what is on screen.',
      parameters: {
        target: { type: 'string', description: 'Visual description, e.g. "the red play button in the thumbnail"' },
      },
      async execute(call, context) {
        const target = targetArg(call)
        const snapshot = await browser.groundingSnapshot()
        const matched = domMatch(target, snapshot.refs)
        if (matched) return `DOM match: use ref ${matched.ref}`

        const grant = context.acquireVision?.()
        traceVisionBudget(context, 'ground_visual', grant)
        if (!grant) throw new Error('vision budget is unavailable')
        if (!grant.ok) throw new Error(grant.reason)
        const location = await tracedVisionRequest(
          visionSeam(context),
          { capability: 'locate', reason: 'ground_visual', target },
          async () =>
            vision.locate({
              image: await browser.screenshot(),
              target,
              viewport: snapshot.viewport,
            }),
          (point) => `${point.x},${point.y}`,
        )
        const ref = await browser.refAtPoint(location)
        return `Vision match: use ref ${ref}`
      },
    },
    createLookTool(browser, vision),
  ]
}
