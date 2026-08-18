import type { RiskVerdict, Tool, ToolContext } from './tool'
import type { ToolCall } from '../ports/llm'
import type { BrowserController } from '../ports/browser'
import type { VisionDescriber } from '../ports/vision'
import { assessBrowserAction } from './riskGate'

const STALE_REF_RE = /ref \d+ not found.*page may have changed/i
const AUTO_VISION_PROMPT =
  'Describe the current browser screenshot, focusing on page state, popups, dialogs, overlays, errors, and anything blocking the requested task.'

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

async function autoDescribe(
  browser: BrowserController,
  vision: VisionDescriber,
  context: ToolContext,
  reason: string,
): Promise<string> {
  const grant = context.acquireVision?.()
  if (!grant) return 'Auto-vision refused: vision budget is unavailable'
  if (!grant.ok) return `Auto-vision refused: ${grant.reason}`
  try {
    const description = await vision.describe({
      image: await browser.screenshot(),
      prompt: `${AUTO_VISION_PROMPT}\nTrigger: ${reason}.`,
    })
    return `Auto-vision (${reason}): ${description}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Auto-vision failed (${reason}): ${message}`
  }
}

function withStaleRefVision<T extends unknown[]>(
  browser: BrowserController,
  vision: VisionDescriber | undefined,
  action: (...args: T) => Promise<string>,
): (...args: [...T, ToolContext]) => Promise<string> {
  return async (...args) => {
    const context = args.at(-1) as ToolContext
    try {
      return await action(...args.slice(0, -1) as T)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!vision || !STALE_REF_RE.test(message)) throw error
      throw new Error(`${message}\n${await autoDescribe(browser, vision, context, 'stale ref')}`)
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
  const resetReads = (context: ToolContext) => reads.delete(context)
  const click = withStaleRefVision(browser, vision, (ref: number) => browser.click(ref))
  const type = withStaleRefVision(browser, vision, (ref: number, text: string) => browser.type(ref, text))
  return [
    {
      name: 'navigate',
      description:
        'Navigate the visible browser to a URL. Accepts full URLs (https://…) or search terms; returns the final URL and page title.',
      parameters: {
        url: { type: 'string', description: 'URL or search terms to open, e.g. "https://youtube.com" or "best mechanical keyboards"' },
      },
      execute: (call, context) => {
        resetReads(context)
        return browser.navigate(stringArg(call, 'url', 'navigate'))
      },
    },
    {
      name: 'read_page',
      description:
        'Return the page URL, title, scroll state, numbered interactive refs, and a capped text digest. Use refs like [7] with click/type.',
      async execute(_call, context) {
        const result = await browser.readPage()
        const refs = refsFrom(result)
        const previous = reads.get(context)
        reads.set(context, { refs })
        if (vision && previous && similarity(previous.refs, refs) >= 0.9) {
          return `${result}\n${await autoDescribe(browser, vision, context, 'repeated near-identical page reads')}`
        }
        return result
      },
    },
    {
      name: 'click',
      description: 'Click a ref, then return the URL-change flag, dialog-open flag, clicked state delta, and any coarse page change (including no observable change).',
      parameters: {
        ref: { type: 'integer', description: 'Element ref number from the snapshot, e.g. 7 for the element shown as [7]' },
      },
      assessRisk: (call) => assessRefAction(browser, call, 'click'),
      async execute(call, context) {
        resetReads(context)
        const result = await click(refArg(call, 'click'), context)
        if (vision && /\bno observable change\b/i.test(result)) {
          return `${result}\n${await autoDescribe(browser, vision, context, 'no observable change')}`
        }
        return result
      },
    },
    {
      name: 'type',
      description:
        'Click a ref and type text, then return the field actual current value. A trailing newline ("\\n") sends Enter and may navigate.',
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
      description: 'Scroll the page up or down by about one screen, then return the new horizontal and vertical scroll position.',
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
      description: 'Go back one step in browser history, then return the new URL and page title.',
      execute: (_call, context) => {
        resetReads(context)
        return browser.back()
      },
    },
  ]
}
