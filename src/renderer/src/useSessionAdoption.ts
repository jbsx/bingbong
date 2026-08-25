import { useEffect } from 'react'
import type { SessionAdoptionPayload } from '../../core/session/ipcChannels'

/**
 * Renderer session re-adoption (ADR 0017), shared by every session-bearing
 * page (dashboard and feed panel overlay): pull the live Session's
 * identity on mount and hear main's late-load re-send, so a page lost
 * mid-Session comes back on its Session instead of looking like a fresh
 * boot. Adoption is identity-only — recovery stays forward-only.
 */
export function useSessionAdoption(onAdopt: (identity: SessionAdoptionPayload) => void): void {
  useEffect(() => {
    let cancelled = false
    const adopt = (identity: SessionAdoptionPayload | null): void => {
      if (!cancelled && identity) onAdopt(identity)
    }
    void window.bingbong.session.current().then(adopt)
    const unsubscribe = window.bingbong.session.onReadopt(adopt)
    return () => {
      cancelled = true
      unsubscribe()
    }
    // `onAdopt` closes over the caller's ref-backed state (the feed
    // projection, the identity ref) — subscribing once is correct.
  }, [])
}
