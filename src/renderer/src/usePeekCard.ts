import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createPeekCardFold, peekCardVisible, type PeekCardState } from '../../core/panel/peekCardState'

// The dashboard half of the Peek Card (ADR 0021, amended by ADR 0026): the
// pure fold in core owns the phase and the turn's ledger (#475); this hook
// owns the renderer facts around it — the event and ear subscriptions, the
// suppression while the panel is open, and the clock that ends the Answer
// (#470). Opening the panel retires the answer; the live report survives,
// so closing the panel mid-run revives the card. The dashboard and the
// overlay each fold the same events and ear states, and the end is read
// from their timestamps, so both drop the card together.

export interface PeekCardView {
  visible: boolean
  state: PeekCardState
}

export function usePeekCard(panelOpen: boolean): PeekCardView {
  const foldRef = useRef(createPeekCardFold())
  const [state, setState] = useState<PeekCardState>(() => foldRef.current.state())

  useEffect(() => {
    const fold = foldRef.current
    const publish = (): void => setState(fold.state())
    const unsubscribe = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      fold.onEvent(event)
      publish()
    })
    // The ear (#475): the card opens on the wake, grows with the partial, and takes the heard line; main's state may predate this page.
    void window.bingbong.voice.getState().then((voice) => {
      fold.onVoice(voice, Date.now())
      publish()
    })
    const unsubVoice = window.bingbong.voice.onState((voice) => {
      fold.onVoice(voice, Date.now())
      publish()
    })
    const unsubPartial = window.bingbong.voice.onPartial((partial) => {
      fold.onPartial(partial)
      publish()
    })
    const unsubHeard = window.bingbong.voice.onHeard((heard) => {
      fold.onHeard({ ...heard, at: heard.at ?? Date.now() })
      publish()
    })
    return () => {
      unsubscribe()
      unsubVoice()
      unsubPartial()
      unsubHeard()
    }
  }, [])

  // An open panel retires the answer — the user saw it up close: opening
  // it over an answer still showing, and a Command ending while the human holds
  // it open (#331). The live report survives (ADR 0026); closing the panel
  // while the Command acts revives it.
  useEffect(() => {
    if (panelOpen && state.phase === 'answer') {
      foldRef.current.retireAnswer()
      setState(foldRef.current.state())
    }
  }, [panelOpen, state.phase])

  // The Answer goes when its time is up (#470); nothing pauses it.
  useEffect(() => {
    const retiresAt = state.retiresAt
    if (state.phase !== 'answer' || retiresAt === null) return
    const timer = setTimeout(() => {
      // A timer a millisecond early still ends it: the deadline it was armed for has passed.
      foldRef.current.expire(Math.max(Date.now(), retiresAt))
      setState(foldRef.current.state())
    }, Math.max(0, retiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [state.phase, state.retiresAt])

  const visible = !panelOpen && peekCardVisible(state)
  return { visible, state }
}
