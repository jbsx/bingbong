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

/**
 * One id per turn, everywhere a turn is observable (#28): every event the
 * pipeline generator yields during a turn is stamped with that turn's
 * `turnId` (required below). `speak`/`display`/`error` carry it optionally —
 * the download router and subagent cards emit the same variants outside any
 * turn's stream, and those announcements are not turn-scoped. `agent_update`
 * and `session_started` are never pipeline-emitted and stay unstamped.
 */
export type PipelineEvent =
  | { type: 'command'; turnId: string; text: string; at: number }
  | { type: 'status'; turnId: string; status: PipelineStatus; at: number }
  | { type: 'tool_call'; turnId: string; callId: string; name: string; args: Record<string, unknown>; at: number }
  | {
      type: 'tool_result'
      turnId: string
      callId: string
      name: string
      ok: boolean
      result?: unknown
      error?: string
      at: number
    }
  | {
      type: 'confirmation_requested'
      turnId: string
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
      turnId: string
      confirmationId: string
      approved: boolean
      reason: 'user' | 'timeout' | 'cancelled' | 'steered'
      at: number
    }
  | {
      type: 'confirmation_deadline'
      turnId: string
      confirmationId: string
      /** Null while pause suspends the countdown. */
      expiresAt: number | null
      at: number
    }
  /** A tool asked the user a free-text question (ask_user, Tier 3). */
  | {
      type: 'ask_requested'
      turnId: string
      askId: string
      callId: string
      question: string
      /** Wall-clock deadline — the dashboard counts down to it. */
      expiresAt: number
      at: number
    }
  | {
      type: 'ask_resolved'
      turnId: string
      askId: string
      /** The user's answer; null when the window timed out. */
      answer: string | null
      reason: 'user' | 'timeout' | 'cancelled' | 'steered'
      at: number
    }
  | {
      type: 'ask_deadline'
      turnId: string
      askId: string
      /** Null while pause suspends the countdown. */
      expiresAt: number | null
      at: number
    }
  | { type: 'speak'; turnId?: string; text: string; at: number }
  | { type: 'display'; turnId?: string; text: string; at: number }
  | { type: 'error'; turnId?: string; message: string; at: number }
  /** A subagent's state changed — the dashboard keeps one card per agent id. */
  | { type: 'agent_update'; agent: SubagentCard; at: number }
  | { type: 'done'; turnId: string; outcome?: 'done' | 'failed' | 'cancelled'; at: number }
  /**
   * A new session began (spec #25) — the window lapsed before this command,
   * or the model invoked new_session. Not emitted by the pipeline generator:
   * main injects it into the dashboard stream when the session store reports
   * the boundary. The transcript clears on it; the history projection maps
   * it to no entry, so history.db recording is unchanged.
   */
  | { type: 'session_started'; at: number }

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
