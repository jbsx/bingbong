import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createPeekCardFold, peekCardVisible, type PeekCardState } from '../../core/panel/peekCardState'

// The dashboard half of the Peek Card (ADR 0021, amended by ADR 0026): the
// pure fold in core owns the phase; this hook owns the renderer facts
// around it — the event subscription and the suppression while the panel
// is open. Opening the panel retires the answer; the live report survives,
// so closing the panel mid-run revives the card.

export interface PeekCardView {
  visible: boolean
  state: PeekCardState
}

export function usePeekCard(panelOpen: boolean): PeekCardView {
  const foldRef = useRef(createPeekCardFold())
  const [state, setState] = useState<PeekCardState>(() => foldRef.current.state())

  useEffect(() => {
    const unsubscribe = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      foldRef.current.onEvent(event)
      setState(foldRef.current.state())
    })
    return unsubscribe
  }, [])

  // Opening the panel retires the answer — the user saw it up close. The
  // live Run survives (ADR 0026); closing the panel again revives it.
  useEffect(() => {
    if (panelOpen) {
      foldRef.current.retireAnswer()
      setState(foldRef.current.state())
    }
  }, [panelOpen])

  const visible = !panelOpen && peekCardVisible(state)
  return { visible, state }
}
