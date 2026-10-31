import { useCallback, useEffect, useRef, useState } from 'react'
import { createTurnCardFold, type TurnCardState } from '../../core/idle/turnCard'
import { onCommandTap } from './tapCommand'

// The renderer half of the Turn Card (#474): the pure fold in core owns
// the card's state; this hook owns the subscriptions — the voice state and
// its partials, the `heard` IPC, the pipeline events — and the clock that
// ends the card 15 s after its line is over (the Peek Card's own rule, read
// from the events' timestamps, so a card shown late still goes on time).

export interface TurnCardView {
  state: TurnCardState
  /** A tap on the card: it goes, the line it reported untouched. */
  dismiss(): void
}

export function useTurnCard(): TurnCardView {
  const foldRef = useRef(createTurnCardFold())
  const [state, setState] = useState<TurnCardState>(() => foldRef.current.state())

  useEffect(() => {
    const fold = foldRef.current
    const sync = (): void => setState(fold.state())
    const unsubscribers = [
      window.bingbong.voice.onState((voice) => {
        fold.onVoice(voice, Date.now())
        sync()
      }),
      window.bingbong.voice.onPartial((event) => {
        fold.onPartial(event.text)
        sync()
      }),
      window.bingbong.voice.onHeard((heard) => {
        fold.onHeard({ ...heard, at: heard.at ?? Date.now() })
        sync()
      }),
      window.bingbong.assistant.onEvent((event) => {
        fold.onEvent(event)
        sync()
      }),
      onCommandTap((mark) => fold.onControlTap(mark)),
    ]
    // Monitoring can be up before this mounted: pull the truth.
    void window.bingbong.voice.getState().then((voice) => {
      fold.onVoice(voice, Date.now())
      sync()
    })
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  // The card goes when its time is up; nothing pauses it.
  useEffect(() => {
    const retiresAt = state.retiresAt
    if (state.phase !== 'open' || retiresAt === null) return
    const timer = setTimeout(() => {
      // A timer a millisecond early still ends it: the deadline it was armed for has passed.
      foldRef.current.expire(Math.max(Date.now(), retiresAt))
      setState(foldRef.current.state())
    }, Math.max(0, retiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [state.phase, state.retiresAt])

  const dismiss = useCallback(() => {
    foldRef.current.dismiss()
    setState(foldRef.current.state())
  }, [])

  return { state, dismiss }
}
