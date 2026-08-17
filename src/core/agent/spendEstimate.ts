// The warn-only daily spend estimate (issue #13). Usage entries accumulate in
// a per-day ledger (pure state, persisted by the caller); a rough price table
// turns tokens into dollars. Prices are order-of-magnitude estimates for the
// configured providers — this is a gauge for the settings page, never a block.

import type { AgentRole } from './modelRouting'
import { AGENT_ROLES } from './modelRouting'
import type { TokenUsage } from '../ports/llm'

export const DEFAULT_DAILY_SPEND_WARN_USD = 5

export interface UsageEntry {
  role: AgentRole
  model: string
  requests: number
  promptTokens: number
  completionTokens: number
}

export interface DailyUsage {
  /** Local calendar day this ledger covers, YYYY-MM-DD. */
  date: string
  entries: UsageEntry[]
}

interface ModelPrices {
  inputPerMTok: number
  outputPerMTok: number
}

// Rough list-price estimates (USD per 1M tokens) at the time of writing;
// adjust here when providers reprice. Unknown models fall back to the GLM row.
const DEFAULT_PRICES: { match: RegExp; prices: ModelPrices }[] = [
  { match: /deepseek/i, prices: { inputPerMTok: 0.27, outputPerMTok: 1.1 } },
  { match: /glm/i, prices: { inputPerMTok: 0.6, outputPerMTok: 2.2 } },
]
const FALLBACK_PRICES: ModelPrices = { inputPerMTok: 0.6, outputPerMTok: 2.2 }

export function dayKeyOf(nowMs: number): string {
  const date = new Date(nowMs)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function emptyDailyUsage(date: string): DailyUsage {
  return { date, entries: [] }
}

/** Parse anything (disk, IPC) into a valid ledger; junk falls back to an empty day. */
export function sanitizeDailyUsage(raw: unknown): DailyUsage {
  if (typeof raw !== 'object' || raw === null) return emptyDailyUsage('')
  const record = raw as Record<string, unknown>
  if (typeof record.date !== 'string' || !Array.isArray(record.entries)) return emptyDailyUsage('')

  const entries: UsageEntry[] = []
  for (const candidate of record.entries) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as Record<string, unknown>
    const role = AGENT_ROLES.find((valid) => valid === entry.role)
    if (!role || typeof entry.model !== 'string') continue
    const numberOr = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
    entries.push({
      role,
      model: entry.model,
      requests: numberOr(entry.requests),
      promptTokens: numberOr(entry.promptTokens),
      completionTokens: numberOr(entry.completionTokens),
    })
  }
  return { date: record.date, entries }
}

export function estimateSpendUsd(model: string, usage: TokenUsage): number {
  const prices = DEFAULT_PRICES.find((row) => row.match.test(model))?.prices ?? FALLBACK_PRICES
  return (
    (usage.promptTokens / 1_000_000) * prices.inputPerMTok +
    (usage.completionTokens / 1_000_000) * prices.outputPerMTok
  )
}

export function recordUsage(
  state: DailyUsage,
  date: string,
  role: AgentRole,
  model: string,
  usage: TokenUsage | undefined,
): DailyUsage {
  const base: DailyUsage = state.date === date ? state : emptyDailyUsage(date)
  const existing = base.entries.find((entry) => entry.role === role && entry.model === model)

  const bumped: UsageEntry = existing
    ? {
        ...existing,
        requests: existing.requests + 1,
        promptTokens: existing.promptTokens + (usage?.promptTokens ?? 0),
        completionTokens: existing.completionTokens + (usage?.completionTokens ?? 0),
      }
    : {
        role,
        model,
        requests: 1,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
      }

  return {
    date,
    entries: existing
      ? base.entries.map((entry) => (entry === existing ? bumped : entry))
      : [...base.entries, bumped],
  }
}

export interface UsageSummary {
  date: string
  requests: number
  promptTokens: number
  completionTokens: number
  estimateUsd: number
  warnUsd: number
  overWarn: boolean
  byRole: Partial<Record<AgentRole, { requests: number; promptTokens: number; completionTokens: number }>>
}

export function summarizeUsage(state: DailyUsage, warnUsd: number = DEFAULT_DAILY_SPEND_WARN_USD): UsageSummary {
  const totals = state.entries.reduce(
    (acc, entry) => {
      acc.requests += entry.requests
      acc.promptTokens += entry.promptTokens
      acc.completionTokens += entry.completionTokens
      acc.estimateUsd += entry.requests > 0 && entry.promptTokens + entry.completionTokens > 0
        ? estimateSpendUsd(entry.model, { promptTokens: entry.promptTokens, completionTokens: entry.completionTokens })
        : 0
      return acc
    },
    { requests: 0, promptTokens: 0, completionTokens: 0, estimateUsd: 0 },
  )

  const byRole: UsageSummary['byRole'] = {}
  for (const entry of state.entries) {
    const current = byRole[entry.role] ?? { requests: 0, promptTokens: 0, completionTokens: 0 }
    byRole[entry.role] = {
      requests: current.requests + entry.requests,
      promptTokens: current.promptTokens + entry.promptTokens,
      completionTokens: current.completionTokens + entry.completionTokens,
    }
  }

  return {
    date: state.date,
    ...totals,
    estimateUsd: Math.round(totals.estimateUsd * 10_000) / 10_000,
    warnUsd,
    overWarn: totals.estimateUsd > warnUsd,
    byRole,
  }
}
