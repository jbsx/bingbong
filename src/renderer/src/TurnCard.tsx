import { useEffect, useState } from 'react'
import { TURN_END_TONES, TURN_END_WORDS, TURN_STATIONS, turnHistory, turnLive, turnStation, turnWords, type TurnCardState, type TurnLive, type TurnStepTone } from '../../core/idle/turnCard'
import { lingerDelayMs, PEEK_CARD_LINGER_MS } from '../../core/panel/peekCardState'
import { runProgressParts } from '../../core/pipeline/runProgress'
import { stageWord } from '../../core/pipeline/stageWords'
import { waitSeconds } from '../../core/voice/voicePrompt'
import { PILL_LABELS, VoiceWave } from './AssistantPanel'

/**
 * The Turn Card (#474, CONTEXT.md): one Tile-sized card centred over the
 * Idle Screen on a scrim, up from the wake until the line is over, carrying
 * every step of it — the rail of six stations with the live one lit, the
 * stage word at 65 px with its live mark pinned right (the waveform while
 * the ear hears, the seconds otherwise, counted on this renderer's clock),
 * two lines of the words it is on, and six rows of history, oldest first.
 * Nothing moves between states: the geometry is fixed, only the ink
 * changes (owner, 2026-10-26: "i dont like how the text moves"). The stage
 * and words rows never ellipsize; a history row's text does. A tap closes
 * it on the pointer going down and keeps the tap from the window, so the
 * Idle Screen stays up: it is never activity.
 *
 * Its pieces — the rail, the stage row, the words row, the history — are
 * the Peek Card's too (#475): the Ledger Strip across the pane's bottom
 * draws them in another frame while the Feed Panel is shut.
 */

/** What the card's `data-state` says, for the e2e's geometry series: the ear's phase, the stage, or the end. */
function stateName(live: TurnLive): string {
  switch (live.kind) {
    case 'ear':
      return live.phase === 'hearing' ? 'listening' : live.phase
    case 'stage':
      return live.stage.status
    case 'end':
      return live.end
    case 'taken':
      return 'thinking'
  }
}

/** The stage word, in the Capsule's own words (ui.md 9): Acting by the action's own word. */
function word(live: TurnLive): string {
  switch (live.kind) {
    case 'ear':
      return live.phase === 'hearing' ? PILL_LABELS.listening : PILL_LABELS[live.phase]
    case 'stage':
      return `${stageWord({ stage: live.stage.status, ...(live.stage.word !== undefined ? { word: live.stage.word } : {}) })}…`
    case 'end':
      return TURN_END_WORDS[live.end]
    case 'taken':
      return PILL_LABELS.thinking
  }
}

/** Whole seconds and a tenth, in the mono face: a step's clock from the card's open, or a line's whole time. */
const tenths = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)}s`

/** The renderer's second (ui.md 2): the seconds tick here alone, on this renderer's clock; a count that stops is the one true sign of a hang. */
export function useTurnClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** The card's face at `now`: its name, the stage word, its tone, the rail's station. */
export interface TurnFace {
  readonly name: string
  readonly word: string
  readonly tone: TurnStepTone | 'live'
  readonly station: number
  readonly live: TurnLive
}

export function turnFace(state: TurnCardState): TurnFace {
  const live = turnLive(state)
  return { name: stateName(live), word: word(live), tone: live.kind === 'end' ? TURN_END_TONES[live.end] : 'live', station: turnStation(state), live }
}

/** The rail: six equal cells over one track, filled to the live station; the live dot the only accent; a station the line skipped unlit. */
export function TurnRail({ station }: { station: number }) {
  const fill = station <= 0 ? 0 : station / (TURN_STATIONS.length - 1)
  return (
    <div className="turn-rail" aria-hidden="true">
      <span className="turn-track" />
      <span className={`turn-track-fill${station > 0 ? '' : ' turn-track-fill--none'}`} style={{ transform: `scaleX(${fill})` }} />
      <div className="turn-rail-cells">
        {TURN_STATIONS.map((label, index) => (
          <div key={label} className={`turn-rail-cell turn-rail-cell--${index === station ? 'live' : index < station ? 'past' : 'ahead'}`}>
            <span className="turn-rail-dot" />
            <span className="turn-rail-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The stage row: the word at a fixed left, the live mark pinned right — the waveform while the ear hears; the seconds
 * otherwise, a stage's with its wait named past its bound (#442), an ended line's whole time; an ear open after the
 * end is said by the waveform, not a word (#472).
 */
export function TurnStageRow({ state, face, now }: { state: TurnCardState; face: TurnFace; now: number }) {
  const { live } = face
  let mark: React.ReactNode
  let note: string | null = null
  switch (live.kind) {
    case 'ear':
      mark = live.phase === 'listening' || live.phase === 'hearing' ? <VoiceWave bars={6} /> : <span className="turn-stage-secs">{waitSeconds(live.since, now)}s</span>
      break
    case 'stage': {
      const parts = runProgressParts({ stage: live.stage.status, startedAt: live.stage.startedAt, ...(live.stage.word !== undefined ? { word: live.stage.word } : {}), ...(live.stage.detail !== undefined ? { detail: live.stage.detail } : {}) }, now, live.stage.status)
      note = parts.stage
      mark = <span className="turn-stage-secs">{parts.seconds}</span>
      break
    }
    case 'taken':
      mark = <span className="turn-stage-secs">{waitSeconds(live.since, now)}s</span>
      break
    case 'end':
      mark = state.ear === 'listening' ? <VoiceWave bars={6} /> : <span className="turn-stage-secs turn-stage-secs--over">{tenths(live.endedAt - state.openedAt)}</span>
      break
  }
  return (
    <div className="turn-stage">
      <span className="turn-stage-word" role="status">
        {face.word}
      </span>
      <span className="turn-stage-mark">
        {note !== null ? <span className="turn-stage-note">{note} · </span> : null}
        {mark}
      </span>
    </div>
  )
}

/** The words row: two lines reserved, so nothing under it shifts; a line that runs longer is cut there. */
export function TurnWordsRow({ state }: { state: TurnCardState }) {
  const words = turnWords(state)
  return <div className={`turn-words turn-words--${words.tone}`}>{words.text}</div>
}

/** The history: `rows` fixed rows on one grid, oldest first, the newest in the primary ink; empty rows blank. */
export function TurnHistory({ state, rows }: { state: TurnCardState; rows?: number }) {
  const history = turnHistory(state, rows)
  const newest = history.reduce((last, step, index) => (step !== null ? index : last), -1)
  return (
    <div className="turn-history">
      {history.map((step, index) =>
        step === null ? (
          <div key={index} className="turn-step turn-step--blank" />
        ) : (
          <div key={index} className={`turn-step turn-step--${step.tone}${index === newest ? ' turn-step--newest' : ''}`}>
            <span className="turn-step-at">{tenths(step.at - state.openedAt)}</span>
            <span className="turn-step-label">{step.label}</span>
            <span className="turn-step-text">{step.text}</span>
          </div>
        ),
      )}
    </div>
  )
}

/**
 * The bar along the card's foot draining across the 15 s after its line is over (the Peek Card's own, #470):
 * drawn from the deadline, so a card shown late starts part drained; nothing pauses it.
 */
function LingerBar({ retiresAt }: { retiresAt: number }) {
  return <span key={retiresAt} className="turn-linger" style={{ animationDuration: `${PEEK_CARD_LINGER_MS}ms`, animationDelay: `${lingerDelayMs(retiresAt, Date.now())}ms` }} aria-hidden="true" />
}

export function TurnCard({ state, onDismiss }: { state: TurnCardState; onDismiss(): void }) {
  const now = useTurnClock()
  const face = turnFace(state)
  const words = turnWords(state)

  return (
    <>
      {/* The scrim dims the rest of the screen so the card is first (ui.md 7). Its depth is a guess: 0.5 as the
          prototype drew it; what would settle it is the owner reading the card from the chair at night and by day. */}
      <div className="turn-scrim" aria-hidden="true" />
      <div
        className={`turn-card turn-card--${face.name} turn-card--tone-${face.tone}`}
        data-state={face.name}
        role="status"
        aria-label={`${face.word} ${words.text}. Tap to dismiss`}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
        }}
      >
        <TurnRail station={face.station} />
        <TurnStageRow state={state} face={face} now={now} />
        <TurnWordsRow state={state} />
        <TurnHistory state={state} />
        {state.retiresAt !== null ? <LingerBar retiresAt={state.retiresAt} /> : null}
      </div>
    </>
  )
}
