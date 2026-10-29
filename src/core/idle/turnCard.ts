import { inferRunOutcome, type PipelineEvent, type PipelineStatus } from '../pipeline/events'
import { PEEK_CARD_LINGER_MS } from '../panel/peekCardState'
import { stageEntered } from '../pipeline/runProgress'
import { earPhase, type EarPhase } from '../voice/voicePrompt'
import type { VoiceHeardEvent, VoiceState } from '../voice/ipcChannels'
import type { SongWait } from '../music/songWait'

// The Turn Card (#474): what the Idle Screen shows of a spoken or typed
// line's whole journey — the ear taking it, its words, the reading, every
// stage and its end — as a pure fold over the three seams the renderer
// already rides: the voice state and its partials, the `heard` IPC, and
// the pipeline events. The card is one line's; the next line restarts it.
// It goes 15 s after the later of the line's `done` and its last sentence
// spoken, the Peek Card's own constant, so one number governs both. The
// Peek Card's Ledger Strip (#475) is the same fold in another frame: the
// band across the pane's bottom while the Feed Panel is shut. Its history
// is the one line's alone: a new line, a new wake over an ended card, or
// speech over a running line clears the rows the line before drew (owner,
// 2026-10-27: the old command's history on the card "is confusing").

/** How a step's text reads in the history: the newest in the primary ink, the rest quiet; an outcome in its colour. */
export type TurnStepTone = 'plain' | 'quiet' | 'ok' | 'fail'

/** One row of the card's history: when, which step, and what it was on. */
export interface TurnStep {
  at: number
  label: string
  text: string
  tone: TurnStepTone
  /** Which Utterance (or typed line) the step belongs to — the ear's rows carry no turn. */
  line: number
  /** The turn the step came from; null for the ear's own rows. */
  turnId: string | null
}

/** The stage a line is in, as the card draws it: the Capsule's own fields (runProgress), and the turn it came from. */
export interface TurnStage {
  status: PipelineStatus
  startedAt: number
  turnId: string
  word?: string
  detail?: string
  hop?: number
  /** A song waiting to sound (#507): the row says the wait's words on the Wait Card's clock. */
  wait?: SongWait
}

/** How a line ended, each said in a word of its own: Done, Failed, Stopped, No response. */
export type TurnEnd = 'done' | 'failed' | 'stopped' | 'dropped'

export interface TurnCardState {
  phase: 'hidden' | 'open'
  /** The card's clock zero: the wake, or the typed line's first event, on main's clock. */
  openedAt: number
  ear: EarPhase
  /** When the ear's phase began, on main's clock; 0 before it has said. */
  earSince: number
  partial: string
  lastWords: string
  heard: string | null
  heardAt: number | null
  /** The line's own turn: hop 0's. */
  turnId: string | null
  /** The reading: the `command`'s action; "no Command" for a dropped line. */
  reading: string | null
  dropped: boolean
  stage: TurnStage | null
  said: { text: string; failure: boolean } | null
  answer: { text: string; failure: boolean; muted: boolean } | null
  end: TurnEnd | null
  endedAt: number | null
  /** When the card goes, on the events' clock: null while live or while a sentence still sounds. */
  retiresAt: number | null
  steps: readonly TurnStep[]
}

/** The card's words for a line read as no Command (the Answer's own words, ui.md 9) and a Stop. */
export const TURN_END_WORDS: Readonly<Record<TurnEnd, string>> = { done: 'Done', failed: 'Failed', stopped: 'Stopped', dropped: 'No response' }

/** Each end's tone: Done in the ok colour, Failed in the failure's, a Stop and no response quiet (#334). */
export const TURN_END_TONES: Readonly<Record<TurnEnd, TurnStepTone>> = { done: 'ok', failed: 'fail', stopped: 'quiet', dropped: 'quiet' }

/** The reading the card shows for a line read as no Command. */
export const NO_COMMAND = 'no Command'

const STEP_LABELS: Readonly<Record<Exclude<PipelineStatus, 'cancelled'>, string>> = { thinking: 'Thinking', acting: 'Acting', loading: 'Loading', speaking: 'Speaking' }

const REST: EarPhase = 'rest'

/**
 * How long a card whose ear closed on nothing waits for the line's other
 * seams (the `heard` IPC, the first stage) before it reads the close as a
 * blip and goes. A guess: the two IPCs leave main together, so the gap is
 * a frame or two; what would settle it is a kiosk log of a line whose card
 * went before its Heard row.
 */
const BLIP_GRACE_MS = 1_000

function hidden(ear: EarPhase, earSince: number, partial: string, lastWords: string): TurnCardState {
  return { phase: 'hidden', openedAt: 0, ear, earSince, partial, lastWords, heard: null, heardAt: null, turnId: null, reading: null, dropped: false, stage: null, said: null, answer: null, end: null, endedAt: null, retiresAt: null, steps: [] }
}

const firstLine = (text: string): string => text.split('\n', 1)[0]!

/** An Answer's words as a card says them: the Card's markdown marks dropped, one paragraph. */
export function plainAnswer(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
}

export interface TurnCardFold {
  /** The voice state as main publishes it; `now` is the renderer's clock, used only when main has not said when the phase began. */
  onVoice(state: VoiceState, now: number): void
  onPartial(text: string): void
  onHeard(heard: VoiceHeardEvent & { at: number }): void
  onEvent(event: PipelineEvent): void
  /** The card's time is up at `now`: it goes. */
  expire(now: number): void
  /** A tap: the card goes; the line it reported is not touched. */
  dismiss(): void
  state(): TurnCardState
}

/**
 * Folds the three seams into the card's state. The ear opening for an
 * Utterance opens the card; a line that was a blip — the ear back at rest
 * with nothing heard — closes it again. Speech starting after a line has
 * ended, or a typed line's first event, restarts it: the next line's card.
 * A hop past the first continues the card. Only the card's own turns move
 * it: a sentence or an end from another is not its own.
 */
export function createTurnCardFold(): TurnCardFold {
  let state = hidden(REST, 0, '', '')
  let line = 0
  let turns = new Set<string>()
  let lastStatus: string | null = null
  let sawError = false
  let sounding = 0
  let quietAt = 0
  let wasHearing = false
  let wasTaking = false
  // The words of the line the card reports, from its `command`: what a late `heard` is matched against.
  let lineText: string | null = null
  // Speech started over a running line: its ear rows are the next line's, and that line's first turn keeps them.
  let speechPending = false
  // The running line's turns when speech started over it: their rows are the old command's, never drawn again.
  let superseded = new Set<string>()

  /** What one line kept: its turns, its outcome trail, its sentences sounding, its words. */
  const clearLine = (): void => {
    turns = new Set()
    lastStatus = null
    sawError = false
    sounding = 0
    quietAt = 0
    lineText = null
  }
  const reset = (keepFrom: (step: TurnStep) => boolean = () => false): void => {
    const kept = state.steps.filter(keepFrom)
    state = { ...hidden(state.ear, state.earSince, state.partial, state.lastWords), phase: 'open', openedAt: kept.length > 0 ? Math.min(...kept.map((step) => step.at)) : state.openedAt, steps: kept }
    clearLine()
  }
  const close = (): void => {
    state = hidden(state.ear, state.earSince, state.partial, state.lastWords)
    clearLine()
  }
  const open = (at: number): void => {
    reset()
    state = { ...state, openedAt: at }
    line += 1
    speechPending = false
    superseded = new Set()
  }
  const push = (step: Omit<TurnStep, 'line'>): void => {
    if (step.turnId !== null && superseded.has(step.turnId)) return
    const last = state.steps.at(-1)
    // The same step twice (a stage published again on the same object) is one row.
    if (last !== undefined && last.label === step.label && last.text === step.text && last.turnId === step.turnId) return
    state = { ...state, steps: [...state.steps, { ...step, line }] }
  }
  const replaceLast = (step: Omit<TurnStep, 'line'>): void => {
    state = { ...state, steps: [...state.steps.slice(0, -1), { ...step, line }] }
  }
  // The hold is the Peek Card's own constant, a guess marked there (#470): the owner reading a line's end from the
  // chair on a normal day, and saying the card went too soon or stayed too long, is what would settle it.
  const reschedule = (): void => {
    if (state.end === null || state.endedAt === null) return
    state = { ...state, retiresAt: sounding > 0 ? null : Math.max(state.endedAt, quietAt) + PEEK_CARD_LINGER_MS }
  }
  /** The ear's row for this line: the one being updated as the words come, pushed when there is none. */
  const earRow = (at: number, text: string, tone: TurnStepTone): void => {
    const last = state.steps.at(-1)
    if (last !== undefined && last.label === 'Listening' && last.turnId === null && last.line === line) replaceLast({ at: last.at, label: 'Listening', text, tone, turnId: null })
    else push({ at, label: 'Listening', text, tone, turnId: null })
  }
  const adopt = (turnId: string, at: number, hop: number): void => {
    if (turns.has(turnId)) return
    if (state.phase === 'hidden') {
      open(at)
    } else if (state.end !== null && hop === 0 && !speechPending) {
      // The next line's first turn after this one ended — a typed line, or the next step of a line in steps: its own
      // card from its first event, the ended line's rows gone with it.
      open(at)
    } else if (state.end !== null) {
      // A hop after its forerunner's `done`, or the turn of speech that started over the running line: the card is live
      // again, and an end row the forerunner's `done` left is not this line's.
      const last = state.steps.at(-1)
      const steps = last !== undefined && last.label === TURN_END_WORDS[state.end] ? state.steps.slice(0, -1) : state.steps
      state = { ...state, end: null, endedAt: null, retiresAt: null, steps }
      speechPending = false
    }
    if (state.end === null) state = { ...state, retiresAt: null }
    turns.add(turnId)
  }

  return {
    onVoice(voice, now) {
      // While the line's own Speaking stage runs the ear is at rest, as the Capsule reads it (#472).
      const ear = earPhase({ ...voice, speaking: voice.speaking === true || state.stage?.status === 'speaking' })
      const since = voice.since ?? now
      const was = state.ear
      const hearing = voice.listening && voice.hearing
      const taking = voice.listening || voice.transcribing
      state = { ...state, ear, earSince: ear === was ? state.earSince : since }
      if (taking && !wasTaking && (ear === 'listening' || ear === 'hearing' || ear === 'starting') && (state.phase === 'hidden' || state.end !== null)) {
        // The wake: the card opens on the ear opening for an Utterance — afresh over a line that ended, whose rows are not this one's.
        open(since)
        push({ at: since, label: 'Listening', text: 'say a command', tone: 'quiet', turnId: null })
      }
      if (hearing && !wasHearing) {
        // Speech starts: a new Utterance. After a line that ended it is the next line's card; over a running line it
        // is the Hot Listen's next (which will supersede or be dropped), so the card is kept and the row added to it.
        if (state.phase === 'hidden') {
          open(since)
        } else if (state.end !== null) {
          open(since)
        } else if (state.turnId !== null || state.stage !== null || state.heard !== null) {
          // The running line's rows go: the history is the new line's from its first word.
          line += 1
          speechPending = true
          superseded = new Set(turns)
          state = { ...state, steps: [] }
        }
        state = { ...state, partial: '' }
        earRow(since, '…', 'quiet')
      }
      if (ear === 'transcribing' && was !== 'transcribing' && state.phase === 'open') {
        push({ at: since, label: 'Transcribing', text: state.lastWords === '' ? 'your words' : `“${state.lastWords}”`, tone: 'quiet', turnId: null })
      }
      if (!taking && wasTaking && state.phase === 'open' && state.heard === null && state.turnId === null && state.stage === null && state.end === null) {
        // A blip: the ear closed on nothing. Its line, if it has one, follows on the other seams within the grace;
        // else nothing is coming for this card and it goes.
        state = { ...state, retiresAt: since + BLIP_GRACE_MS }
      }
      wasHearing = hearing
      wasTaking = taking
    },
    onPartial(text) {
      state = { ...state, partial: text, lastWords: text === '' ? state.lastWords : text }
      if (state.phase === 'open' && text !== '') earRow(state.earSince, `“${text}…”`, 'plain')
    },
    onHeard(heard) {
      // The `heard` IPC trails the line's first stage, and a fast line's whole run, its `done` among them: the receipt of
      // the line the card already reports is slotted in before that line's own rows, never read as the next line. It is
      // this line's when the card has heard nothing yet and the line's rows are drawn — by its words once its `command`
      // has named them, else by the ear's rows all coming before the line's.
      const first = state.steps.findIndex((step) => step.turnId !== null)
      const earAfter = first !== -1 && state.steps.some((step, index) => index > first && step.turnId === null && step.line === line)
      const ownReceipt = state.phase === 'open' && state.heard === null && first !== -1 && (lineText !== null ? lineText.trim().toLowerCase() === heard.text.trim().toLowerCase() : !earAfter)
      if (ownReceipt) {
        const row: TurnStep = { at: heard.at, label: 'Heard', text: `“${heard.text}”`, tone: 'plain', turnId: null, line }
        state = { ...state, heard: heard.text, heardAt: heard.at, partial: '', steps: [...state.steps.slice(0, first), row, ...state.steps.slice(first)] }
        return
      }
      if (state.phase === 'hidden') open(heard.at)
      else if (state.end !== null) open(heard.at)
      state = { ...state, heard: heard.text, heardAt: heard.at, partial: '', retiresAt: state.end === null ? null : state.retiresAt }
      push({ at: heard.at, label: 'Heard', text: `“${heard.text}”`, tone: 'plain', turnId: null })
      if (heard.routed === 'ignored') {
        // No Command follows a line the ear took outside a wake or the hotkey: it ends here.
        state = { ...state, end: 'dropped', endedAt: heard.at, reading: NO_COMMAND }
        push({ at: heard.at, label: TURN_END_WORDS.dropped, text: '', tone: 'quiet', turnId: null })
        quietAt = Math.max(quietAt, heard.at)
        reschedule()
      }
    },
    onEvent(event) {
      switch (event.type) {
        case 'status': {
          adopt(event.turnId, event.at, event.hop ?? 0)
          if (event.status === 'cancelled') {
            lastStatus = event.status
            return
          }
          // The stage as the Capsule reads it (#428, #438): the same reading, so the card and the hint never differ —
          // an action's Loading on what the action was on, the same hop only; the same action's wait carried into the
          // next hop's turn keeps its start, and is no new row.
          const last = state.stage
          const entered = stageEntered(last === null ? null : { stage: last.status, startedAt: last.startedAt, ...(last.word !== undefined ? { word: last.word } : {}), ...(last.detail !== undefined ? { detail: last.detail } : {}), ...(last.hop !== undefined ? { hop: last.hop } : {}) }, event)
          const { word, detail, wait } = entered
          lastStatus = event.status
          state = { ...state, stage: { status: event.status, startedAt: entered.startedAt, turnId: event.turnId, ...(word !== undefined ? { word } : {}), ...(detail !== undefined ? { detail } : {}), ...(entered.hop !== undefined ? { hop: entered.hop } : {}), ...(wait !== undefined ? { wait } : {}) } }
          // The same action's wait going on into the next hop's turn: no new row.
          if (last !== null && last.status === 'loading' && event.status === 'loading' && last.hop === event.hop) return
          const label = event.status === 'acting' ? (word ?? STEP_LABELS.acting) : STEP_LABELS[event.status]
          const text = event.status === 'thinking' ? (detail === undefined || detail === '' ? '' : `“${detail}”`) : event.status === 'speaking' ? (detail ?? state.said?.text ?? '') : (detail ?? '')
          push({ at: event.at, label, text, tone: event.status === 'acting' ? 'plain' : 'quiet', turnId: event.turnId })
          return
        }
        case 'command': {
          // A hop past the first that fires nothing is no Command of its own (#336).
          if (event.dropped && event.task !== undefined && event.task.hop > 0) return
          const hop = event.task?.hop ?? 0
          if (hop === 0 && state.turnId !== null && state.turnId !== event.turnId) {
            // The next line: its card, keeping what this line's ear and its own thinking already drew.
            reset((step) => step.turnId === event.turnId || (step.turnId === null && step.line === line))
          }
          adopt(event.turnId, event.at, hop)
          const reading = event.action ?? (event.dropped === true ? NO_COMMAND : null)
          if (hop === 0) lineText = event.text
          state = { ...state, turnId: hop === 0 ? event.turnId : (state.turnId ?? event.turnId), reading, dropped: event.dropped === true }
          if (reading !== null) push({ at: event.at, label: 'Read as', text: reading, tone: event.dropped === true ? 'quiet' : 'plain', turnId: event.turnId })
          return
        }
        case 'speak': {
          if (event.turnId === undefined || !turns.has(event.turnId)) return
          sounding += 1
          state = { ...state, said: { text: event.text, failure: event.failure === true } }
          // Most speech publishes no stage: the sentence itself is the Speaking stage, from its `speak`.
          if (state.end === null && (state.stage === null || state.stage.status !== 'speaking')) state = { ...state, stage: { status: 'speaking', startedAt: event.at, turnId: event.turnId, detail: event.text } }
          const last = state.steps.at(-1)
          if (last !== undefined && last.label === STEP_LABELS.speaking && last.text === '' && last.turnId === event.turnId) replaceLast({ ...last, text: event.text, tone: event.failure === true ? 'fail' : 'quiet' })
          else push({ at: event.at, label: STEP_LABELS.speaking, text: event.text, tone: event.failure === true ? 'fail' : 'quiet', turnId: event.turnId })
          reschedule()
          return
        }
        case 'spoken':
          if (event.turnId === undefined || !turns.has(event.turnId) || sounding === 0) return
          sounding -= 1
          quietAt = Math.max(quietAt, event.at)
          reschedule()
          return
        case 'display':
          if (event.turnId === undefined || !turns.has(event.turnId)) return
          state = { ...state, answer: { text: event.text, failure: event.failure === true, muted: event.muted === true } }
          return
        case 'error':
          if (event.turnId !== undefined && turns.has(event.turnId)) sawError = true
          return
        case 'done': {
          if (!turns.has(event.turnId)) return
          const outcome = inferRunOutcome(event.outcome, lastStatus, sawError)
          // A line whose Answer tells a failure ended on it, whatever its outcome says (#329): the Peek Card's dot reads the same flag.
          const told = state.answer?.failure === true || (state.answer === null && state.said?.failure === true)
          const end: TurnEnd = outcome === 'cancelled' ? 'stopped' : outcome === 'failed' || told ? 'failed' : state.dropped ? 'dropped' : state.answer?.muted === true ? 'stopped' : 'done'
          const text = state.answer !== null ? firstLine(state.answer.text) : (state.said?.text ?? '')
          state = { ...state, end, endedAt: event.at, stage: null }
          push({ at: event.at, label: TURN_END_WORDS[end], text, tone: TURN_END_TONES[end], turnId: event.turnId })
          quietAt = Math.max(quietAt, event.at)
          reschedule()
          return
        }
        default:
          return
      }
    },
    expire(now) {
      if (state.phase === 'open' && state.retiresAt !== null && now >= state.retiresAt) close()
    },
    dismiss() {
      if (state.phase === 'open') close()
    },
    state: () => state,
  }
}

/** The six stations of the rail, in order; the live one is lit and the track fills to it. */
export const TURN_STATIONS = ['Heard', 'Thinking', 'Acting', 'Loading', 'Speaking', 'Done'] as const

/** Which station the line has reached: -1 before it is heard. */
export function turnStation(state: TurnCardState): number {
  if (state.end !== null) return 5
  switch (state.stage?.status) {
    case 'speaking':
      return 4
    case 'loading':
      return 3
    case 'acting':
      return 2
    case 'thinking':
      return 1
    default:
      return state.heard !== null ? 0 : -1
  }
}

/** What is live on the card: the ear taking a line, the line's stage, its end, or a line heard with no stage yet. */
export type TurnLive = { kind: 'ear'; phase: 'starting' | 'listening' | 'hearing' | 'transcribing'; since: number } | { kind: 'stage'; stage: TurnStage } | { kind: 'end'; end: TurnEnd; endedAt: number } | { kind: 'taken'; since: number }

/**
 * The stage row's subject. The ear leads while it takes a line — but an
 * open ear that has heard nothing yields to a running line or an end
 * (#472): the Hot Listen's open ear is said by the waveform, not the word.
 */
export function turnLive(state: TurnCardState): TurnLive {
  const { ear } = state
  const nothingInHand = state.heard === null && state.stage === null && state.end === null
  if (ear === 'starting' || ear === 'hearing' || ear === 'transcribing' || (ear === 'listening' && nothingInHand)) return { kind: 'ear', phase: ear, since: state.earSince }
  if (state.end !== null) return { kind: 'end', end: state.end, endedAt: state.endedAt ?? state.openedAt }
  if (state.stage !== null) return { kind: 'stage', stage: state.stage }
  if (state.heard !== null) return { kind: 'taken', since: state.heardAt ?? state.openedAt }
  return { kind: 'ear', phase: 'listening', since: state.earSince }
}

/** The words row: what the live subject is on, in the person's words. Two lines are reserved; a line that runs longer is cut there. */
export function turnWords(state: TurnCardState): { text: string; tone: TurnStepTone } {
  const live = turnLive(state)
  switch (live.kind) {
    case 'ear':
      if (live.phase === 'transcribing') return state.lastWords === '' ? { text: 'your words', tone: 'quiet' } : { text: `“${state.lastWords}”`, tone: 'plain' }
      if (live.phase === 'starting') return { text: state.lastWords === '' ? 'loading the ear' : `“${state.lastWords}”`, tone: 'quiet' }
      if (state.partial !== '') return { text: `“${state.partial}…”`, tone: 'plain' }
      return { text: live.phase === 'hearing' ? '…' : 'say a command', tone: 'quiet' }
    case 'end': {
      if (state.answer !== null) return { text: plainAnswer(state.answer.text), tone: state.answer.failure ? 'fail' : live.end === 'done' ? 'plain' : 'quiet' }
      if (state.said !== null) return { text: state.said.text, tone: state.said.failure ? 'fail' : 'plain' }
      return { text: state.heard === null ? '' : `“${state.heard}”`, tone: 'quiet' }
    }
    case 'stage': {
      const { stage } = live
      if (stage.status === 'speaking') return { text: state.said?.text ?? stage.detail ?? '', tone: state.said?.failure === true ? 'fail' : 'plain' }
      if (stage.status === 'thinking') return { text: state.heard !== null ? `“${state.heard}”` : stage.detail !== undefined && stage.detail !== '' ? `“${stage.detail}”` : '', tone: 'plain' }
      return { text: stage.detail ?? state.reading ?? '', tone: 'plain' }
    }
    case 'taken':
      return { text: `“${state.heard ?? ''}”`, tone: 'plain' }
  }
}

/** The history's six rows, oldest first, the newest last — the rows before them are gone. The Ledger Strip (#475) holds five. */
export const TURN_HISTORY_ROWS = 6

export function turnHistory(state: TurnCardState, rows = TURN_HISTORY_ROWS): readonly (TurnStep | null)[] {
  const shown = state.steps.slice(-rows)
  return [...shown, ...Array.from({ length: rows - shown.length }, () => null)]
}
