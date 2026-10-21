import type { WebContents, WebFrameMain } from 'electron'
import type { AudioDucker } from '../../core/ports/tts'
import { applyMediaVolumesScript, COLLECT_MEDIA_VOLUMES_SCRIPT, DUCK_FACTOR, duckedVolumes } from '../../core/tts/duckVolumes'

type DuckState = 'idle' | 'ducking' | 'ducked'

/** A frame below the top, as far as ducking needs it (#377). */
type DuckedFrame = Pick<WebFrameMain, 'executeJavaScript'>

/**
 * Ducks the browser pane's media elements: collect current volumes, scale
 * them down, restore the exact prior levels afterwards. The state machine
 * matters because executeJavaScript is async — a restore that lands while the
 * duck is still in flight cancels it, so a short or failed line can never
 * leave the page ducked. Other failures (page mid-navigation, no media) are
 * swallowed — ducking is best-effort polish, never a reason to fail speech.
 *
 * Every frame below the top is ducked the same way in its own context
 * (#377, ADR 0081): an embedded player is never left playing over speech.
 * Each frame keeps its own levels, and a frame that answers after the
 * restore is never ducked late; nothing waits on any frame.
 */
export function createPaneAudioDucker(wc: WebContents, factor: number = DUCK_FACTOR): AudioDucker {
  let state: DuckState = 'idle'
  let originals: number[] = []
  // Each duck's generation: a frame's volumes that come back after the restore belong to no duck.
  let generation = 0
  const frameOriginals = new Map<DuckedFrame, number[]>()

  function apply(volumes: number[]): void {
    if (wc.isDestroyed()) return
    void wc.executeJavaScript(applyMediaVolumesScript(volumes)).catch(() => {})
  }

  /** The frames below the top, any depth; none once the pane is gone. */
  function frames(): DuckedFrame[] {
    if (wc.isDestroyed()) return []
    const top = wc.mainFrame
    return top.framesInSubtree.filter((frame) => frame !== top && !frame.detached)
  }

  function duckFrames(): void {
    const current = generation
    for (const frame of frames()) {
      void frame
        .executeJavaScript(COLLECT_MEDIA_VOLUMES_SCRIPT)
        .then((volumes: unknown) => {
          if (current !== generation || !Array.isArray(volumes) || volumes.length === 0) return
          const levels = volumes.map(Number)
          frameOriginals.set(frame, levels)
          return frame.executeJavaScript(applyMediaVolumesScript(duckedVolumes(levels, factor)))
        })
        .catch(() => {})
    }
  }

  function restoreFrames(): void {
    generation += 1
    for (const [frame, levels] of frameOriginals) void frame.executeJavaScript(applyMediaVolumesScript(levels)).catch(() => {})
    frameOriginals.clear()
  }

  return {
    duck() {
      if (state !== 'idle' || wc.isDestroyed()) return
      state = 'ducking'
      duckFrames()
      void wc
        .executeJavaScript(COLLECT_MEDIA_VOLUMES_SCRIPT)
        .then((volumes) => {
          const current = Array.isArray(volumes) ? volumes.map(Number) : []
          if (state !== 'ducking') return
          originals = current
          state = 'ducked'
          apply(duckedVolumes(current, factor))
        })
        .catch(() => {
          if (state === 'ducking') state = 'idle'
        })
    },
    restore() {
      restoreFrames()
      if (state === 'ducking') {
        // Duck never landed — cancel it instead of ducking a finished line.
        state = 'idle'
        return
      }
      if (state !== 'ducked') return
      state = 'idle'
      apply(originals)
    },
  }
}
