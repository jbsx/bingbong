import { useCallback, useEffect, useState } from 'react'
import type { EvidenceBrowserView } from '../../core/session/evidenceBrowserView'
import { isEvidenceBrowserViewPayload } from '../../core/session/evidenceIpcChannels'

// The selected Activity/Evidence view (#145): Session-owned state folded in
// main, so the selection survives docking, undocking, reload, and renderer
// crash within the Session — and Session boundaries return it to Activity.
// The pull restores a recovered page; the broadcast keeps every
// session-bearing page on main's folded word. This hook never persists
// anything: a Session's view is not a preference.

export function useEvidenceBrowserView(): {
  view: EvidenceBrowserView
  setView(view: EvidenceBrowserView): void
} {
  const [view, setViewState] = useState<EvidenceBrowserView>('activity')

  useEffect(() => {
    let cancelled = false
    // A reloaded or recovered page restores the Session's selection.
    void window.bingbong.evidence.getView().then((pulled) => {
      if (!cancelled && pulled !== null) setViewState(pulled)
    })
    const unsubscribe = window.bingbong.evidence.onViewChanged((payload) => {
      if (isEvidenceBrowserViewPayload(payload)) setViewState(payload.view)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Optimistic locally, authoritative from main: the echo confirms, and a
  // boundary crossed in between corrects — main's fold is the truth.
  const setView = useCallback((next: EvidenceBrowserView) => {
    setViewState(next)
    window.bingbong.evidence.setView(next)
  }, [])

  return { view, setView }
}
