import type { SnapshotRef } from '../browser/snapshot'
import type { BrowserController, VisualGroundingController } from '../ports/browser'
import type { VisionDescriber, VisionModel } from '../ports/vision'
import type { ToolCall } from '../ports/llm'
import type { Tool, ToolContext } from './tool'
import { tracedVisionRequest } from '../trace/visionTrace'
import {
  formatLookRegion,
  LOOK_REGION_FORMAT,
  LOOK_REGION_MAX_SCALE,
  readLookRegion,
  screenshotOptionsOf,
  type LookCrop,
  type LookRegionClamp,
  type LookRegionReading,
} from './lookRegion'
import { traceVisionBudget, visionSeam } from './visionSeam'

const IGNORED_WORDS = new Set(['a', 'an', 'the', 'on', 'in', 'at', 'of'])
const LOOK_PROMPT =
  'Describe the current browser page. Focus on page state, popups, dialogs, overlays, consent prompts, errors, and anything that could block the requested task.'
const QUESTIONED_LOOK_PREAMBLE =
  'Answer only from the screenshot. Transcribe text exactly as it appears. Say "not legible" for anything you cannot read rather than guessing.'
const QUESTIONED_LOOK_MAX_TOKENS = 512

/**
 * The questioned Look's prompt (#193): the fixed anti-guessing preamble
 * verbatim, then the question. A region Look (#195) states the crop it is
 * answering from between the two, so the preamble never changes.
 */
function questionedPrompt(question: string, crop: LookCrop | undefined): string {
  const lines = [QUESTIONED_LOOK_PREAMBLE]
  if (crop !== undefined) {
    const { region, scale } = crop
    lines.push(
      `The screenshot is a magnified crop of the page: from ${region.left}% to ${region.left + region.width}% of the viewport width and from ${region.top}% to ${region.top + region.height}% of its height, shown at ${scale}x.`,
    )
  }
  lines.push(`Question: ${question}`)
  return lines.join('\n\n')
}

const REGION_NEEDS_QUESTION = "look: 'region' needs a 'question' to answer about that part of the page"

/** A region Look's region: as the model wrote it, how the crop differs, and the crop it is shown. */
type AskedLookRegion = Extract<LookRegionReading, { kind: 'region' }>

/** `look`'s arguments as read, or the refusal they earn. */
type LookArgs = { ok: true; question: string | undefined; region: AskedLookRegion | undefined } | { ok: false; reason: string }

/**
 * Reads `look`'s arguments — the one reader its admission step and its
 * execute share (#236, ADR 0046), so the round refuses exactly what the
 * tool would, ahead of the charge instead of inside the attempt.
 */
function readLookArgs(args: ToolCall['args']): LookArgs {
  const rawQuestion = args.question
  const question = typeof rawQuestion === 'string' && rawQuestion.trim() !== '' ? rawQuestion.trim() : undefined
  const region = readLookRegion(args.region)
  if (region.kind === 'refused') return { ok: false, reason: region.reason }
  if (region.kind === 'none') return { ok: true, question, region: undefined }
  if (question === undefined) return { ok: false, reason: REGION_NEEDS_QUESTION }
  return { ok: true, question, region }
}

/** Why a clamped region was shown as something else, as the footer names it. */
const CLAMP_REASON: Record<Exclude<LookRegionClamp, 'none'>, string> = {
  clipped: 'the part inside the viewport',
  shrunk: 'at most a quarter of the viewport',
}

/**
 * The one line a region Look's result ends with (#195): the region and the
 * magnification it got, and — while there is magnification left — that a
 * smaller region gets more. The #195 recapture chose bands of half the
 * viewport and more, which magnify 2x and read wrong; the probe read the
 * same row correctly at 3x. The model cannot know the scale it got unless
 * told, and this is the moment it decides whether to narrow. A clamped
 * region (#236, ADR 0046) is named as written and as shown, here only:
 * the vision model has no use for what was asked.
 */
function regionFooter(region: AskedLookRegion): string {
  const { crop } = region
  const more = crop.scale < LOOK_REGION_MAX_SCALE ? `; a smaller region is magnified more, up to ${LOOK_REGION_MAX_SCALE}x` : ''
  const named =
    region.clamp === 'none'
      ? formatLookRegion(crop.region)
      : `${formatLookRegion(region.written)} clamped to ${formatLookRegion(crop.region)} (${CLAMP_REASON[region.clamp]})`
  return `[region ${named} shown at ${crop.scale}x${more}]`
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
        description: `With a question: crop the screenshot to this part of the viewport and magnify it before answering — ${LOOK_REGION_FORMAT}. At most a quarter of the viewport — a larger region is shrunk around its centre to a quarter; smaller regions are magnified more — a quarter gets 3x, a third by a third or less gets 4x. Aim at the target, not the whole area around it.`,
      },
    },
    // The two refusals a Look still makes (#236, ADR 0046), ahead of the
    // Vision Budget and the attempted mark: a malformed region is our
    // sentence, not a failed Vision Attempt.
    admit(args) {
      const read = readLookArgs(args)
      return read.ok ? { ok: true } : read
    },
    async execute(call, context: ToolContext) {
      const read = readLookArgs(call.args)
      if (!read.ok) throw new Error(read.reason)
      const { question, region } = read
      const crop = region?.crop
      // The Look's own record (#186): the Vision Budget was already spent
      // by the round (`usesVision`), so this covers the request alone. A
      // region Look (#195) is the same one Look, bounded and magnified —
      // the record keeps the region as the model wrote it, the region it
      // was shown (#236) and the scale.
      const answer = await tracedVisionRequest(
        visionSeam(context),
        {
          capability: 'describe',
          reason: 'look',
          ...(question !== undefined ? { question } : {}),
          ...(region !== undefined
            ? {
                region: formatLookRegion(region.written),
                regionShown: formatLookRegion(region.crop.region),
                scale: region.crop.scale,
              }
            : {}),
        },
        async (observe) =>
          vision.describe({
            image: await browser.screenshot(crop === undefined ? undefined : screenshotOptionsOf(crop)),
            prompt: question === undefined ? LOOK_PROMPT : questionedPrompt(question, crop),
            ...(question !== undefined ? { maxTokens: QUESTIONED_LOOK_MAX_TOKENS } : {}),
            observe,
          }),
        (answer) => answer,
      )
      return region === undefined ? answer : `${answer}\n\n${regionFooter(region)}`
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
        if (matched) {
          // The grounding collect is not a page read: this one number is
          // all the model is shown of it, so this one number is what the
          // shown registry records (ADR 0033).
          await browser.showRef(matched.ref)
          return `DOM match: use ref ${matched.ref}`
        }

        const grant = context.acquireVision?.()
        traceVisionBudget(context, 'ground_visual', grant)
        if (!grant) throw new Error('vision budget is unavailable')
        if (!grant.ok) throw new Error(grant.reason)
        const location = await tracedVisionRequest(
          visionSeam(context),
          { capability: 'locate', reason: 'ground_visual', target },
          async (observe) =>
            vision.locate({
              image: await browser.screenshot(),
              target,
              viewport: snapshot.viewport,
              observe,
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
