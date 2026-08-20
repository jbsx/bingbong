import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../../core/pipeline/events'
import type { VoiceErrorEvent, VoiceHeardEvent } from '../../../core/voice/ipcChannels'
import { describeHeard } from '../../../core/voice/heardDisplay'
import { createFeedProjection, type FeedEntry } from '../../../core/history/feedProjection'
import type { FeedPanelState } from '../../../core/panel/feedPanelState'

// The overlay half of the feed panel (#45): the same pure feed projection
// the dashboard folded in #44, running inside the panel's own webContents —
// hydration, pipeline events, and voice lines all arrive over the same
// channels the dashboard subscribes to.

export function useOverlayFeed(): FeedEntry[] {
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const projection = useRef(createFeedProjection())

  // Restart hydration (#44 semantics): recorded outcomes only; the
  // projection's dedup closes the race with live events.
  useEffect(() => {
    let cancelled = false
    void window.bingbong.history
      .recentEntries()
      .then((recorded) => {
        if (cancelled) return
        projection.current.hydrate(recorded)
        setFeed(projection.current.entries())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubEvents = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      projection.current.onEvent(event)
      setFeed(projection.current.entries())
    })
    const unsubHeard = window.bingbong.voice.onHeard((heard: VoiceHeardEvent) => {
      if (heard.routed === 'command') return
      projection.current.append({ kind: 'voice', text: describeHeard(heard), at: heard.at ?? Date.now() })
      setFeed(projection.current.entries())
    })
    const unsubError = window.bingbong.voice.onError((error: VoiceErrorEvent) => {
      projection.current.append({ kind: 'error', text: `voice: ${error.message}`, at: error.at })
      setFeed(projection.current.entries())
    })
    return () => {
      unsubEvents()
      unsubHeard()
      unsubError()
    }
  }, [])

  return feed
}

export function usePanelState(): FeedPanelState {
  const [state, setState] = useState<FeedPanelState>({ mode: 'overlay', open: false })

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
