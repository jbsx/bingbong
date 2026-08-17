import { existsSync, mkdirSync } from 'node:fs'
import type { Session } from 'electron'
import type { PipelineEvent } from '../../core/pipeline/events'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { TtsSpeaker } from '../../core/ports/tts'
import { downloadAnnouncements, sanitizeDownloadFilename, uniqueDownloadPath } from '../../core/downloads/downloadRouting'

// Agent-initiated downloads: the risk gate has already asked the user before
// the click that started this download (core/pipeline/riskGate.ts), and the
// tracker (core/downloads/agentActivity.ts) tells us the agent was driving
// the pane. Manual downloads — the user browsing the pane themselves — keep
// Electron's default OS save dialog. Routing policy lives in core
// (downloadRouting.ts); this file is the thin Electron glue, covered by e2e.

export interface DownloadRouterDeps {
  dir: string
  tts: TtsSpeaker
  clock?: Clock
  /** Forwards announcement events to the dashboard (same channel as the pipeline). */
  emit(event: PipelineEvent): void
  /** Only downloads that start while the agent drives the pane are routed. */
  isAgentActive(): boolean
}

export function attachDownloadRouter(target: Session, deps: DownloadRouterDeps): void {
  const { dir, tts, emit, isAgentActive } = deps
  const clock = deps.clock ?? systemClock
  // Paths claimed by in-flight downloads, so two same-name downloads cannot
  // race the existence check into the same file.
  const reserved = new Set<string>()

  target.on('will-download', (_event, item) => {
    if (!isAgentActive()) return
    mkdirSync(dir, { recursive: true })
    const filename = sanitizeDownloadFilename(item.getFilename())
    const savePath = uniqueDownloadPath(dir, filename, (path) => existsSync(path) || reserved.has(path))
    reserved.add(savePath)
    item.setSavePath(savePath)

    item.once('done', (_doneEvent, state) => {
      reserved.delete(savePath)
      if (state !== 'completed') return
      const { speak, display } = downloadAnnouncements(filename, savePath)
      emit({ type: 'display', text: display, at: clock.now() })
      emit({ type: 'speak', text: speak, at: clock.now() })
      void tts.speak(speak)
    })
  })
}
