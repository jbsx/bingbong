import type { FeedEntry } from '../feed/feedProjection'
import { inferRunOutcome, type PipelineEvent } from '../pipeline/events'

// The Peek Card state fold (ADR 0021, amended by ADR 0026): voice never
// opens the feed panel — a command shows the Peek Card instead, as a pure
// fold over the same pipeline event seam every observer rides (the same
// shape as the panel-state fold beside it). The card reports the live Run
// and then its Answer, until 15 s past the Answer's spoken sentence (#470,
// ADR 0026 as amended) or sooner on the next Run or a panel open. The view
// owns what renders inside the card; this fold owns only the phase, the
// run identity, and the answer's retirement.

/**
 * How long the Answer stays past its sentence (#470): one constant for every
 * form of the card. The owner's guess (2026-10-26 grill) — no measure in
 * the repo can settle 10 s against 15 s; what would is the owner reading a
 * failure from the chair on a normal day and saying the card went too soon
 * or stayed too long.
 */
export const PEEK_CARD_LINGER_MS = 15_000

export type PeekCardPhase = 'hidden' | 'live' | 'answer'

export interface PeekCardState {
  phase: PeekCardPhase
  /** The run the card reports — the view matches feed entries by it. */
  runId: string | null
  /** The command echo shown while live. */
  commandText: string | null
  /** When the Answer goes, on the events' clock (#470): null while live, hidden, or while its sentence still sounds. */
  retiresAt: number | null
  /** The line was read as no Command: its Answer is "No response." (the Idle Screen form shows it). */
  dropped?: true
}

const HIDDEN: PeekCardState = { phase: 'hidden', runId: null, commandText: null, retiresAt: null }

/**
 * Folds pipeline events into the card's phase: `command` shows it live,
 * the run's `done` moves it to the answer (a cancelled or interrupted run
 * hides it), and a new command always restarts it live. The answer's end is
 * 15 s past the later of `done` and the end of the run's last sentence; a
 * sentence still sounding holds it off. Busy rejections emit no events, so
 * they never show a card.
 */
export function createPeekCardFold(): {
  onEvent(event: PipelineEvent): void
  /**
   * The renderer's hide when the panel opens: it retires the answer — the
   * user saw it up close — while the live report survives (ADR 0026), so
   * closing the panel again revives the card.
   */
  retireAnswer(): void
  /** The answer's time is up at `now` (#470): it goes. Nothing else does. */
  expire(now: number): void
  state(): PeekCardState
} {
  let state: PeekCardState = HIDDEN
  // The run-end outcome fork feeds inferRunOutcome (the same derivation
  // every run observer rides): a `done` may omit its outcome, and the
  // status/error trail of the reported run is the fallback.
  let lastStatus: string | null = null
  let sawError = false
  // The reported run's sentences still sounding, and when the run, or its last sentence, last fell quiet.
  let sounding = 0
  let quietAt = 0

  const hide = (): void => {
    state = HIDDEN
    lastStatus = null
    sawError = false
    sounding = 0
  }
  const reschedule = (): void => {
    if (state.phase === 'answer') state = { ...state, retiresAt: sounding > 0 ? null : quietAt + PEEK_CARD_LINGER_MS }
  }
  const fromReportedRun = (event: { runId?: string; turnId?: string }): boolean =>
    state.phase !== 'hidden' && event.turnId === state.runId

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          // A hop past the first that fires nothing (done, no next step, not read, abandoned) is no Command of its own (#336):
          // it never takes the card — not from its own Task's hop that answered, nor from a later Command's, whichever Task it is of.
          if (event.dropped && event.task !== undefined && event.task.hop > 0) return
          state = {
            phase: 'live',
            runId: event.turnId,
            commandText: event.text,
            retiresAt: null,
            ...(event.dropped === true ? { dropped: true as const } : {}),
          }
          lastStatus = null
          sawError = false
          sounding = 0
          quietAt = event.at
          return
        case 'speak':
          if (!fromReportedRun(event)) return
          sounding += 1
          reschedule()
          return
        case 'spoken':
          if (!fromReportedRun(event) || sounding === 0) return
          sounding -= 1
          quietAt = Math.max(quietAt, event.at)
          reschedule()
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
          // Only the reported run's own end moves the card (#336): a Task's closing hop — abandoned, done or no next step — ends a turn the card never reported.
          if (!fromReportedRun(event)) return
          // The outcome fork (ADR 0026): done and failed show as the
          // card's answer; cancelled and interrupted hide it — an abort is
          // the user's last word, and the screen goes quiet.
          const outcome = inferRunOutcome(event.outcome, lastStatus, sawError)
          if (outcome === 'cancelled') return hide()
          state = { ...state, phase: 'answer' }
          quietAt = Math.max(quietAt, event.at)
          reschedule()
          return
        }
        default:
          return
      }
    },
    retireAnswer() {
      if (state.phase === 'answer') hide()
    },
    expire(now) {
      if (state.phase === 'answer' && state.retiresAt !== null && now >= state.retiresAt) hide()
    },
    state: () => state,
  }
}

/** What the card shows as its Answer, and whether it tells a failure (#329): the mark then takes the failure colour. */
export interface PeekCardAnswer {
  kind: 'display' | 'spoken' | 'error'
  text: string
  failure: boolean
  /** A Stop's Answer: the mark is grey, neither done nor failed. */
  muted?: true
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
    if (entry.role === 'assistant' && entry.kind === 'display') return { kind: 'display', text: entry.text, failure: entry.failure === true, ...(entry.muted ? { muted: true as const } : {}) }
    if (entry.role === 'system' && entry.kind === 'error') error ??= entry
    if (entry.role === 'assistant' && entry.kind === 'speak') spoken ??= entry
  }
  if (error !== null) return { kind: 'error', text: error.text.split('\n', 1)[0]!, failure: true }
  return spoken !== null ? { kind: 'spoken', text: spoken.text, failure: spoken.failure === true } : null
}

/**
 * The Answer the card shows over the Idle Screen (#470), or null for none:
 * only a failure or a line read as no Command ("No response."). A success
 * shows none — its own card on the screen says it (the Timer Clock, Now
 * Playing) — and a Stop is neutral (#334).
 */
export function peekCardOnIdleScreen(state: PeekCardState, answer: PeekCardAnswer | null): PeekCardAnswer | null {
  if (state.phase !== 'answer' || answer === null) return null
  return answer.failure || (state.dropped === true && answer.muted === true) ? answer : null
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
 * replaces the tab while visible, and an open panel outranks both. The
 * Weigh-in pop-up (#350) never takes the slot: collapsed, it has a view of
 * its own in the card's place, so the edge tab stays; over an open panel it
 * rides the panel's top. Both renderers derive from this one rule: the
 * dashboard sizes the slot by it, the overlay renders by it, so geometry and
 * content cannot diverge.
 */
export type OverlaySlotContent = 'panel' | 'card' | 'tab'

export function overlaySlotContent(panelOpen: boolean, peek: PeekCardState): OverlaySlotContent {
  if (panelOpen) return 'panel'
  return peekCardVisible(peek) ? 'card' : 'tab'
}
