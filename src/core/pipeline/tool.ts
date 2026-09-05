import type { ToolCall } from '../ports/llm'
import type { Clock } from '../ports/clock'
import type { SubagentSharedDeadline, VisionGrant } from '../agent/subagentRails'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import type { SubagentReasoningTrace } from '../trace/reasoningTrace'
import type { EffortTier } from './runPlan'
import type { CandidateCheckpointOutcome } from './candidateCheckpoint'
import type { EvidenceCheckpointOutcome } from './evidenceCheckpoint'

export interface ToolContext {
  clock: Clock
  /** Consume one call only when a conditional tool actually falls back to vision. */
  acquireVision?(): VisionGrant
  /**
   * The running turn's correlation id (#29): tools that fan out work
   * (spawn_agent starts subagent LLM loops) key it to the turn so their
   * model rounds land in the turn's perf spans.
   */
  turnId?: string
  /**
   * The Run's live Effort Tier (#120, ADR 0027): the current tier epoch
   * the pipeline is executing under. Delegation reads it — browse
   * subagents exist only for Investigation branches.
   */
  effortTier?(): EffortTier
  /**
   * The Run's shared active-work deadline (#120): handed to delegated
   * workers, who stop acquiring when the parent's work time is gone,
   * however many of their own rounds remain.
   */
  delegationDeadline?: SubagentSharedDeadline
  /**
   * The reasoning records for delegated workers (#183, ADR 0031): what a
   * spawned worker's rounds write their thinking through, already closed
   * over this Run's trace writer and turn — so a worker's reasoning joins
   * the Run that delegated it. Absent unless the developer opted in with
   * `BINGBONG_RUN_TRACE` (#184); delegation then hands workers nothing and
   * no worker reasoning is collected.
   */
  traceSubagentReasoning?: SubagentReasoningTrace
  /**
   * Progress detail (#43): a tool that blocks on observable background
   * work (agent_results with wait) reports what the run is waiting on,
   * with the running count at wait start. Reaches the dashboard on the
   * detail channel while the tool is still in flight.
   */
  waitingOnAgents?(running: number): void
  /**
   * Delegation's memory selection (#98): picks the given entry ids out of
   * this Run's immutable Working Memory snapshot, bounded and validated.
   * Absent when the run carries no continuity (fresh spawns share nothing
   * by design; the store is never exposed whole).
   */
  selectMemoryEntries?(ids: readonly string[]): WorkingMemorySnapshot
  /**
   * The Run's Evidence Checkpoint seam (#121, ADR 0028): validates one
   * record_evidence call against the Run's Observation ledger — the cited
   * source must have been observed this Run, the excerpt must appear in
   * what that observation retained — and commits the grounded Observation
   * into Session Evidence when it holds. Absent when the run carries no
   * evidence continuity; the tool then fails recoverably.
   */
  checkpointEvidence?(call: ToolCall): EvidenceCheckpointOutcome
  /**
   * The Run's Candidate Checkpoint seam (#122, ADR 0028): validates one
   * record_candidate call against the live Session store — support must
   * cite live Session Evidence Observations — and creates the Candidate
   * or records its terminal decision with preserved provenance. Absent
   * when the run carries no evidence continuity; the tool then fails
   * recoverably.
   */
  checkpointCandidate?(call: ToolCall): CandidateCheckpointOutcome
}

/** Parameter description for the tool catalog sent to the model. */
export interface ToolParameterSpec {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description: string
  enum?: string[]
  /** Element spec for array parameters (delegation's memory_ids, #98). */
  items?: { type: 'string' }
  /** Defaults to true; false keeps the property optional in the model schema. */
  required?: boolean
}

/**
 * Models send numbers as strings ("2") often enough that every numeric arg
 * passes through this coercion (media seek established it): a non-empty
 * string becomes its Number, anything else passes through; the result is
 * undefined unless it is a finite number. Callers layer their own bounds.
 */
export function coercedNumber(value: unknown): number | undefined {
  const coerced = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof coerced === 'number' && Number.isFinite(coerced) ? coerced : undefined
}

/**
 * Risk-gate verdict for a single tool call, decided in code (never by the
 * model): 'allow' runs immediately, 'confirm' blocks on a user confirmation
 * showing the prompt, 'deny' never runs — the reason goes back to the model
 * as the tool result so it can explain the refusal.
 */
export type RiskVerdict =
  | { kind: 'allow' }
  | { kind: 'confirm'; prompt: string }
  | { kind: 'deny'; reason: string }

export interface Tool {
  name: string
  /** Each execution consumes one call from the per-task vision budget. */
  usesVision?: boolean
  /**
   * An acquisition tool (#117, ADR 0027): browser, vision, media, or
   * delegation work that gathers evidence or changes external state.
   * Finalization closes these — only Run Plan bookkeeping and
   * record_evidence remain available once a Run's work budget is spent.
   */
  acquisition?: boolean
  /**
   * Offer this tool only in LLM rounds that carry prior Session continuity
   * (spec #24). Rounds without continuity keep today's exact catalog — the
   * provider's empty-completion bug scales with prompt size, and the tool
   * list is the biggest lever. new_session is the current example.
   */
  requiresHistory?: boolean
  /** What the tool does, shown to the model in the tool catalog. */
  description?: string
  /** Declared parameters; all of them are required when calling. */
  parameters?: Record<string, ToolParameterSpec>
  /**
   * Classify the risk of this specific call. Absent means always allow.
   * A throwing assessment is treated as 'confirm' (fail closed).
   */
  assessRisk?(call: ToolCall): RiskVerdict | Promise<RiskVerdict>
  /**
   * Declares an interactive ask: instead of execute, the pipeline shows and
   * speaks the returned question, waits for the user's free-text answer
   * (voice or typed), and reports it as the tool result.
   */
  askUser?(call: ToolCall): string
  /**
   * Declares a Session Reset boundary (#99): when a call of this tool
   * succeeds, the rest of its run is discarded — sibling calls from the
   * same response never execute, no later model round happens, nothing is
   * spoken or committed — and the run reports outcome 'reset' so the
   * command runner can end the old Session and restart the original
   * command as fresh work under a new one.
   */
  sessionReset?: boolean
  execute(call: ToolCall, ctx: ToolContext): Promise<unknown>
}
