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
  /**
   * An empty-completion retry by the orchestrator client (#43): fired by
   * the retry hook while the LLM round is still in flight, so a tripled
   * round-trip reads as activity on the dashboard. Detail event — the
   * history projection maps it to no entry, so history.db recording is
   * unchanged.
   */
  | { type: 'llm_retry'; turnId: string; attempt: number; maxAttempts: number; at: number }
  /**
   * A batched fragment of streamed orchestrator output (#47): answer text
   * (the visible part of the raw content, answer-contract aware) or a
   * reasoning trace, flushed every ~120ms while the round is in flight —
   * not per token. Emitted on the detail channel like `llm_retry`; maps to
   * no history entry, so history.db recording is unchanged.
   */
  | { type: 'llm_delta'; turnId: string; kind: 'text' | 'reasoning'; text: string; at: number }
  /**
   * A tool call's intent while its arguments are still streaming (#48):
   * the accumulated tool name and raw argument JSON so far for the call
   * at `index`, flushed batched like `llm_delta` — so the feed can show
   * "clicking 'Search'…" before the tool executes. Detail event — maps
   * to no history entry, so history.db recording is unchanged.
   */
  | { type: 'llm_tool_intent'; turnId: string; index: number; name: string; args: string; at: number }
  /**
   * The run is blocked in agent_results(wait) on running subagents (#43):
   * `running` is the snapshot at wait start; live agent_update events keep
   * the dashboard's count honest while the wait continues. Detail event —
   * maps to no history entry.
   */
  | { type: 'waiting_on_agents'; turnId: string; running: number; at: number }
  /**
   * A steering directive was received (#46) — spoken or typed. Emitted on
   * the detail channel the moment resume(steering) queues the directive,
   * so the feed can echo it ("steer: use Paris instead") while it waits
   * for the next model call. Detail event — maps to no history entry, and
   * never enters session history (ADR 0001).
   */
  | { type: 'steer'; turnId: string; text: string; at: number }
  /** A subagent's state changed — the dashboard keeps one card per agent id. */
  | { type: 'agent_update'; agent: SubagentCard; at: number }
  | { type: 'done'; turnId: string; outcome?: 'done' | 'failed' | 'cancelled'; at: number }
  /**
   * A new session began (spec #25; made eager by ADR 0005) — the lapse
   * timer expired while idle, a command arrived after the window lapsed,
   * or the model invoked new_session. Not emitted by the pipeline
   * generator: main injects it into the dashboard stream when the session
   * store reports the boundary. The feed/transcript clears on it; the
   * history projection maps it to no entry, so history.db recording is
   * unchanged.
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
