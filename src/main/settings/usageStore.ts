import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentRole } from '../../core/agent/modelRouting'
import type { TokenUsage } from '../../core/ports/llm'
import {
  dayKeyOf,
  emptyDailyUsage,
  recordUsage,
  sanitizeDailyUsage,
  summarizeUsage,
  type DailyUsage,
  type UsageSummary,
} from '../../core/agent/spendEstimate'

// The daily usage ledger, persisted as JSON beside the settings file so the
// day's estimate survives restarts and rolls over at midnight (local time).
// State transitions live in core (spendEstimate.ts); this store owns the
// file and the clock.

export interface UsageStore {
  record(role: AgentRole, model: string, usage: TokenUsage | undefined): void
  summary(warnUsd: number): UsageSummary
}

function persist(path: string, state: DailyUsage): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function createUsageStore(path: string, deps?: { now?: () => number }): UsageStore {
  const now = deps?.now ?? (() => Date.now())
  let state: DailyUsage
  try {
    state = sanitizeDailyUsage(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    state = emptyDailyUsage(dayKeyOf(now()))
  }

  return {
    record(role, model, usage) {
      state = recordUsage(state, dayKeyOf(now()), role, model, usage)
      persist(path, state)
    },
    summary(warnUsd) {
      const today = dayKeyOf(now())
      if (state.date !== today) state = emptyDailyUsage(today)
      return summarizeUsage(state, warnUsd)
    },
  }
}
