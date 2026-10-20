import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

// A stand-in usage dashboard for the Idle Screen's suites: `count` of the
// providers below, Claude with two more windows than its gauge and running
// ahead of its week, twelve hours of history a minute apart — so the AI
// Usage card draws the same rings and chart on every run, whatever the LAN
// dashboard says.

export const PROVIDERS = ['Codex', 'Claude', 'Kaggle', 'GLM', 'Grok']

const HOUR = 3_600_000

function usagePayload(count: number, now: number) {
  const providers = PROVIDERS.slice(0, count).map((name, index) => ({
    name,
    connected: true,
    plan: index === 1 ? 'Max 20x' : 'pro',
    windows: [
      // Claude's gauge runs ahead of its week (+5 ahead, as round 6 drew it); the others behind theirs.
      { key: '7d', label: '7-Day', usedPct: [14, 10, 41, 22, 63][index], resetAt: now + [130, 159, 60, 100, 40][index] * HOUR },
      ...(index === 1
        ? [
            { key: '7d-fable', label: '7-Day (Fable)', usedPct: 8, resetAt: now + 159 * HOUR },
            { key: '5h', label: '5-Hour', usedPct: 2, resetAt: now + 107 * 60_000 },
          ]
        : []),
    ],
  }))
  const samples = Array.from({ length: 720 }, (_, step) => ({
    sampledAt: now - step * 60_000,
    providers: providers.map((provider) => ({
      name: provider.name,
      windows: provider.windows.map((window) => ({ key: window.key, label: window.label, usedPct: Math.max(0, window.usedPct - step * 0.01) })),
    })),
  }))
  return { usage: { updatedAt: now, providers }, history: { samples } }
}

export interface UsageStandIn {
  /** The settings' `usageDashboard` that reads it: its address and its providers. */
  settings: { url: string; providers: string[] }
  close(): Promise<void>
}

export async function startUsageStandIn(count: number): Promise<UsageStandIn> {
  const server = createServer((request, response) => {
    const payload = usagePayload(count, Date.now())
    const body = request.url?.startsWith('/api/history') ? payload.history : request.url?.startsWith('/api/usage') ? payload.usage : null
    response.writeHead(body === null ? 404 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body ?? {}))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    settings: { url: `http://127.0.0.1:${port}`, providers: PROVIDERS.slice(0, count) },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
