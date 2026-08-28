import type { RiskVerdict, Tool, ToolContext } from './tool'
import type { ToolCall } from '../ports/llm'
import type { BrowserController } from '../ports/browser'
import type { VisionDescriber } from '../ports/vision'
import { AUTO_VISION_DESCRIBE_MS } from '../ports/vision'
import { assessBrowserAction } from './riskGate'
import { classifyBlockerPage, type BlockerClassification } from '../browser/blockerNudge'

const STALE_REF_RE = /ref \d+ not found.*page may have changed/i
const AUTO_VISION_PROMPT =
  'Describe the current browser screenshot, focusing on page state, popups, dialogs, overlays, errors, and anything blocking the requested task.'

/**
 * Per-run auto-vision cooldown (#106, ADR 0016): after any auto-vision
 * attempt, this window suppresses the next ones in the same run — during a
 * slow vision patch, repeated no-change clicks and near-duplicate reads
 * skip the vision wait instead of each burning a fresh one.
 */
export const AUTO_VISION_COOLDOWN_MS = 60_000

// ADR 0010: when a choke point detects a wall, the tool result the model
// sees carries the machine-readable marker line plus the flavored nudge.
// The marker is what the Blocker gate (same ADR) consumes; the nudge names
// what would actually help. Advisory only — never performs or orders any
// page action.
function blockerSuffix(verdict: BlockerClassification): string {
  return `${verdict.marker}\n${verdict.nudge}`
}

// ADR 0007 layer 3 / ADR 0010 choke point 1: after a navigation settles,
// classify the landing; a walled page gets the marker + nudge appended to
// the tool result. Since rich Action Outcomes (#113) the navigation verbs
// collect a fresh snapshot, so the classifier sees the full page facts —
// digest, dialog, and refs, like read_page — not just URL and title. A
// facts failure (the outcome may have degraded to its concise line) falls
// back to the URL/title classification.
async function withBlockerNudge(browser: BrowserController, action: () => Promise<string>): Promise<string> {
  const outcome = await action()
  let verdict: BlockerClassification | null = null
  try {
    verdict = classifyBlockerPage(await browser.pageFacts())
  } catch {
    const { url, title } = browser.state()
    verdict = classifyBlockerPage({ url: url ?? '', title: title ?? '' })
  }
  return verdict ? `${outcome}\n${blockerSuffix(verdict)}` : outcome
}

interface ReadState {
  refs: Set<number>
}

function refsFrom(result: string): Set<number> {
  return new Set([...result.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1])))
}

function similarity(left: Set<number>, right: Set<number>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 1
  let shared = 0
  for (const ref of left) if (right.has(ref)) shared += 1
  return shared / union.size
}

type AutoVision = (context: ToolContext, reason: string) => Promise<string>

async function autoDescribe(
  browser: BrowserController,
  vision: VisionDescriber,
  context: ToolContext,
  reason: string,
  cooldownUntil: WeakMap<ToolContext, number>,
): Promise<string> {
  const until = cooldownUntil.get(context)
  if (until !== undefined && context.clock.now() < until) {
    return `Auto-vision (${reason}) skipped: vision is cooling down after a recent attempt`
  }
  const grant = context.acquireVision?.()
  if (!grant) return 'Auto-vision refused: vision budget is unavailable'
  if (!grant.ok) return `Auto-vision refused: ${grant.reason}`
  try {
    const description = await vision.describe({
      image: await browser.screenshot(),
      prompt: `${AUTO_VISION_PROMPT}\nTrigger: ${reason}.`,
      // Advisory budget (#106, ADR 0016): auto-vision waits less than a
      // model-requested Look; the adapter clamps this against the Look cap.
      lookCapMs: AUTO_VISION_DESCRIBE_MS,
    })
    return `Auto-vision (${reason}): ${description}`
  } catch (error) {
    // Advisory (#106): a missed Vision Deadline (or any failure) stays a
    // one-line note — never the Look nudge, never an error of its own.
    const message = error instanceof Error ? error.message : String(error)
    return `Auto-vision failed (${reason}): ${message}`
  } finally {
    cooldownUntil.set(context, context.clock.now() + AUTO_VISION_COOLDOWN_MS)
  }
}

function withStaleRefVision<T extends unknown[]>(
  autoVision: AutoVision | undefined,
  action: (...args: T) => Promise<string>,
): (...args: [...T, ToolContext]) => Promise<string> {
  return async (...args) => {
    const context = args.at(-1) as ToolContext
    try {
      return await action(...args.slice(0, -1) as T)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!autoVision || !STALE_REF_RE.test(message)) throw error
      throw new Error(`${message}\n${await autoVision(context, 'stale ref')}`)
    }
  }
}

function stringArg(call: ToolCall, name: string, tool: string): string {
  const value = call.args[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${tool}: '${name}' must be a non-empty string`)
  }
  return value
}

function refArg(call: ToolCall, tool: string): number {
  const value = call.args.ref
  const ref = typeof value === 'string' ? Number(value) : value
  if (typeof ref !== 'number' || !Number.isInteger(ref) || ref < 1) {
    throw new Error(`${tool}: 'ref' must be a number`)
  }
  return ref
}

function directionArg(call: ToolCall): 'up' | 'down' {
  const value = call.args.direction
  if (value !== 'up' && value !== 'down') {
    throw new Error("scroll: 'direction' must be 'up' or 'down'")
  }
  return value
}

// Gate assessment for ref-targeting calls. Argument errors are left to
// execute (which reports them as recoverable tool results) — the gate only
// classifies well-formed calls.
async function assessRefAction(browser: BrowserController, call: ToolCall, tool: string): Promise<RiskVerdict> {
  let ref: number
  try {
    ref = refArg(call, tool)
  } catch {
    return { kind: 'allow' }
  }
  return assessBrowserAction(call, await browser.describeRef(ref))
}

// Orchestrator-facing browser verbs. click/type are risk-gated: the gate
// classifies the target's snapshot facts (core/pipeline/riskGate.ts) and the
// pipeline enforces the verdict — confirm for form submits/downloads, hard
// deny for credential fills and payment submits.
export function createBrowserTools(browser: BrowserController, vision?: VisionDescriber): Tool[] {
  const reads = new WeakMap<ToolContext, ReadState>()
  // Per-run auto-vision cooldown state (#106): keyed on the run's
  // ToolContext like `reads`, so each run cools down independently.
  const autoVisionCooldown = new WeakMap<ToolContext, number>()
  const resetReads = (context: ToolContext) => reads.delete(context)
  const autoVision: AutoVision | undefined = vision
    ? (context, reason) => autoDescribe(browser, vision, context, reason, autoVisionCooldown)
    : undefined
  const click = withStaleRefVision(autoVision, (ref: number) => browser.click(ref))
  const type = withStaleRefVision(autoVision, (ref: number, text: string) => browser.type(ref, text))
  return [
    {
      name: 'navigate',
      description:
        'Navigate the visible browser to a URL. Accepts full URLs (https://…) or search terms. Returns the settled page state — URL, title, page signature, numbered interactive refs (link refs carry their hrefs), and a text digest — plus a BLOCKER marker when the landing is walled. Continue directly from the returned refs; read_page is for explicit re-inspection, not a required follow-up.',
      parameters: {
        url: { type: 'string', description: 'URL or search terms to open, e.g. "https://youtube.com" or "best mechanical keyboards"' },
      },
      execute: (call, context) => {
        resetReads(context)
        return withBlockerNudge(browser, () => browser.navigate(stringArg(call, 'url', 'navigate')))
      },
    },
    {
      name: 'read_page',
      description:
        'Return the page URL, title, page signature, scroll state, numbered interactive refs (link refs carry their hrefs — open them with navigate), and a capped text digest. Use refs like [7] with click/type. Walls are reported as a BLOCKER: marker line with what to do. Navigation and page-changing actions already return this state — read only when you need a fresh look.',
      async execute(_call, context) {
        const result = await browser.readPage()
        // ADR 0010 choke point 2: the digest, dialog text, and refs the
        // snapshot just collected are exactly the classifier's input.
        const verdict = classifyBlockerPage(await browser.pageFacts())
        const flagged = verdict ? `${result}\n${blockerSuffix(verdict)}` : result
        const refs = refsFrom(result)
        const previous = reads.get(context)
        reads.set(context, { refs })
        if (autoVision && previous && similarity(previous.refs, refs) >= 0.9) {
          return `${flagged}\n${await autoVision(context, 'repeated near-identical page reads')}`
        }
        return flagged
      },
    },
    {
      name: 'click',
      description:
        'Click a ref, then return the URL-change flag, dialog-open flag, clicked state delta, and any coarse page change. When the click meaningfully changes the page (navigation, dialog, state change), the settled page state with fresh refs follows; an inert click returns only the concise no-change line.',
      parameters: {
        ref: { type: 'integer', description: 'Element ref number from the snapshot, e.g. 7 for the element shown as [7]' },
      },
      assessRisk: (call) => assessRefAction(browser, call, 'click'),
      async execute(call, context) {
        resetReads(context)
        const result = await click(refArg(call, 'click'), context)
        if (autoVision && /\bno observable change\b/i.test(result)) {
          return `${result}\n${await autoVision(context, 'no observable change')}`
        }
        return result
      },
    },
    {
      name: 'type',
      description:
        'Click a ref and type text, then return the field actual current value. A trailing newline ("\\n") sends Enter and may navigate — a page change returns the settled page state with fresh refs.',
      parameters: {
        ref: { type: 'integer', description: 'Element ref number to type into' },
        text: { type: 'string', description: 'Text to type' },
      },
      assessRisk: (call) => assessRefAction(browser, call, 'type'),
      execute(call, context) {
        resetReads(context)
        return type(refArg(call, 'type'), stringArg(call, 'text', 'type'), context)
      },
    },
    {
      name: 'scroll',
      description: 'Scroll the page up or down by about one screen, then return the new horizontal and vertical scroll position. Refs are re-read on the next action; scrolling itself returns no refs.',
      parameters: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Direction to scroll' },
      },
      execute: (call, context) => {
        resetReads(context)
        return browser.scroll(directionArg(call))
      },
    },
    {
      name: 'screenshot',
      description: 'Capture a screenshot of the current page (reported as a byte count).',
      execute: async (_call, context) => {
        resetReads(context)
        const bytes = await browser.screenshot()
        return `screenshot captured (${bytes.byteLength} bytes)`
      },
    },
    {
      name: 'back',
      description: 'Go back one step in browser history, then return the settled page state — new URL, title, page signature, refs, and digest — plus a BLOCKER marker when the landing is walled.',
      execute: (_call, context) => {
        resetReads(context)
        return withBlockerNudge(browser, () => browser.back())
      },
    },
    {
      name: 'go_forward',
      description: 'Go forward one step in browser history, then return the settled page state — new URL, title, page signature, refs, and digest — plus a BLOCKER marker when the landing is walled.',
      execute: (_call, context) => {
        resetReads(context)
        return withBlockerNudge(browser, () => browser.forward())
      },
    },
  ]
}
