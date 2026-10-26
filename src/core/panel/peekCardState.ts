import type { FeedEntry } from '../feed/feedProjection'
import { inferRunOutcome, type PipelineEvent } from '../pipeline/events'
import { stageEntered, type RunProgress } from '../pipeline/runProgress'
import { STAGE_WORDS, stageWord } from '../pipeline/stageWords'
import type { VoiceHeardEvent, VoicePartialEvent, VoiceState } from '../voice/ipcChannels'
import { earPhase } from '../voice/voicePrompt'

// The Peek Card state fold (ADR 0021, amended by ADR 0026): voice never
// opens the feed panel — a command shows the Peek Card instead, as a pure
// fold over the same pipeline event seam every observer rides (the same
// shape as the panel-state fold beside it). The card opens on the wake
// (#475) — the ear opening for an Utterance, or a typed line's Thinking —
// reports the live Run and then its Answer, until 15 s past the Answer's
// spoken sentence (#470, ADR 0026 as amended) or sooner on the next line
// or a panel open. The fold owns the phase, the run identity, the answer's
// retirement and the turn's ledger (#475): every step of the turn as a
// row, with the words of the moment read from it. The view owns the
// drawing.

/**
 * How long the Answer stays past its sentence (#470): one constant for every
 * form of the card. The owner's guess (2026-10-26 grill) — no measure in
 * the repo can settle 10 s against 15 s; what would is the owner reading a
 * failure from the chair on a normal day and saying the card went too soon
 * or stayed too long.
 */
export const PEEK_CARD_LINGER_MS = 15_000

/** `listening` (#475): the ear is open for a line and no Command has begun — the card's first face, before any turn id. */
export type PeekCardPhase = 'hidden' | 'listening' | 'live' | 'answer'

/** The ear's face on the card (#475), while it bears on the turn: open, hearing the line, or reading it; null once the line is in. */
export type LedgerEar = 'listening' | 'hearing' | 'transcribing' | null

/** The rail's stations (#475), in order: the line in, then each stage of its Command, then its end. */
export type RailStation = 'heard' | 'thinking' | 'acting' | 'loading' | 'speaking' | 'done'
export const RAIL_STATIONS: readonly RailStation[] = ['heard', 'thinking', 'acting', 'loading', 'speaking', 'done']

/** A row's colour, by what it says: a live step, a quiet one (the ear's, a wait), an end that went well or badly, or a Stop's grey. */
export type LedgerTone = 'live' | 'quiet' | 'ok' | 'fail' | 'muted'

/** One step of the turn (#475): when it came, its label (the stage's word, the ear's face, the reading) and what it was on. */
export interface LedgerRow {
  readonly at: number
  readonly label: string
  readonly text: string
  readonly tone: LedgerTone
}

/** The Command's stage as the ledger holds it (#475): the Capsule's own reading of it (`RunProgress`) — the stage, when it began, its hop, and Acting's word and object, carried into Loading. */
export type LedgerStage = RunProgress

/** The turn's ledger (#475): every step so far and the facts the words of the moment are read from. */
export interface TurnLedger {
  /** When the turn began — the ear's opening, or the typed line's Thinking — the clock every row and the finished total are read against. */
  readonly startedAt: number | null
  readonly ear: LedgerEar
  /** When the ear's face began, on main's clock (`VoiceState.since`): the seconds while it reads. */
  readonly earSince: number | null
  /** The live partial while the ear hears; the last words once the Endpoint fired. */
  readonly partial: string
  readonly lastWords: string
  /** The final transcript, once heard. */
  readonly heard: string | null
  readonly stage: LedgerStage | null
  /** The Command's action as read (`command.action`), or "no command". */
  readonly reading: string | null
  /** The sentence being said, and whether it tells a failure. */
  readonly said: { readonly text: string; readonly failure: boolean } | null
  /** The Command's Answer (`display`), shown as the words once done. */
  readonly answer: { readonly text: string; readonly failure: boolean; readonly muted: boolean } | null
  readonly outcome: 'done' | 'failed' | 'muted' | null
  readonly doneAt: number | null
  /** The stations the turn passed, in order: one the turn skipped stays unlit. */
  readonly stations: readonly RailStation[]
  readonly rows: readonly LedgerRow[]
}

export const EMPTY_LEDGER: TurnLedger = {
  startedAt: null,
  ear: null,
  earSince: null,
  partial: '',
  lastWords: '',
  heard: null,
  stage: null,
  reading: null,
  said: null,
  answer: null,
  outcome: null,
  doneAt: null,
  stations: [],
  rows: [],
}

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
  /** The turn's ledger (#475). */
  ledger: TurnLedger
}

const HIDDEN: PeekCardState = { phase: 'hidden', runId: null, commandText: null, retiresAt: null, ledger: EMPTY_LEDGER }

/** The rail's live station (#475): the last the turn reached, or none before the line is in. */
export function railStation(ledger: TurnLedger): RailStation | null {
  return ledger.stations.length === 0 ? null : ledger.stations[ledger.stations.length - 1]!
}

const quoted = (words: string): string => `“${words}”`

/** The rows the ear writes (#475), which the Heard row follows. */
const EAR_ROWS: ReadonlySet<string> = new Set(['Listening', 'Transcribing', 'Heard', 'Typed'])

/** An Answer's words as the band says them (#475): the Card's markdown marks dropped, one paragraph. */
export function plainAnswer(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
}

/**
 * Folds pipeline events and the ear's state into the card's phase and the
 * turn's ledger. The ear opening for a line shows the card Listening
 * (#475); a line's Thinking, or its `command`, takes it live on that turn;
 * the run's `done` moves it to the answer (a cancelled or interrupted run
 * hides it); a new line — speech beginning, a typed line's Thinking, a
 * `command` — always restarts it. An ear that closes with nothing heard
 * closes the card. The answer's end is 15 s past the later of `done` and
 * the end of the run's last sentence; a sentence still sounding holds it
 * off. Busy rejections emit no events, so they never show a card.
 */
export function createPeekCardFold(): {
  onEvent(event: PipelineEvent): void
  /** The ear's state as main publishes it (#475), and the renderer's clock for a state with no `since`. */
  onVoice(voice: VoiceState, now: number): void
  /** The live partial while the ear hears (#475). */
  onPartial(partial: VoicePartialEvent): void
  /** The transcript heard and where it went (#475). */
  onHeard(heard: VoiceHeardEvent & { at: number }): void
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
  // A heard line routed to a Command whose Thinking has not come yet: the ear closing meanwhile leaves the card up (#475).
  let heardPending = false
  // The ear's last face, whatever the card's phase (#475): a Hot Listen open past the Answer is not a wake, and only a change of face moves the card.
  let lastEar: LedgerEar = null

  const hide = (): void => {
    state = HIDDEN
    lastStatus = null
    sawError = false
    sounding = 0
    heardPending = false
  }
  const reschedule = (): void => {
    if (state.phase === 'answer') state = { ...state, retiresAt: sounding > 0 ? null : quietAt + PEEK_CARD_LINGER_MS }
  }
  const fromReportedRun = (event: { runId?: string; turnId?: string }): boolean =>
    state.phase !== 'hidden' && event.turnId === state.runId
  const ledger = (): TurnLedger => state.ledger
  const patch = (change: Partial<TurnLedger>): void => {
    state = { ...state, ledger: { ...state.ledger, ...change } }
  }
  const row = (at: number, label: string, text: string, tone: LedgerTone = 'live'): void => {
    patch({ rows: [...ledger().rows, { at, label, text, tone }] })
  }
  const reach = (station: RailStation): void => {
    if (railStation(ledger()) !== station) patch({ stations: [...ledger().stations, station] })
  }
  /** A fresh turn (#475): the ledger emptied, started at `at`, the line's words as its first row when they are already known. */
  const open = (phase: PeekCardPhase, at: number, change: Partial<TurnLedger> = {}): void => {
    state = { ...state, phase, runId: null, commandText: null, retiresAt: null, ledger: { ...EMPTY_LEDGER, startedAt: at, ...change } }
    delete state.dropped
    lastStatus = null
    sawError = false
    sounding = 0
    heardPending = false
  }
  /** The line's first Thinking (#475): a new turn — a typed line's words as its Typed row — or the spoken line's own turn going live. */
  const beginTurn = (event: Extract<PipelineEvent, { type: 'status' }>): void => {
    if (state.phase === 'listening') {
      state = { ...state, phase: 'live', runId: event.turnId }
      heardPending = false
      return
    }
    open('live', event.at)
    state = { ...state, runId: event.turnId }
    if (event.detail !== undefined && event.detail !== '') {
      row(event.at, 'Typed', quoted(event.detail))
      reach('heard')
    }
  }

  return {
    onVoice(voice, now) {
      const phase = earPhase(voice)
      const ear: LedgerEar = phase === 'listening' || phase === 'hearing' || phase === 'transcribing' ? phase : null
      const was = lastEar
      lastEar = ear
      if (ear === was) return
      const since = voice.since ?? now
      // The wake (#475): an ear opening from rest, or speech beginning in an ear already open (a Hot Listen's next line, #472), is a new line.
      // A finished turn's ledger is never touched by the ear: a line read after its Early Fire (#326) reports on the Capsule, not here.
      const opened = ear === 'listening' && was === null
      const spoke = ear === 'hearing' && was !== 'hearing'
      if (state.phase === 'hidden' || state.phase === 'answer' ? opened || spoke : state.phase === 'live' && spoke) {
        open('listening', since, { ear, earSince: since })
        row(since, 'Listening', ear === 'hearing' ? '…' : 'say a command', 'quiet')
        return
      }
      if (state.phase === 'hidden' || state.phase === 'answer') return
      if (ear === null) {
        // The ear shut (#475): with nothing routed to a Command, the card goes with it; a line in flight keeps it.
        patch({ ear: null, earSince: null })
        if (state.phase === 'listening' && !heardPending) hide()
        return
      }
      if (ear === 'transcribing') {
        const lastWords = ledger().partial !== '' ? ledger().partial : ledger().lastWords
        patch({ ear, earSince: since, lastWords, partial: '' })
        row(since, 'Transcribing', quoted(lastWords), 'quiet')
        return
      }
      patch({ ear, earSince: since })
      if (ear === 'hearing' && ledger().rows.at(-1)?.label === 'Listening' && ledger().partial === '') {
        // Speech confirmed before any word (#441): the receipt that the ear has the line.
        patch({ rows: [...ledger().rows.slice(0, -1), { ...ledger().rows.at(-1)!, text: '…' }] })
      }
    },
    onPartial(partial) {
      if (state.phase === 'hidden' || state.phase === 'answer' || partial.text === '') return
      const ear = ledger().ear
      if (ear !== 'listening' && ear !== 'hearing') return
      const last = ledger().rows.at(-1)
      const rows = last?.label === 'Listening' ? ledger().rows.slice(0, -1) : ledger().rows
      patch({ partial: partial.text, rows: [...rows, { at: last?.label === 'Listening' ? last.at : partial.at, label: 'Listening', text: quoted(`${partial.text}…`), tone: 'live' }] })
    },
    onHeard(heard) {
      if (heard.routed === 'ignored') {
        if (state.phase === 'listening') hide()
        return
      }
      // A line heard with no card up, or over a finished turn (its Early Fire already ran it, #326), opens nothing: its Thinking will, if it runs.
      if (heard.routed === 'abort' || state.phase === 'hidden' || state.phase === 'answer') return
      if (state.phase === 'listening') heardPending = true
      // Main says the line was heard after the Command it became has begun (the run's first steps are synchronous):
      // the Heard row still stands where it happened, after the ear's rows and before the Command's.
      const rows = ledger().rows
      let place = rows.length
      while (place > 0 && !EAR_ROWS.has(rows[place - 1]!.label)) place -= 1
      patch({ heard: heard.text, partial: '', rows: [...rows.slice(0, place), { at: heard.at, label: 'Heard', text: quoted(heard.text), tone: 'live' }, ...rows.slice(place)] })
      if (!ledger().stations.includes('heard')) patch({ stations: ['heard', ...ledger().stations] })
    },
    onEvent(event) {
      switch (event.type) {
        case 'command':
          // A hop past the first that fires nothing (done, no next step, not read, abandoned) is no Command of its own (#336):
          // it never takes the card — not from its own Task's hop that answered, nor from a later Command's, whichever Task it is of.
          if (event.dropped && event.task !== undefined && event.task.hop > 0) return
          if (state.phase === 'hidden' || state.phase === 'answer' || (state.phase === 'live' && event.turnId !== state.runId)) {
            // A Command whose Thinking the card never saw (a run begun with the panel open, ADR 0026): its turn starts here, the words its first row.
            open('live', event.at)
            row(event.at, ledger().heard === null ? 'Typed' : 'Heard', quoted(event.text))
            reach('heard')
          }
          state = {
            ...state,
            phase: 'live',
            runId: event.turnId,
            commandText: event.text,
            retiresAt: null,
            ...(event.dropped === true ? { dropped: true as const } : {}),
          }
          heardPending = false
          lastStatus = null
          sawError = false
          sounding = 0
          quietAt = event.at
          {
            const reading = event.action ?? (event.dropped === true ? 'no command' : '')
            patch({ reading })
            row(event.at, 'Read as', reading, event.dropped === true ? 'muted' : 'live')
          }
          return
        case 'status': {
          if (event.status === 'cancelled') {
            if (fromReportedRun(event)) lastStatus = event.status
            return
          }
          const firstThinking = event.status === 'thinking' && (event.hop === undefined || event.hop === 0)
          if (state.phase === 'listening') {
            // Only the line's own Thinking (or its Command) takes a listening card live: a stage of a Task still running is not this line's.
            if (!firstThinking) return
            beginTurn(event)
          } else if (state.phase === 'hidden' || state.phase === 'answer' || (firstThinking && event.turnId !== state.runId)) {
            if (!firstThinking) return
            beginTurn(event)
          }
          if (fromReportedRun(event)) lastStatus = event.status
          const last = ledger().stage
          // The stage as the Capsule reads it (#428, #438): the same reading, so the band and the hint never differ.
          const stage = stageEntered(last, event)
          patch({ stage })
          reach(event.status)
          // The same action's wait going on into the next hop's turn: no new row.
          if (last !== null && stage.startedAt === last.startedAt) return
          const label = stageWord(stage)
          const text = event.status === 'thinking' ? (event.hop !== undefined && event.hop > 0 ? `hop ${event.hop}` : '') : event.status === 'speaking' ? (ledger().said?.text ?? '') : (stage.detail ?? '')
          row(event.at, label, text, event.status === 'thinking' || event.status === 'loading' ? 'quiet' : 'live')
          return
        }
        case 'speak': {
          if (!fromReportedRun(event)) return
          sounding += 1
          reschedule()
          const said = { text: event.text, failure: event.failure === true }
          const last = ledger().rows.at(-1)
          const tone: LedgerTone = said.failure ? 'fail' : 'live'
          if (last !== undefined && last.label === STAGE_WORDS.speaking && last.text === '') {
            patch({ said, rows: [...ledger().rows.slice(0, -1), { ...last, text: event.text, tone }] })
          } else {
            patch({ said })
            row(event.at, STAGE_WORDS.speaking, event.text, tone)
            reach('speaking')
          }
          return
        }
        case 'spoken':
          if (!fromReportedRun(event) || sounding === 0) return
          sounding -= 1
          quietAt = Math.max(quietAt, event.at)
          reschedule()
          return
        case 'display':
          if (fromReportedRun(event)) patch({ answer: { text: event.text, failure: event.failure === true, muted: event.muted === true } })
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
          const end = outcome === 'failed' ? 'failed' : ledger().answer?.muted === true ? 'muted' : 'done'
          patch({ outcome: end, doneAt: event.at, stage: null })
          reach('done')
          row(event.at, end === 'failed' ? 'Failed' : 'Done', '', end === 'failed' ? 'fail' : end === 'muted' ? 'muted' : 'ok')
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

/** The stage row's live mark (#475): the waveform while the ear hears, the seconds in the stage, or the finished turn's total. */
export type LedgerMark = { kind: 'wave' } | { kind: 'seconds'; text: string } | { kind: 'total'; text: string }

/** The stage row and the words row as the band draws them (#475), read from the ledger at `now`. */
export interface LedgerFace {
  readonly word: string
  readonly tone: LedgerTone
  readonly mark: LedgerMark
  readonly words: { readonly text: string; readonly tone: LedgerTone }
  /** The face's name, for a shot series to key its geometry by: the ear's, the stage's, or the end's. */
  readonly key: string
}

const whole = (since: number, now: number): string => `${Math.floor(Math.max(0, now - since) / 1000)}s`

/**
 * What the band says of the moment (#475): the stage word in the Capsule's
 * own words (ui.md 9) — the ear's face while it bears, else the stage's,
 * else the end — and under it the words that go with it: the live partial,
 * the last words, the heard line, the action's object, the host, the
 * sentence, the Answer.
 */
export function ledgerFace(state: PeekCardState, now: number): LedgerFace {
  const { ledger } = state
  const quiet = (text: string): { text: string; tone: LedgerTone } => ({ text, tone: 'quiet' })
  const live = (text: string): { text: string; tone: LedgerTone } => ({ text, tone: 'live' })
  if (ledger.outcome !== null) {
    // The Answer (its Card, said plain); the sentence said stands in when the Command showed none.
    const answer = ledger.answer !== null ? plainAnswer(ledger.answer.text) : (ledger.said?.text ?? 'Done.')
    const tone: LedgerTone = ledger.outcome === 'failed' ? 'fail' : ledger.outcome === 'muted' ? 'muted' : 'ok'
    const total = ledger.doneAt !== null && ledger.startedAt !== null ? `${((ledger.doneAt - ledger.startedAt) / 1000).toFixed(1)}s` : ''
    return { key: ledger.outcome, word: ledger.outcome === 'failed' ? 'Failed' : 'Done', tone, mark: { kind: 'total', text: total }, words: { text: answer, tone: ledger.outcome === 'failed' || ledger.answer?.failure === true ? 'fail' : ledger.outcome === 'muted' ? 'muted' : 'live' } }
  }
  const earOutranks = ledger.ear === 'hearing' || (ledger.ear === 'listening' && ledger.stage === null && ledger.outcome === null)
  if (earOutranks) {
    const words = ledger.partial !== '' ? live(quoted(`${ledger.partial}…`)) : ledger.ear === 'hearing' ? quiet('…') : quiet('say a command')
    return { key: 'listening', word: 'Listening…', tone: 'live', mark: { kind: 'wave' }, words }
  }
  if (ledger.ear === 'transcribing') {
    return { key: 'transcribing', word: 'Transcribing…', tone: 'live', mark: { kind: 'seconds', text: whole(ledger.earSince ?? now, now) }, words: ledger.lastWords !== '' ? live(quoted(ledger.lastWords)) : quiet('…') }
  }
  const heard = ledger.heard ?? state.commandText
  if (ledger.stage === null) {
    return { key: 'thinking', word: `${STAGE_WORDS.thinking}…`, tone: 'live', mark: { kind: 'seconds', text: whole(ledger.rows.at(-1)?.at ?? ledger.startedAt ?? now, now) }, words: heard !== null ? live(quoted(heard)) : quiet('') }
  }
  const stage = ledger.stage
  const words =
    stage.stage === 'thinking'
      ? heard !== null
        ? live(quoted(heard))
        : live(stage.detail !== undefined ? quoted(stage.detail) : '')
      : stage.stage === 'speaking'
        ? { text: ledger.said?.text ?? '', tone: (ledger.said?.failure === true ? 'fail' : 'live') as LedgerTone }
        : live(stage.detail ?? '')
  return { key: stage.stage, word: `${stageWord(stage)}…`, tone: 'live', mark: { kind: 'seconds', text: whole(stage.startedAt, now) }, words }
}

/** A row's clock on the band (#475): tenths of a second since the turn began. */
export function rowClock(row: LedgerRow, ledger: TurnLedger): string {
  return `${((row.at - (ledger.startedAt ?? row.at)) / 1000).toFixed(1)}s`
}
