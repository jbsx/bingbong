import type { Tool } from './tool'
import type { ToolCall } from '../ports/llm'
import type { BrowserController } from '../ports/browser'

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

// Orchestrator-facing browser verbs. Risk gating (requiresConfirmation for
// form submits, payments, logins) is layered on in T5.
export function createBrowserTools(browser: BrowserController): Tool[] {
  return [
    {
      name: 'navigate',
      execute: (call) => browser.navigate(stringArg(call, 'url', 'navigate')),
    },
    {
      name: 'read_page',
      execute: () => browser.readPage(),
    },
    {
      name: 'click',
      execute: (call) => browser.click(refArg(call, 'click')),
    },
    {
      name: 'type',
      execute: (call) => browser.type(refArg(call, 'type'), stringArg(call, 'text', 'type')),
    },
    {
      name: 'scroll',
      execute: (call) => browser.scroll(directionArg(call)),
    },
    {
      name: 'screenshot',
      execute: async () => {
        const bytes = await browser.screenshot()
        return `screenshot captured (${bytes.byteLength} bytes)`
      },
    },
    {
      name: 'back',
      execute: () => browser.back(),
    },
  ]
}
