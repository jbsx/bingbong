import { useEffect, useState } from 'react'
import type { PipelineEvent } from '../../../core/pipeline/events'
import type { VoiceErrorEvent, VoiceHeardEvent } from '../../../core/voice/ipcChannels'
import { defaultFeedPanelWidth, type FeedPanelState } from '../../../core/panel/feedPanelState'
import { useFeedProjection } from '../useFeedProjection'
import { useSessionAdoption } from '../useSessionAdoption'

// The overlay half of the feed panel (#45): the shared feed projection
// (same as the dashboard's) fed from the panel's own webContents
// subscriptions — hydration, pipeline events, and voice lines all arrive
// over the same channels the dashboard subscribes to.

export function useOverlayFeed(): Pick<ReturnType<typeof useFeedProjection>, 'feed' | 'liveRunId'> {
  const projection = useFeedProjection()

  useEffect(() => {
    const unsubEvents = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      projection.handleEvent(event)
    })
    const unsubHeard = window.bingbong.voice.onHeard((heard: VoiceHeardEvent) => {
      projection.appendHeard(heard)
    })
    const unsubError = window.bingbong.voice.onError((error: VoiceErrorEvent) => {
      projection.appendVoiceError(error.message, error.at)
    })
    return () => {
      unsubEvents()
      unsubHeard()
      unsubError()
    }
    // The projection object's identity changes per render, but its methods
    // close over one ref-backed projection — subscribing once is correct.
  }, [])

  // Re-adoption (ADR 0017): a reloaded overlay's fresh projection accepts
  // the still-live Run's next Feed Entries.
  useSessionAdoption((identity) => projection.adoptSession(identity))

  return { feed: projection.feed, liveRunId: projection.liveRunId }
}

export function usePanelState(): FeedPanelState {
  // Kiosk ships a narrower default width (#65); main's folded state
  // (pulled on mount, then broadcast) is the truth this mirrors.
  const [state, setState] = useState<FeedPanelState>(() => ({
    mode: 'overlay',
    open: false,
    width: defaultFeedPanelWidth(window.bingbong.app.kiosk),
  }))

  useEffect(() => {
    let cancelled = false
    void window.bingbong.feedPanel.getState().then((pulled) => {
      if (!cancelled && pulled) setState(pulled)
    })
    const unsubscribe = window.bingbong.feedPanel.onState(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}
