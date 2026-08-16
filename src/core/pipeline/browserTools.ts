import type { RiskVerdict, Tool } from './tool'
import type { ToolCall } from '../ports/llm'
import type { BrowserController } from '../ports/browser'
import { assessBrowserAction } from './riskGate'

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
export function createBrowserTools(browser: BrowserController): Tool[] {
  return [
    {
      name: 'navigate',
      description:
        'Navigate the visible browser to a URL. Accepts full URLs (https://…) or search terms; returns the final URL and page title.',
      parameters: {
        url: { type: 'string', description: 'URL or search terms to open, e.g. "https://youtube.com" or "best mechanical keyboards"' },
      },
      execute: (call) => browser.navigate(stringArg(call, 'url', 'navigate')),
    },
    {
      name: 'read_page',
      description:
        'Return a numbered-ref snapshot of the visible interactive elements (links, buttons, inputs, media) plus the page URL and title. Use refs like [7] with click/type.',
      execute: () => browser.readPage(),
    },
    {
      name: 'click',
      description: 'Click an element identified by its ref number from the most recent read_page snapshot.',
      parameters: {
        ref: { type: 'integer', description: 'Element ref number from the snapshot, e.g. 7 for the element shown as [7]' },
      },
      assessRisk: (call) => assessRefAction(browser, call, 'click'),
      execute: (call) => browser.click(refArg(call, 'click')),
    },
    {
      name: 'type',
      description:
        'Click an element and type text into it. A trailing newline ("\\n") sends Enter — use it to submit search boxes.',
      parameters: {
        ref: { type: 'integer', description: 'Element ref number to type into' },
        text: { type: 'string', description: 'Text to type' },
      },
      assessRisk: (call) => assessRefAction(browser, call, 'type'),
      execute: (call) => browser.type(refArg(call, 'type'), stringArg(call, 'text', 'type')),
    },
    {
      name: 'scroll',
      description: 'Scroll the page up or down by about one screen, then report the new snapshot.',
      parameters: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Direction to scroll' },
      },
      execute: (call) => browser.scroll(directionArg(call)),
    },
    {
      name: 'screenshot',
      description: 'Capture a screenshot of the current page (reported as a byte count).',
      execute: async () => {
        const bytes = await browser.screenshot()
        return `screenshot captured (${bytes.byteLength} bytes)`
      },
    },
    {
      name: 'back',
      description: 'Go back one step in browser history.',
      execute: () => browser.back(),
    },
  ]
}
