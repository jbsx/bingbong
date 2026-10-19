// The AI usage dashboard on the LAN (an external HTTP server the owner runs):
// `/api/usage` carries each provider's limit windows now, `/api/history`
// the samples it took about once a minute. This reads both payloads into
// one snapshot of every provider and window it reports, and `viewUsage`
// cuts that down to what the owner chose to show on the Idle Screen — the
// same choices the dashboard's own ⚙ Metrics panel offers, kept here
// because the dashboard keeps its own in that browser's storage.

export type FetchJson = (url: string) => Promise<unknown>

/** How much history the chart spans: the dashboard's own default view. */
export const USAGE_HISTORY_MS = 12 * 60 * 60 * 1000

/** Past this age the card's "Updated" time reads as stale: the dashboard samples once a minute. */
export const USAGE_STALE_MS = 5 * 60 * 1000

export interface UsageWindow {
  /** The dashboard's window id: `5h`, `7d`, `7d-fable`, `monthly`… */
  key: string
  /** Its short caption: `5h`, `7d`, `7d-fab`, `mo`. */
  caption: string
  /** The dashboard's own name for it: `5-Hour`, `7-Day (Fable)`. */
  label: string
  usedPct: number
  /** When the window resets (epoch ms); null while it is unarmed. */
  resetAt: number | null
  /** The window's whole length, when its key names one. */
  durationMs: number | null
  /** The window's samples over the chart's span, oldest first, as [sampledAt, usedPct]. */
  history: Array<[number, number]>
}

export interface UsageProviderReport {
  name: string
  plan: string | null
  connected: boolean
  windows: UsageWindow[]
}

export interface UsageSnapshot {
  /** When the dashboard last refreshed its numbers (epoch ms). */
  updatedAt: number
  /** Every provider the dashboard reports, in its order. */
  providers: UsageProviderReport[]
}

/** One provider's choices: the dashboard's per-card show, gauge and chart controls. */
export interface UsageProviderPrefs {
  /** Window keys left off the card. */
  hidden: string[]
  /** The window the dot gauge shows; null takes the default pick (the window closest to its limit). */
  gauge: string | null
  /** Window keys drawn on the chart; null draws the gauged window alone. */
  chart: string[] | null
}

export interface UsagePrefs {
  /** The providers the card shows, by name; it shows them in the dashboard's order. */
  providers: string[]
  metrics: Record<string, UsageProviderPrefs>
}

/** What the card shows for one provider. */
export interface UsageView {
  name: string
  plan: string | null
  gauge: UsageWindow | null
  bars: UsageWindow[]
  lines: UsageWindow[]
}

export function defaultUsagePrefs(): UsagePrefs {
  return { providers: ['Codex', 'Claude'], metrics: {} }
}

export function defaultProviderPrefs(): UsageProviderPrefs {
  return { hidden: [], gauge: null, chart: null }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asStrings(value: unknown): string[] {
  return [...new Set(asArray(value).filter((item): item is string => typeof item === 'string'))]
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Parse anything (disk, IPC) into usage prefs; unknown bits fall back to the defaults. */
export function sanitizeUsagePrefs(raw: unknown): UsagePrefs {
  const record = asRecord(raw)
  if (!record) return defaultUsagePrefs()
  const metrics: Record<string, UsageProviderPrefs> = {}
  for (const [name, value] of Object.entries(asRecord(record.metrics) ?? {})) {
    const prefs = asRecord(value)
    if (!prefs) continue
    metrics[name] = {
      hidden: asStrings(prefs.hidden),
      gauge: typeof prefs.gauge === 'string' ? prefs.gauge : null,
      chart: Array.isArray(prefs.chart) ? asStrings(prefs.chart) : null,
    }
  }
  return {
    providers: Array.isArray(record.providers) ? asStrings(record.providers) : defaultUsagePrefs().providers,
    metrics,
  }
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

/** Every provider's every window's samples, keyed `provider\u0000window`, oldest first. */
function readHistory(history: unknown): Map<string, Array<[number, number]>> {
  const series = new Map<string, Array<[number, number]>>()
  for (const rawSample of asArray(asRecord(history)?.samples)) {
    const sample = asRecord(rawSample)
    const sampledAt = finite(sample?.sampledAt)
    if (sampledAt === null) continue
    for (const rawProvider of asArray(sample?.providers)) {
      const provider = asRecord(rawProvider)
      if (typeof provider?.name !== 'string') continue
      for (const rawWindow of asArray(provider.windows)) {
        const window = asRecord(rawWindow)
        const usedPct = finite(window?.usedPct)
        if (!window || usedPct === null) continue
        const id = `${provider.name}\u0000${windowKey(window)}`
        const points = series.get(id) ?? []
        points.push([sampledAt, usedPct])
        series.set(id, points)
      }
    }
  }
  for (const points of series.values()) points.sort((a, b) => a[0] - b[0])
  return series
}

/** The dashboard's two payloads as one snapshot: every provider it reports, each window with its history. */
export function readUsage(usage: unknown, history: unknown): UsageSnapshot {
  const record = asRecord(usage)
  const series = readHistory(history)
  const providers: UsageProviderReport[] = []
  for (const rawProvider of asArray(record?.providers)) {
    const entry = asRecord(rawProvider)
    if (typeof entry?.name !== 'string') continue
    const name = entry.name
    const windows: UsageWindow[] = []
    for (const rawWindow of asArray(entry.windows)) {
      const window = asRecord(rawWindow)
      const usedPct = finite(window?.usedPct)
      const key = window ? windowKey(window) : ''
      if (!window || usedPct === null || key === '') continue
      windows.push({
        key,
        caption: windowCaption(key),
        label: typeof window.label === 'string' ? window.label : key,
        usedPct,
        resetAt: finite(window.resetAt),
        durationMs: windowDurationMs(key),
        history: series.get(`${name}\u0000${key}`) ?? [],
      })
    }
    providers.push({ name, plan: typeof entry.plan === 'string' ? entry.plan : null, connected: entry.connected !== false, windows })
  }
  return { updatedAt: finite(record?.updatedAt) ?? Date.now(), providers }
}

/**
 * The default gauge: the window closest to its limit — the one that will
 * stop you — so a 10 % 5-hour window never rings while the 7-day sits at
 * 96 %. A tie goes the dashboard's way: the 5-hour, else the 7-day, else
 * the first.
 */
export function defaultGauge(windows: readonly UsageWindow[]): UsageWindow | null {
  const rank = (w: UsageWindow): number => {
    const key = w.key.toLowerCase()
    return key.startsWith('5h') ? 0 : key.startsWith('7d') ? 1 : 2
  }
  return windows.reduce<UsageWindow | null>((best, w) => (best === null || w.usedPct > best.usedPct || (w.usedPct === best.usedPct && rank(w) < rank(best)) ? w : best), null)
}

/**
 * The snapshot as the owner chose to see it: the chosen providers, in the
 * dashboard's order, that are connected; each card's shown windows, its
 * gauge the chosen one while it is shown (else the default pick), the rest
 * as bars; the chart's lines the chosen windows, or the gauge alone. A
 * chart line need not be shown on the card, as on the dashboard.
 */
export function viewUsage(snapshot: UsageSnapshot, prefs: UsagePrefs): UsageView[] {
  const chosen = new Set(prefs.providers)
  return snapshot.providers
    .filter((provider) => provider.connected && chosen.has(provider.name))
    .map((provider) => {
      const metric = prefs.metrics[provider.name] ?? defaultProviderPrefs()
      const shown = provider.windows.filter((w) => !metric.hidden.includes(w.key))
      const gauge = shown.find((w) => w.key === metric.gauge) ?? defaultGauge(shown)
      const lines =
        metric.chart === null ? (gauge ? [gauge] : []) : provider.windows.filter((w) => metric.chart?.includes(w.key))
      return { name: provider.name, plan: provider.plan, gauge, bars: shown.filter((w) => w !== gauge), lines }
    })
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

/** The chart's top: the first of 10, 20, 25, 50 that clears the peak with headroom, else 100 — a percentage never scales past it. */
export function chartCeiling(peak: number): number {
  const target = peak * 1.1
  return [10, 20, 25, 50].find((top) => top >= target) ?? 100
}
