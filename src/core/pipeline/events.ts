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
 * with its `done` like any other; nothing else follows it. Every `command`
 * carries its Task (#328): hop 0's turn id and which hop it is; past the
 * first, the Progress Noul's probability that the last action helped (#373).
 * `keepsIdle` marks a Command whose verb never touches the pane (the
 * Timer, a Stop): it leaves the Idle Screen up, as a dropped one does.
 */
export type PipelineEvent =
  | { type: 'command'; turnId: string; text: string; action?: string; dropped?: boolean; keepsIdle?: boolean; task?: { id: string; hop: number; step?: number; of?: number; progress?: number }; at: number }
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
  /** `failure`: the line tells what went wrong (#329) — a thrown action, a wall — and takes the failure colour. */
  | { type: 'speak'; turnId?: string; text: string; failure?: boolean; at: number }
  /**
   * A Command's Answer (#333), one per Command; `failure` as on `speak` — a failure's line is its Answer, shown once.
   * `muted`: a Stop's Answer — the Command was cancelled, neither done nor failed, and reads grey.
   */
  | { type: 'display'; turnId?: string; text: string; failure?: boolean; muted?: boolean; at: number }
  | { type: 'error'; turnId?: string; message: string; at: number }
  | { type: 'done'; turnId: string; outcome?: 'done' | 'failed' | 'cancelled'; at: number }
  /**
   * The page spoke for itself (#423), outside any turn: a Site Question
   * (its native confirm) waiting for the user's next line, or, `alert`, an
   * alert the pane accepted. `text` is the line the app says.
   */
  | { type: 'site_question'; text: string; alert?: true; at: number }

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
