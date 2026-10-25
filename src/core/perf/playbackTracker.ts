import type { PlaybackRecord } from './appTelemetry'

// The pane's media as the playback script reports it (kiosk telemetry
// 2026-10-25): each poll hands the media now on the page and the media the
// page closed since the last; one Playback Record is written per piece of
// media, when its page closes it (its source changed, it ended) or the
// document it was on is gone. By kind: any audio or video element.

/** One piece of media as the page saw it at a poll. */
export interface PlaybackView extends Omit<PlaybackRecord, 'closed'> {
  /** Unique across documents: the document's time origin and the element's number in it. */
  key: string
  /** The page closed it since the last poll, and why. */
  closed?: 'changed' | 'ended'
}

export interface PlaybackPoll {
  items: PlaybackView[]
  closed: PlaybackView[]
}

export interface PlaybackTracker {
  /** One poll's answer; null when the page could not be read (a navigation under way), which closes nothing. */
  observe(poll: PlaybackPoll | null): void
  /** Closes everything still open as left: the app is quitting. */
  flush(): void
}

export function createPlaybackTracker(write: (record: PlaybackRecord) => void): PlaybackTracker {
  let open = new Map<string, PlaybackView>()

  function close(view: PlaybackView, closed: PlaybackRecord['closed']): void {
    const { key: _key, closed: _closed, ...rest } = view
    write({ ...rest, closed })
  }

  return {
    observe(poll) {
      if (poll === null) return
      const next = new Map<string, PlaybackView>()
      for (const view of poll.closed) {
        open.delete(view.key)
        close(view, view.closed ?? 'changed')
      }
      for (const view of poll.items) next.set(view.key, view)
      // What was open and the page no longer has went with its document.
      for (const [key, view] of open) if (!next.has(key)) close(view, 'left')
      open = next
    },
    flush() {
      for (const view of open.values()) close(view, 'left')
      open = new Map()
    },
  }
}
