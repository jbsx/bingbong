import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createPeekCardFold, peekCardVisible, PEEK_CARD_LINGER_MS, type PeekCardState } from '../../core/panel/peekCardState'

// The dashboard half of the Peek Card (ADR 0021): the pure fold in core
// owns the phase; this hook owns the renderer facts around it — the hover
// pin (a pointer resting on the card pauses the linger), the one-shot
// countdown re-render at the anchor's expiry, and the dismissal when the
// panel opens (the peek reports; the panel acts — opening it retires the
// report).

export interface PeekCardView {
  visible: boolean
  state: PeekCardState
  /** Hover pin: holds the answer card past its linger while the pointer rests on it. */
  setPinned(pinned: boolean): void
}

export function usePeekCard(panelOpen: boolean): PeekCardView {
  const foldRef = useRef(createPeekCardFold())
  const [state, setState] = useState<PeekCardState>(() => foldRef.current.state())
  const [pinned, setPinned] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const unsubscribe = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      foldRef.current.onEvent(event)
      setState(foldRef.current.state())
      setNow(Date.now())
    })
    return unsubscribe
  }, [])

  // Opening the panel dismisses the card — and it stays dismissed when the
  // panel closes again: the user already saw the answer up close.
  useEffect(() => {
    if (panelOpen) {
      foldRef.current.dismiss()
      setState(foldRef.current.state())
    }
  }, [panelOpen])

  // The linger countdown: one timer at the expiry re-renders; the hover
  // pin cancels it, and unpinning re-arms whatever remains (nothing, if
  // the anchor already passed — the card retracts then).
  useEffect(() => {
    if (state.phase !== 'answer' || pinned) return
    const remaining = state.anchoredAt + PEEK_CARD_LINGER_MS - Date.now()
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [state, pinned])

  const visible = !panelOpen && (pinned ? state.phase !== 'hidden' : peekCardVisible(state, now))
  return { visible, state, setPinned }
}
