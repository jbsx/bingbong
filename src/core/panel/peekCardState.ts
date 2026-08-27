import type { PipelineEvent } from '../pipeline/events'

// The Peek Card state fold (ADR 0021): voice never opens the feed panel —
// a command shows the transient Peek Card instead, as a pure fold over the
// same pipeline event seam every observer rides (the same shape as the
// panel-state fold beside it). The card reports the live Run and then its
// Answer, lingering a fixed window past `done` (out-of-turn announcements
// reset the anchor — content landing while you read never yanks the card).
// The view owns what renders inside the card and the hover pin; this fold
// owns only the phase, the run identity, and the linger anchor.

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
  /** Wall-clock anchor of the latest activity — the answer linger counts from it. */
  anchoredAt: number
}

/** How long the Answer stays up after `done` (or its latest announcement). */
export const PEEK_CARD_LINGER_MS = 8_000

const HIDDEN: PeekCardState = { phase: 'hidden', runId: null, commandText: null, headline: null, anchoredAt: 0 }

/**
 * Folds pipeline events into the card's phase: `command` shows it live,
 * the run's `done` moves it to the lingering answer, `session_ended` hides
 * it, and a new command always restarts it live. Busy rejections emit no
 * events, so they never show a card.
 */
export function createPeekCardFold(): {
  onEvent(event: PipelineEvent): void
  /** The renderer's explicit hide — opening the panel dismisses the card. */
  dismiss(): void
  state(): PeekCardState
} {
  let state: PeekCardState = HIDDEN

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          state = {
            phase: 'live',
            runId: event.runId ?? event.turnId,
            commandText: event.text,
            headline: null,
            anchoredAt: event.at,
          }
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
        case 'done':
          if (state.phase !== 'hidden') state = { ...state, phase: 'answer', anchoredAt: event.at }
          return
        // Out-of-turn announcements during the linger are new content for
        // the reading eye — the anchor moves, the card stays.
        case 'speak':
        case 'display':
        case 'error':
          if (state.phase === 'answer') state = { ...state, anchoredAt: event.at }
          return
        case 'session_ended':
          if (state.phase !== 'hidden') state = HIDDEN
          return
        default:
          return
      }
    },
    dismiss() {
      if (state.phase !== 'hidden') state = HIDDEN
    },
    state: () => state,
  }
}

/** The visible/hidden decision, separated from the fold so the hover pin and the renderer's clock can hold the card past its anchor. */
export function peekCardVisible(state: PeekCardState, now: number): boolean {
  if (state.phase === 'live') return true
  if (state.phase === 'answer') return now < state.anchoredAt + PEEK_CARD_LINGER_MS
  return false
}
