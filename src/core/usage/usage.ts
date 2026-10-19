// The AI usage dashboard on the LAN (an external HTTP server the owner runs):
// `/api/usage` carries each provider's limit windows now, `/api/history`
// the samples it took about once a minute. The Idle Screen shows two of its
// providers — the gauge each card leads with and its history as lines — so
// this reads both payloads into that one shape and drops everything else.

export type FetchJson = (url: string) => Promise<unknown>

/** The providers the Idle Screen shows, in the order it shows them. */
export const USAGE_PROVIDERS = ['Codex', 'Claude'] as const

/** How much history the chart spans: the dashboard's own default view. */
export const USAGE_HISTORY_MS = 12 * 60 * 60 * 1000

export interface UsageWindow {
  /** The dashboard's window id: `5h`, `7d`, `7d-fable`, `monthly`… */
  key: string
  /** Its short caption: `5h`, `7d`, `7d-fab`, `mo`. */
  caption: string
  usedPct: number
  /** When the window resets (epoch ms); null while it is unarmed. */
  resetAt: number | null
  /** The window's whole length, when its key names one. */
  durationMs: number | null
}

export interface UsageProvider {
  name: string
  plan: string | null
  /** The window the dashboard's card gauges: 5h first, else 7d, else the first. */
  gauge: UsageWindow | null
  /** Every other window, as the card's bars. */
  bars: UsageWindow[]
  /** The gauged window's history, oldest first, as [sampledAt, usedPct]. */
  history: Array<[number, number]>
}

export interface UsageSnapshot {
  updatedAt: number
  providers: UsageProvider[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function windowKey(window: Record<string, unknown>): string {
  const key = typeof window.key === 'string' && window.key !== '' ? window.key : window.label
  return typeof key === 'string' ? key : ''
}

/** The dashboard's caption rule: a duration key cut to six characters, `mo` for monthly. */
export function windowCaption(key: string): string {
  const lower = key.toLowerCase()
  if (lower.startsWith('month')) return 'mo'
  if (/^(\d+(h|d|mo|y)|month|day|week)/.test(lower)) return lower.slice(0, 6)
  return key.split(/[-– ]/).filter(Boolean).pop() ?? lower.slice(0, 6)
}

export function windowDurationMs(key: string): number | null {
  const lower = key.toLowerCase()
  if (lower.startsWith('5h')) return 5 * 3_600_000
  if (lower.startsWith('1h')) return 3_600_000
  if (lower.startsWith('7d')) return 7 * 86_400_000
  if (lower.startsWith('1d') || lower.startsWith('day')) return 86_400_000
  return null
}

/**
 * How much of the window has run, 0–100 — what the dashboard's dot grid
 * lights. An unarmed window is empty; one whose length is unknown reads its
 * usage instead, as the dashboard's does.
 */
export function elapsedPct(window: UsageWindow, now: number): number {
  if (window.resetAt === null) return 0
  if (window.durationMs === null) return Math.min(100, Math.max(0, window.usedPct))
  const left = (window.resetAt - now) / window.durationMs
  return Math.min(100, Math.max(0, Math.round(100 - left * 100)))
}

function readWindow(raw: unknown): UsageWindow | null {
  const window = asRecord(raw)
  if (!window) return null
  const usedPct = finite(window.usedPct)
  const key = windowKey(window)
  if (usedPct === null || key === '') return null
  return {
    key,
    caption: windowCaption(key),
    usedPct,
    resetAt: finite(window.resetAt),
    durationMs: windowDurationMs(key),
  }
}

function pickGauge(windows: UsageWindow[]): UsageWindow | null {
  const starts = (prefix: string) => windows.find((w) => w.key.toLowerCase().startsWith(prefix))
  return starts('5h') ?? starts('7d') ?? windows[0] ?? null
}

/** The gauged window's samples for one provider, out of the history payload. */
function readHistory(history: unknown, provider: string, key: string): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (const rawSample of asArray(asRecord(history)?.samples)) {
    const sample = asRecord(rawSample)
    const sampledAt = finite(sample?.sampledAt)
    if (sampledAt === null) continue
    const entry = asArray(sample?.providers).map(asRecord).find((p) => p?.name === provider)
    const window = asArray(entry?.windows).map(asRecord).find((w) => w !== null && windowKey(w) === key)
    const usedPct = finite(window?.usedPct)
    if (usedPct !== null) points.push([sampledAt, usedPct])
  }
  return points.sort((a, b) => a[0] - b[0])
}

/**
 * The dashboard's two payloads as the Idle Screen's snapshot: the shown
 * providers in USAGE_PROVIDERS order, each with its gauge, its bars and the
 * gauge's history. A provider the dashboard does not report, or reports
 * disconnected, is left out.
 */
export function readUsage(usage: unknown, history: unknown): UsageSnapshot {
  const record = asRecord(usage)
  const reported = asArray(record?.providers).map(asRecord)
  const providers: UsageProvider[] = []
  for (const name of USAGE_PROVIDERS) {
    const entry = reported.find((p) => p?.name === name)
    if (!entry || entry.connected === false) continue
    const windows = asArray(entry.windows)
      .map(readWindow)
      .filter((w): w is UsageWindow => w !== null)
    const gauge = pickGauge(windows)
    providers.push({
      name,
      plan: typeof entry.plan === 'string' ? entry.plan : null,
      gauge,
      bars: windows.filter((w) => w !== gauge),
      history: gauge ? readHistory(history, name, gauge.key) : [],
    })
  }
  return { updatedAt: finite(record?.updatedAt) ?? Date.now(), providers }
}

/** The dashboard's base URL, trimmed of trailing slashes; '' when unset. */
export function usageBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Both payloads off the dashboard at `baseUrl`, read into one snapshot. */
export async function fetchUsage(fetchJson: FetchJson, baseUrl: string, now: number): Promise<UsageSnapshot> {
  const base = usageBaseUrl(baseUrl)
  const [usage, history] = await Promise.all([
    fetchJson(`${base}/api/usage`),
    fetchJson(`${base}/api/history?from=${now - USAGE_HISTORY_MS}&to=${now}`),
  ])
  return readUsage(usage, history)
}

/** Time to a window's reset in its two largest units ("3h 51m", "5d 20h"); `unarmed` before it starts counting. */
export function resetLabel(resetAt: number | null, now: number): string {
  if (resetAt === null) return 'unarmed'
  let seconds = Math.max(0, Math.floor((resetAt - now) / 1000))
  const days = Math.floor(seconds / 86_400)
  seconds -= days * 86_400
  const hours = Math.floor(seconds / 3_600)
  seconds -= hours * 3_600
  const minutes = Math.floor(seconds / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0 || days > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.slice(0, 2).join(' ')
}

/** The chart's top: the first of 10, 20, 25, 50, 100 that clears the peak with headroom; past 100, the next 25. */
export function chartCeiling(peak: number): number {
  const target = peak * 1.1
  const step = [10, 20, 25, 50, 100].find((top) => top >= target)
  return step ?? Math.ceil(target / 25) * 25
}
