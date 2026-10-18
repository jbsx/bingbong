import type { FeedEntry } from '../feed/feedProjection'
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
}

const HIDDEN: PeekCardState = { phase: 'hidden', runId: null, commandText: null }

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
  // The Task the reported run belongs to (#328): its closing hop that fires
  // nothing (done, no next step, not read) is not a Command of its own, so
  // the card stays on the hop that answered (#329).
  let taskId: string | null = null

  const hide = (): void => {
    state = HIDDEN
    lastStatus = null
    sawError = false
    taskId = null
  }
  const fromReportedRun = (event: { runId?: string; turnId?: string }): boolean =>
    state.phase !== 'hidden' && event.turnId === state.runId

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          if (event.dropped && event.task !== undefined && event.task.hop > 0 && event.task.id === taskId && state.phase !== 'hidden') return
          taskId = event.task?.id ?? null
          state = {
            phase: 'live',
            runId: event.turnId,
            commandText: event.text,
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
        case 'done': {
          if (state.phase === 'hidden') return
          // The outcome fork (ADR 0026): done and failed persist as the
          // card's answer; cancelled and interrupted hide it — an abort is
          // the user's last word, and the screen goes quiet.
          const outcome = inferRunOutcome(event.outcome, lastStatus, sawError)
          if (outcome === 'cancelled') hide()
          else state = { ...state, phase: 'answer' }
          return
        }
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

/** What the card shows as its Answer, and whether it tells a failure (#329): the mark then takes the failure colour. */
export interface PeekCardAnswer {
  kind: 'display' | 'spoken' | 'error'
  text: string
  failure: boolean
}

/**
 * The reported Command's Answer (#329) — its Card when it has one, else its
 * failure line, else its Spoken Rendering — read only from the entries its
 * own turn stamped, so a Command with no Answer of its own shows none
 * rather than a neighbour's. Null when it has none: the view says it is
 * done.
 */
export function peekCardAnswer(entries: readonly FeedEntry[], turnId: string | null): PeekCardAnswer | null {
  if (turnId === null) return null
  let error: FeedEntry | null = null
  let spoken: FeedEntry | null = null
  for (const entry of entries) {
    if (entry.turnId !== turnId) continue
    if (entry.role === 'assistant' && entry.kind === 'display') return { kind: 'display', text: entry.text, failure: entry.failure === true }
    if (entry.role === 'system' && entry.kind === 'error') error ??= entry
    if (entry.role === 'assistant' && entry.kind === 'speak') spoken ??= entry
  }
  if (error !== null) return { kind: 'error', text: error.text.split('\n', 1)[0]!, failure: true }
  return spoken !== null ? { kind: 'spoken', text: spoken.text, failure: spoken.failure === true } : null
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

/**
 * The overlay slot's one element (ADR 0029): a native view intercepts
 * input across its whole bounds, so the overlay shows exactly one of the
 * expanded panel, the Peek Card, or the collapsed edge tab — the card
 * replaces the tab while visible, and an open panel outranks both. Both
 * renderers derive from this one rule: the dashboard sizes the slot by
 * it, the overlay renders by it, so geometry and content cannot diverge.
 */
export type OverlaySlotContent = 'panel' | 'card' | 'tab'

export function overlaySlotContent(panelOpen: boolean, peek: PeekCardState): OverlaySlotContent {
  if (panelOpen) return 'panel'
  return peekCardVisible(peek) ? 'card' : 'tab'
}
