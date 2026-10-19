import type { WeighInPopupState } from '../../core/scale/weighInPopup'
import { formatChange, formatKg } from '../../core/scale/weightFormat'
import { reportRendererFault } from './diagnostics'

/**
 * The Weigh-in pop-up (CONTEXT.md): while the owner stands on the scale,
 * the weight settling — live and quiet while it moves, then the settled
 * weight with a stable mark, the guessed Person's name and the change
 * since their previous Weigh-in, and a chip per other Person that moves
 * the Weigh-in with one tap. Shown over whatever is on screen: the
 * dashboard draws it over the Idle Screen, Settings and the Weight page,
 * the overlay over the browsing pane. Never focused, never spoken, never
 * activity: a chip acts on the pointer going down and keeps it from the
 * window, so the Idle Screen stays up and no focus moves.
 */
export function WeighInPopup({ state }: { state: WeighInPopupState }) {
  if (state.phase === 'hidden') return null
  const settled = state.phase === 'settled'
  return (
    <div className={`weighin-popup weighin-popup--${state.phase}`} role="status" aria-label={settled ? `Weighed ${formatKg(state.kg)} kg, ${state.person.name}` : `Weighing ${formatKg(state.kg)} kg`}>
      <span className="weighin-popup-mark" aria-hidden="true">
        {settled ? '✓' : ''}
      </span>
      <span className="weighin-popup-words">
        <span className="weighin-popup-kg">
          {formatKg(state.kg)}
          <small> kg</small>
        </span>
        <span className="weighin-popup-sub">
          {!settled ? (
            'weighing…'
          ) : (
            <>
              <b className="weighin-popup-name">{state.person.name}</b> · {state.changeKg === null ? 'first Weigh-in' : `${formatChange(state.changeKg, 2)} kg since the last`}
            </>
          )}
        </span>
      </span>
      {settled && state.others.length > 0 ? (
        <span className="weighin-popup-chips" role="group" aria-label="not you?">
          {state.others.map((person) => (
            <button
              key={person.id}
              type="button"
              tabIndex={-1}
              className="weighin-popup-chip"
              data-person={person.id}
              aria-label={`It was ${person.name}`}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                window.bingbong.weight.move(state.at, person.id).catch((error: unknown) => reportRendererFault('weight.move', error))
              }}
            >
              {person.name}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  )
}
