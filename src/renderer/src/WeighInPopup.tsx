import type { WeighInPopupState } from '../../core/scale/weighInPopup'
import { formatChange, formatKg } from '../../core/scale/weightFormat'

/**
 * The Weigh-in pop-up (CONTEXT.md): while the owner stands on the scale,
 * the weight settling — live and quiet while it moves, then the settled
 * weight with a stable mark and the change since the previous Weigh-in.
 * Shown over whatever is on screen: the dashboard draws it over the Idle
 * Screen, Settings and the Weight page, the overlay over the browsing pane.
 * Never focused, never spoken, never activity.
 */
export function WeighInPopup({ state }: { state: WeighInPopupState }) {
  if (state.phase === 'hidden') return null
  const settled = state.phase === 'settled'
  return (
    <div className={`weighin-popup weighin-popup--${state.phase}`} role="status" aria-label={settled ? `Weighed ${formatKg(state.kg)} kg` : `Weighing ${formatKg(state.kg)} kg`}>
      <span className="weighin-popup-mark" aria-hidden="true">
        {settled ? '✓' : ''}
      </span>
      <span className="weighin-popup-words">
        <span className="weighin-popup-kg">
          {formatKg(state.kg)}
          <small> kg</small>
        </span>
        <span className="weighin-popup-sub">{!settled ? 'weighing…' : state.changeKg === null ? 'first Weigh-in' : `${formatChange(state.changeKg, 2)} kg since the last`}</span>
      </span>
    </div>
  )
}
