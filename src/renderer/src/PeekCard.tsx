import { useEffect, useState } from 'react'
import { ledgerFace, RAIL_STATIONS, railStation, rowClock, type LedgerRow, type PeekCardAnswer, type PeekCardState, type TurnLedger } from '../../core/panel/peekCardState'
import { VoiceWave } from './AssistantPanel'

// The Peek Card (ADR 0021, 0026, 0029; glossary), in its Ledger Strip form
// (#475): the system-pushed report of a spoken or typed line's whole
// journey while the Feed Panel is Collapsed — a band the pane's width at
// its bottom, from the wake to 15 s past the Answer's sentence (#470).
// Voice shows it, only a human act opens the panel, and clicking it is
// that act. It renders from the panel's overlay view (ADR 0029) — the one
// surface that floats above the native pane — replacing the collapsed
// edge tab; it is not a state of the panel. Its geometry is fixed (#474's
// rule): the rail's cells, the stage word's left, the mark's right and the
// history's rows stand in the same place in every state.

/** The rail's stations as labelled (#475): the labels never change — Acting stays Acting; the action's own word goes in the stage row and the history. */
const STATION_LABELS = { heard: 'Heard', thinking: 'Thinking', acting: 'Acting', loading: 'Loading', speaking: 'Speaking', done: 'Done' } as const

/** The history's rows (#475): five fixed, the newest last, empty ones blank. */
const HISTORY_ROWS = 5

/** The renderer's second (#428): the seconds are read from the events' timestamps, so a count that stops is the one true sign of a hang. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

/** The rail (#475): six equal cells over one track, filled to the live station; the live dot the only accent; a skipped station unlit. */
function Rail({ ledger }: { ledger: TurnLedger }) {
  const live = railStation(ledger)
  const index = live === null ? -1 : RAIL_STATIONS.indexOf(live)
  const end = ledger.outcome === null ? '' : ledger.outcome === 'failed' ? ' peek-rail--failed' : ledger.outcome === 'muted' ? ' peek-rail--muted' : ' peek-rail--done'
  return (
    <div className={`peek-rail${end}`} aria-hidden="true">
      <span className="peek-rail-track" />
      <span className="peek-rail-fill" style={{ width: `calc((100% - 100% / 6) * ${index <= 0 ? 0 : index / 5})` }} />
      <div className="peek-rail-cells">
        {RAIL_STATIONS.map((station, at) => {
          const face = station === live ? 'live' : ledger.stations.includes(station) ? 'past' : at < index ? 'skipped' : 'ahead'
          return (
            <span key={station} className={`peek-rail-cell peek-rail-cell--${face}`}>
              <span className="peek-rail-dot" />
              <span className="peek-rail-label">{STATION_LABELS[station]}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** The history (#475): the newest rows, oldest first, the newest in white and the older in grey, on one grid. */
function History({ ledger }: { ledger: TurnLedger }) {
  const shown: LedgerRow[] = ledger.rows.slice(-HISTORY_ROWS)
  const rows: (LedgerRow | null)[] = [...shown, ...Array.from({ length: HISTORY_ROWS - shown.length }, () => null)]
  return (
    <div className="peek-history" aria-hidden="true">
      {rows.map((row, index) => {
        if (row === null) return <div key={`blank-${index}`} className="peek-row peek-row--blank" />
        const newest = index === shown.length - 1
        return (
          <div key={index} className={`peek-row peek-row--${row.tone}${newest ? ' peek-row--newest' : ''}`}>
            <span className="peek-row-clock">{rowClock(row, ledger)}</span>
            <span className="peek-row-label">{row.label}</span>
            <span className="peek-row-text">{row.text}</span>
          </div>
        )
      })}
    </div>
  )
}

export function PeekCard({ state, onOpen }: { state: PeekCardState; onOpen(): void }) {
  // The seconds climb while the ear or a stage is live; the finished turn shows its total, still.
  const now = useNow(state.phase === 'listening' || state.phase === 'live')
  const face = ledgerFace(state, now)
  const { ledger } = state
  return (
    <div
      className={`peek-card peek-card--band peek-card--${state.phase}`}
      data-face={face.key}
      role="button"
      tabIndex={0}
      aria-label="Open the activity feed"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <Rail ledger={ledger} />
      <div className="peek-columns">
        <div className="peek-left">
          <div className="peek-stage">
            <span className={`peek-stage-word peek-tone--${face.tone}`} role="status">
              {face.word}
            </span>
            <span className={`peek-stage-mark peek-stage-mark--${face.mark.kind}`} aria-hidden={face.mark.kind === 'wave'}>
              {face.mark.kind === 'wave' ? <VoiceWave bars={6} /> : face.mark.text}
            </span>
          </div>
          <p className={`peek-words peek-tone--${face.words.tone}`}>{face.words.text}</p>
          <span className="peek-open-hint" aria-hidden="true">
            open the feed ›
          </span>
        </div>
        <History ledger={ledger} />
      </div>
    </div>
  )
}

/**
 * The Peek Card's Idle Screen form (#470, CONTEXT Peek Card): a failed
 * Command or "No response.", in the Weigh-in pop-up's place, read from the
 * chair — the words heard, the sentence at status size, and under it the
 * rest of the Answer, the reason and the `Try “…”` line (#438). Its dot is
 * the failure colour, grey for "No response.". A tap dismisses it on the
 * pointer going down and keeps the tap from the window, so the Idle Screen
 * stays up: it is never activity.
 */
export function IdlePeekCard({ state, answer, onDismiss }: { state: PeekCardState; answer: PeekCardAnswer; onDismiss(): void }) {
  const [sentence, ...rest] = answer.text.split('\n\n')
  return (
    <div
      className={`peek-card peek-card--answer peek-card--idle${answer.failure ? ' peek-card--failed' : ''}${answer.muted ? ' peek-card--muted' : ''}`}
      role="status"
      aria-label={`${state.commandText ?? ''}: ${answer.text}. Tap to dismiss`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }}
    >
      <span className="peek-orb" aria-hidden="true" />
      <div className="peek-body">
        {state.commandText !== null ? <p className="peek-heard">“{state.commandText}”</p> : null}
        <p className="peek-sentence">{sentence}</p>
        {rest.length > 0 ? <p className="peek-more">{rest.join(' ')}</p> : null}
      </div>
    </div>
  )
}
