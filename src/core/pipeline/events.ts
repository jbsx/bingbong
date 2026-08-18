export type PipelineStatus = 'thinking' | 'acting' | 'speaking' | 'paused' | 'cancelled'

import type { SubagentKind, SubagentStatus } from '../agent/subagentManager'
import type { SubagentTabPhase } from '../browser/subagentTabs'

/** Live-card view of one subagent, merged from manager + tab state. */
export interface SubagentCard {
  id: string
  kind: SubagentKind
  task: string
  status: SubagentStatus
  startedAt: number
  finishedAt: number | null
  steps: number
  lastAction: string | null
  result: string | null
  error: string | null
  /** Present for browse agents; phase drives the viewport and reopen. */
  tab?: { phase: SubagentTabPhase; url: string; title: string }
}

export type PipelineEvent =
  | { type: 'command'; text: string; at: number }
  | { type: 'status'; status: PipelineStatus; at: number }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown>; at: number }
  | {
      type: 'tool_result'
      callId: string
      name: string
      ok: boolean
      result?: unknown
      error?: string
      at: number
    }
  | {
      type: 'confirmation_requested'
      confirmationId: string
      callId: string
      toolName: string
      prompt: string
      /** Wall-clock deadline for the auto-deny — the dashboard counts down to it. */
      expiresAt: number
      at: number
    }
  | {
      type: 'confirmation_resolved'
      confirmationId: string
      approved: boolean
      reason: 'user' | 'timeout' | 'cancelled' | 'steered'
      at: number
    }
  | {
      type: 'confirmation_deadline'
      confirmationId: string
      /** Null while pause suspends the countdown. */
      expiresAt: number | null
      at: number
    }
  /** A tool asked the user a free-text question (ask_user, Tier 3). */
  | {
      type: 'ask_requested'
      askId: string
      callId: string
      question: string
      /** Wall-clock deadline — the dashboard counts down to it. */
      expiresAt: number
      at: number
    }
  | {
      type: 'ask_resolved'
      askId: string
      /** The user's answer; null when the window timed out. */
      answer: string | null
      reason: 'user' | 'timeout' | 'cancelled' | 'steered'
      at: number
    }
  | {
      type: 'ask_deadline'
      askId: string
      /** Null while pause suspends the countdown. */
      expiresAt: number | null
      at: number
    }
  | { type: 'speak'; text: string; at: number }
  | { type: 'display'; text: string; at: number }
  | { type: 'error'; message: string; at: number }
  /** A subagent's state changed — the dashboard keeps one card per agent id. */
  | { type: 'agent_update'; agent: SubagentCard; at: number }
  | { type: 'done'; outcome?: 'done' | 'failed' | 'cancelled'; at: number }

/**
 * Derives a run's outcome when its `done` event omits one: a seen cancelled
 * status wins, else any error means failed, else the run succeeded. Shared
 * by every observer of the run event seam (history recorder, session memory).
 */
export function inferRunOutcome(
  explicit: 'done' | 'failed' | 'cancelled' | undefined,
  lastStatus: string | null,
  sawError: boolean,
): 'done' | 'failed' | 'cancelled' {
  return explicit ?? (lastStatus === 'cancelled' ? 'cancelled' : sawError ? 'failed' : 'done')
}
