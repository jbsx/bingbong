import { inferRunOutcome, type PipelineEvent } from '../pipeline/events'

// The Peek Card state fold (ADR 0021, amended by ADR 0026): voice never
// opens the feed panel — a command shows the Peek Card instead, as a pure
// fold over the same pipeline event seam every observer rides (the same
// shape as the panel-state fold beside it). The card reports the live Run
// and then its Answer, persisting until the next Run, a panel open, or
// the Session's end — no time window. The view owns what renders inside
// the card; this fold owns only the phase, the run identity, and the
// answer's retirement.

export type PeekCardPhase = 'hidden' | 'live' | 'answer'

export interface PeekCardState {
  phase: PeekCardPhase
  /** The run the card reports — the view matches feed entries by it. */
  runId: string | null
  /** The command echo shown while live. */
  commandText: string | null
  /**
   * The Run Headline (ADR 0025): once the orchestrator reports one, it is
   * the live title and the echo stands down. Null until then and across
   * runs — each run starts on its own echo.
   */
  headline: string | null
}

const HIDDEN: PeekCardState = { phase: 'hidden', runId: null, commandText: null, headline: null }

/**
 * Folds pipeline events into the card's phase: `command` shows it live,
 * the run's `done` moves it to the persisting answer (a cancelled or
 * interrupted run hides it), `session_ended` hides it, and a new command
 * always restarts it live. Busy rejections emit no events, so they never
 * show a card.
 */
export function createPeekCardFold(): {
  onEvent(event: PipelineEvent): void
  /**
   * The renderer's hide when the panel opens: it retires the answer — the
   * user saw it up close — while the live report survives (ADR 0026), so
   * closing the panel again revives the card.
   */
  retireAnswer(): void
  state(): PeekCardState
} {
  let state: PeekCardState = HIDDEN
  // The run-end outcome fork feeds inferRunOutcome (the same derivation
  // every run observer rides): a `done` may omit its outcome, and the
  // status/error trail of the reported run is the fallback.
  let lastStatus: string | null = null
  let sawError = false

  const hide = (): void => {
    state = HIDDEN
    lastStatus = null
    sawError = false
  }
  const fromReportedRun = (event: { runId?: string; turnId?: string }): boolean =>
    state.phase !== 'hidden' && (event.runId ?? event.turnId) === state.runId

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          state = {
            phase: 'live',
            runId: event.runId ?? event.turnId,
            commandText: event.text,
            headline: null,
          }
          lastStatus = null
          sawError = false
          return
        case 'status':
          if (fromReportedRun(event)) lastStatus = event.status
          return
        case 'error':
          // Only the reported run's errors count toward its outcome — an
          // out-of-turn error from unrelated activity never fails it.
          if (fromReportedRun(event)) sawError = true
          return
        // The Run Headline (ADR 0025) revises the live title — corrections
        // reach the eye without opening the panel. Only the run the card
        // reports can retitle it, and outside the live run nothing changes:
        // the answer is what shows then.
        case 'run_headline':
          if (state.phase === 'live' && (event.runId ?? event.turnId) === state.runId) {
            state = { ...state, headline: event.text }
          }
          return
        case 'done': {
          if (state.phase === 'hidden') return
          // The outcome fork (ADR 0026): done and failed persist as the
          // card's answer; cancelled and interrupted hide it — an abort is
          // the user's last word, and the screen goes quiet.
          const outcome = inferRunOutcome(event.outcome, lastStatus, sawError)
          if (outcome === 'cancelled' || outcome === 'interrupted') hide()
          else state = { ...state, phase: 'answer' }
          return
        }
        case 'session_ended':
          if (state.phase !== 'hidden') hide()
          return
        default:
          return
      }
    },
    retireAnswer() {
      if (state.phase === 'answer') hide()
    },
    state: () => state,
  }
}

/**
 * The visible/hidden decision, separated from the fold so the renderer's
 * panel-open fact can suppress the card without touching its state (ADR
 * 0026: the live report survives an open panel — closing it revives the
 * card).
 */
export function peekCardVisible(state: PeekCardState): boolean {
  return state.phase !== 'hidden'
}
