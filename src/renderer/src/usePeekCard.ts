import { useEffect } from 'react'
import type { TurnCardState } from '../../core/idle/turnCard'
import { retiredByPanel } from '../../core/panel/peekCardState'
import { useTurnCard } from './useTurnCard'

// The dashboard half of the Peek Card (ADR 0021, amended by ADR 0026; the
// Ledger Strip, #475): the Turn Card's pure fold (#474) owns the line's
// state; the Turn Card's hook owns the subscriptions and the
// clock that ends the band 15 s after the line is over (#470); this hook
// adds the suppression while the panel is open.
// Opening the panel retires a finished line — the user saw it up close —
// while the live report survives, so closing the panel mid-run revives the
// band. The dashboard and the overlay each fold the same seams, and the
// end is read from their timestamps, so both drop the band together.

export interface PeekCardView {
  visible: boolean
  state: TurnCardState
}

export function usePeekCard(panelOpen: boolean): PeekCardView {
  const { state, dismiss } = useTurnCard()

  useEffect(() => {
    if (retiredByPanel(panelOpen, state)) dismiss()
  }, [panelOpen, state, dismiss])

  const visible = !panelOpen && state.phase === 'open'
  return { visible, state }
}
