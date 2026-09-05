export type PipelineStatus = 'thinking' | 'acting' | 'speaking' | 'paused' | 'cancelled'

import type { SubagentKind, SubagentOwner, SubagentStatus } from '../agent/subagentManager'
import type { SubagentTabPhase } from '../browser/subagentTabs'
import type { MemoryEntryId, MemoryReference } from '../session/workingMemory'
import type { RunId, SessionGeneration, SessionId, SubmissionId } from '../session/sessionIdentity'
import type { FinalizationCause, RunResolution } from '../session/runJournal'
import type { EffortTier } from './runPlan'

/**
 * Ownership metadata on Session-scoped events (#86–#100): every published
 * event carries the identity of the Run (or lifecycle moment) that produced
 * it. Run-scoped variants are stamped by publication — the command runner's
 * accepted ownership fills what the pipeline generator cannot know — and
 * consumers reject events carrying an ended or foreign Session.
 */
export interface SessionEventIdentity {
  submissionId?: SubmissionId
  runId?: RunId
  sessionId?: SessionId
  sessionGeneration?: SessionGeneration
}

/** The tab slice a subagent card carries — the bridge merges it in from the tab machine. */
export interface SubagentCardTab {
  phase: SubagentTabPhase
  url: string
  title: string
  /**
   * The latest in-memory capture of the tab's page (#57): a JPEG data URL
   * refreshed ~1fps while the agent runs, kept in renderer memory only
   * (the capture path never writes to disk).
   */
  thumbnail?: string
}

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
  /** Present for browse agents; phase drives the thumbnail and reopen. */
  tab?: SubagentCardTab
  /** The Session that spawned this agent — the card is Session-owned work (#97). */
  owner?: SubagentOwner
}

/**
 * One id per turn, everywhere a turn is observable (#28): every event the
 * pipeline generator yields during a turn is stamped with that turn's
 * `turnId` (required below). `speak`/`display`/`error` carry it optionally —
 * the download router and subagent cards emit the same variants outside any
 * turn's stream, and those announcements are not turn-scoped. `agent_update`
 * and Session lifecycle events are not pipeline-emitted. Session/Run identity
 * is stamped at publication (see SessionEventIdentity); unstamped events are
 * rejected by every consumer.
 */
export type PipelineEvent = SessionEventIdentity & (
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
  /**
   * A final Answer's display (#141) may carry its evidence grounding as
   * Session-only metadata, added at the display boundary: the declared
   * `evidenceIds` feed the live Answer Evidence Summary, and the derived
   * `sources` name the pages behind it. The live Feed ignores `sources`;
   * since Recorded History was retired (#188) they are read only by the
   * Run Trace, which records the event as published. Non-Answer displays
   * carry neither.
   */
  | {
      type: 'display'
      turnId?: string
      text: string
      at: number
      evidenceIds?: readonly MemoryEntryId[]
      sources?: readonly MemoryReference[]
    }
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
   * never enters Session continuity.
   */
  | { type: 'steer'; turnId: string; text: string; at: number }
  /**
   * The run's current headline (ADR 0025, carried by the Run Plan since
   * #116): the orchestrator's one-line statement of what the Run is doing
   * now, emitted when a tool round's plan report changes it — never
   * repeated for an unchanged value. Detail event — maps to no history
   * entry; the Peek Card's live title is its one consumer.
   */
  | { type: 'run_headline'; turnId: string; text: string; at: number }
  /**
   * The Run's current plan (#116, ADR 0027): objective, Run Headline,
   * and Effort Tier — emitted when a tool round's report_run_plan call
   * establishes or changes it, and once for the fallback Lookup plan a
   * run without a valid first plan runs under. Detail event — maps to
   * no history entry; runtime policy, telemetry, and the history
   * recorder are its consumers.
   */
  | {
      type: 'run_plan'
      turnId: string
      objective: string
      /** Null while the Command Echo stands in (the fallback plan). */
      headline: string | null
      effortTier: EffortTier
      source: 'model' | 'fallback'
      escalationReason?: string
      at: number
    }
  /** A subagent's state changed — the dashboard keeps one card per agent id. */
  | { type: 'agent_update'; agent: SubagentCard; at: number }
  /**
   * A delegated worker stopped (#162): why one Subagent's loop ended, in
   * the same Finalization Cause vocabulary a Run's `done` carries.
   * Diagnostic — it maps to no history entry and no user-facing surface;
   * it exists so a worker's outcome is measurable, and it is stamped with
   * the spawning turn because turn-scoped extraction is the only thing the
   * eval corpus can see. One per finished agent, whatever ended it: a
   * worker the parent Run's own Finalization cancelled reached no cause of
   * its own, and `status` — not a missing event — is how that reads, so a
   * run that delegated three workers and killed all three never measures
   * as a run that delegated none.
   */
  | {
      type: 'subagent_finalized'
      turnId: string
      agentId: string
      kind: SubagentKind
      status: SubagentStatus
      /** Absent unless the worker finalized itself into a report. */
      cause?: FinalizationCause
      at: number
    }
  /**
   * The run's boundary (#110): `outcome` stays the mechanical result, and
   * the semantic fields ride along additively — present only when known
   * (`resolution` when a validated model proposal exists,
   * `finalizationCause` whenever the run finalized with a known cause:
   * a model Answer or a mechanical stop). Cancelled, plain-error, and
   * reset runs carry neither.
   */
  | {
      type: 'done'
      turnId: string
      outcome?: 'done' | 'failed' | 'cancelled' | 'reset'
      resolution?: RunResolution
      finalizationCause?: FinalizationCause
      at: number
    }
  /**
   * Identity-bearing Session lifecycle boundaries (#91): emitted by the
   * Session runtime's window wiring, never by the pipeline generator. A
   * start never clears anything — consumers clear on a matching
   * `session_ended` and reject events of an ended or foreign Session.
   */
  | { type: 'session_started'; sessionId: SessionId; sessionGeneration: SessionGeneration; at: number }
  | { type: 'session_expiring'; sessionId: SessionId; sessionGeneration: SessionGeneration; expiresAt: number; at: number }
  | { type: 'session_extended'; sessionId: SessionId; sessionGeneration: SessionGeneration; expiresAt: number; at: number }
  | { type: 'session_ended'; sessionId: SessionId; sessionGeneration: SessionGeneration; reason: 'lapsed' | 'reset' | 'app_closed' | 'interrupted'; at: number }
)

/**
 * Derives a run's outcome when its `done` event omits one: a seen cancelled
 * status wins, else any error means failed, else the run succeeded. A
 * model-invoked Session Reset (#99) is recorded as interrupted — the
 * discarded run never finished its own work. Shared by every observer of
 * the run event seam.
 */
export function inferRunOutcome(
  explicit: 'done' | 'failed' | 'cancelled' | 'reset' | undefined,
  lastStatus: string | null,
  sawError: boolean,
): RunOutcomeSummary {
  if (explicit === 'reset') return 'interrupted'
  return explicit ?? (lastStatus === 'cancelled' ? 'cancelled' : sawError ? 'failed' : 'done')
}

/** The outcome shapes every run observer understands. */
export type RunOutcomeSummary = 'done' | 'failed' | 'cancelled' | 'interrupted'

/**
 * A pipeline event before turn stamping (#28): the run body constructs
 * events without knowing the turn id; `execute` stamps every one of them on
 * the way out, which is the single place a stamp can be missed. Named here
 * so the Run's seams (#156) can declare what they yield.
 */
type WithoutTurnId<T> = T extends unknown ? Omit<T, 'turnId'> : never
export type UnstampedEvent = WithoutTurnId<PipelineEvent>
