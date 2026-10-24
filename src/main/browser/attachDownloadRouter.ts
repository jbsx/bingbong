import { existsSync, mkdirSync } from 'node:fs'
import type { Session } from 'electron'
import type { PipelineEvent } from '../../core/pipeline/events'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { TtsSpeaker } from '../../core/ports/tts'
import { downloadAnnouncements, sanitizeDownloadFilename, uniqueDownloadPath } from '../../core/downloads/downloadRouting'

// Routed downloads (#423): every one on the kiosk, and on the desktop one a
// Task started (core/downloads/taskActivity.ts) — saved to the downloads
// folder and announced. Any other download, the user's own with the mouse,
// keeps Electron's default OS Save dialog. Routing policy lives in core
// (downloadRouting.ts, taskActivity.ts); this file is the thin Electron
// glue, covered by e2e.

export interface DownloadRouterDeps {
  dir: string
  tts: TtsSpeaker
  clock?: Clock
  /** Forwards announcement events to the dashboard (same channel as the pipeline). */
  emit(event: PipelineEvent): void
  /** Whether this download is routed rather than handed to the Save dialog, given its addresses (its redirect chain). */
  routes(urls: readonly string[]): boolean
}

export function attachDownloadRouter(target: Session, deps: DownloadRouterDeps): void {
  const { dir, tts, emit, routes } = deps
  const clock = deps.clock ?? systemClock
  // Paths claimed by in-flight downloads, so two same-name downloads cannot
  // race the existence check into the same file.
  const reserved = new Set<string>()

  target.on('will-download', (_event, item) => {
    if (!routes(item.getURLChain())) return
    mkdirSync(dir, { recursive: true })
    const filename = sanitizeDownloadFilename(item.getFilename())
    const savePath = uniqueDownloadPath(dir, filename, (path) => existsSync(path) || reserved.has(path))
    reserved.add(savePath)
    item.setSavePath(savePath)

    item.once('done', (_doneEvent, state) => {
      reserved.delete(savePath)
      if (state !== 'completed') return
      // One Answer, one entry (ADR 0013): the card renders and TTS speaks
      // the short line — no second feed speak event to duplicate the card.
      const { speak, display } = downloadAnnouncements(filename, savePath)
      emit({ type: 'display', text: display, at: clock.now() })
      void tts.speak(speak).then((outcome) => {
        if (!outcome.ok) emit({ type: 'error', message: `Voice unavailable: ${outcome.error}`, at: clock.now() })
      })
    })
  })
}
