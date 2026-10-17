export type PipelineStatus = 'thinking' | 'acting' | 'speaking' | 'cancelled'

/**
 * The command stream every observer rides — the Feed, the Peek Card, the
 * Status Capsule, the voice session. One id per turn: every event a run
 * yields is stamped with that turn's `turnId`. `speak`/`display`/`error`
 * carry it optionally — the download router announces outside any turn.
 *
 * This is the stripped shape (kachow): a command, its stages, the browser
 * actions it took, what it showed and said, and its end. Whatever drives
 * the browser publishes through it.
 *
 * A `command` is one Command (#324, ADR 0076): the words heard and, once
 * read, the action taken — the Feed's one entry per Command. An Utterance
 * read as no Command is published `dropped`, the words alone, and ends
 * with its `done` like any other; nothing else follows it.
 */
export type PipelineEvent =
  | { type: 'command'; turnId: string; text: string; action?: string; dropped?: boolean; at: number }
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
  | { type: 'speak'; turnId?: string; text: string; at: number }
  | { type: 'display'; turnId?: string; text: string; at: number }
  | { type: 'error'; turnId?: string; message: string; at: number }
  | { type: 'done'; turnId: string; outcome?: 'done' | 'failed' | 'cancelled'; at: number }

/**
 * Derives a run's outcome when its `done` event omits one: a seen cancelled
 * status wins, else any error means failed, else the run succeeded.
 */
export function inferRunOutcome(
  explicit: 'done' | 'failed' | 'cancelled' | undefined,
  lastStatus: string | null,
  sawError: boolean,
): RunOutcomeSummary {
  return explicit ?? (lastStatus === 'cancelled' ? 'cancelled' : sawError ? 'failed' : 'done')
}

/** The outcome shapes every run observer understands. */
export type RunOutcomeSummary = 'done' | 'failed' | 'cancelled'
