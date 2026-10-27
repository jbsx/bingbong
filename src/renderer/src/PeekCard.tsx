import type { TurnCardState } from '../../core/idle/turnCard'
import { TurnHistory, TurnRail, TurnStageRow, TurnWordsRow, turnFace, useTurnClock } from './TurnCard'

// The Peek Card (ADR 0021, 0026, 0029; glossary), in its Ledger Strip form
// (#475): the system-pushed report of a spoken or typed line's whole
// journey while the Feed Panel is Collapsed — a band the pane's width at
// its bottom, from the wake to 15 s past the Answer's sentence (#470),
// drawn from the Turn Card's own fold and pieces (#474): the rail, the
// stage row, the words row and five history rows, in another frame. Voice
// shows it, only a human act opens the panel, and clicking it is that act.
// It renders from the panel's overlay view (ADR 0029) — the one surface
// that floats above the native pane — replacing the collapsed edge tab;
// it is not a state of the panel. Its geometry is fixed (#474's rule):
// nothing on it moves between states.

/** The band's history rows (#475): five, where the Turn Card holds six. */
const BAND_HISTORY_ROWS = 5

export function PeekCard({ state, onOpen }: { state: TurnCardState; onOpen(): void }) {
  const now = useTurnClock()
  const face = turnFace(state)
  return (
    <div
      className={`peek-card peek-card--band turn-card--tone-${face.tone}`}
      data-state={face.name}
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
      <TurnRail station={face.station} />
      <div className="peek-columns">
        <div className="peek-left">
          <TurnStageRow state={state} face={face} now={now} />
          <TurnWordsRow state={state} />
          <span className="peek-open-hint" aria-hidden="true">
            open the feed ›
          </span>
        </div>
        <TurnHistory state={state} rows={BAND_HISTORY_ROWS} />
      </div>
    </div>
  )
}
