import type { SnapshotRef } from '../browser/snapshot'
import type { BrowserController, VisualGroundingController } from '../ports/browser'
import type { VisionDescriber, VisionModel } from '../ports/vision'
import type { ToolCall } from '../ports/llm'
import type { Tool, ToolContext } from './tool'
import { tracedVisionRequest } from '../trace/visionTrace'
import {
  formatLookRegion,
  LOOK_REGION_FORMAT,
  LOOK_REGION_MAX_ZOOM,
  lookRegionZoom,
  parseLookRegion,
  viewportRegionOf,
  type LookRegion,
} from './lookRegion'
import { traceVisionBudget, visionSeam } from './visionSeam'

const IGNORED_WORDS = new Set(['a', 'an', 'the', 'on', 'in', 'at', 'of'])
const LOOK_PROMPT =
  'Describe the current browser page. Focus on page state, popups, dialogs, overlays, consent prompts, errors, and anything that could block the requested task.'
const QUESTIONED_LOOK_PREAMBLE =
  'Answer only from the screenshot. Transcribe text exactly as it appears. Say "not legible" for anything you cannot read rather than guessing.'
const QUESTIONED_LOOK_MAX_TOKENS = 512

/** What a region Look (#195) tells the model about the crop it is answering from, after the fixed preamble. */
function regionPrompt(question: string, region: LookRegion, zoom: number): string {
  const crop = `The screenshot is a magnified crop of the page: from ${region.left}% to ${region.left + region.width}% of the viewport width and from ${region.top}% to ${region.top + region.height}% of its height, shown at ${zoom}x.`
  return `${QUESTIONED_LOOK_PREAMBLE}\n\n${crop}\n\nQuestion: ${question}`
}

/**
 * The one line a region Look's result ends with (#195): the region and the
 * magnification it got, and — while there is magnification left — that a
 * smaller region gets more. The #195 recapture chose bands of half the
 * viewport and more, which magnify 2x and read wrong; the probe read the
 * same row correctly at 3x. The model cannot know the zoom it got unless
 * told, and this is the moment it decides whether to narrow.
 */
function regionFooter(region: LookRegion, zoom: number): string {
  const more = zoom < LOOK_REGION_MAX_ZOOM ? `; a smaller region is magnified more, up to ${LOOK_REGION_MAX_ZOOM}x` : ''
  return `[region ${formatLookRegion(region)} shown at ${zoom}x${more}]`
}

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
      'Inspect a screenshot of the current browser page and return visible page state. Ask a question when you need to read text, tables, chart labels, or image content. Add a region to magnify one part of the page when text was not legible in the full screenshot.',
    parameters: {
      question: { type: 'string', required: false, description: 'A specific question to answer from the screenshot.' },
      region: {
        type: 'string',
        required: false,
        description: `With a question: crop the screenshot to this part of the viewport and magnify it before answering — ${LOOK_REGION_FORMAT}. At most a quarter of the viewport; smaller regions are magnified more — a quarter gets 3x, a third by a third or less gets 4x. Aim at the target, not the whole area around it.`,
      },
    },
    async execute(call, context: ToolContext) {
      const rawQuestion = call.args.question
      const question = typeof rawQuestion === 'string' && rawQuestion.trim() !== '' ? rawQuestion.trim() : undefined
      const region = parseLookRegion(call.args.region)
      if (region !== undefined && question === undefined) {
        throw new Error("look: 'region' needs a 'question' to answer about that part of the page")
      }
      const crop = region === undefined ? undefined : { region, zoom: lookRegionZoom(region) }
      // The Look's own record (#186): the Vision Budget was already spent
      // by the round (`usesVision`), so this covers the request alone. A
      // region Look (#195) is the same one Look, bounded and magnified —
      // the record keeps the region as the model wrote it and the zoom.
      const answer = await tracedVisionRequest(
        visionSeam(context),
        {
          capability: 'describe',
          reason: 'look',
          ...(question !== undefined ? { question } : {}),
          ...(crop !== undefined ? { region: formatLookRegion(crop.region), zoom: crop.zoom } : {}),
        },
        async () =>
          vision.describe({
            image: await browser.screenshot(
              crop === undefined ? undefined : { region: viewportRegionOf(crop.region), scale: crop.zoom },
            ),
            prompt:
              question === undefined
                ? LOOK_PROMPT
                : crop === undefined
                  ? `${QUESTIONED_LOOK_PREAMBLE}\n\nQuestion: ${question}`
                  : regionPrompt(question, crop.region, crop.zoom),
            ...(question !== undefined ? { maxTokens: QUESTIONED_LOOK_MAX_TOKENS } : {}),
          }),
        (answer) => answer,
      )
      return crop === undefined ? answer : `${answer}\n\n${regionFooter(crop.region, crop.zoom)}`
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
