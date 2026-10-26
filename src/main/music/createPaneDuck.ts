import type { WebContents, WebFrameMain } from 'electron'
import { DUCK_SHARE } from '../../core/music/ducking'
import { duckAllScript, UNDUCK_ALL_JS } from '../browser/pageMediaScript'

// The pane's duck (#461, CONTEXT.md Ducking): while the ear is open, a line
// is spoken or the Timer rings, every media element playing in the pane —
// the Player's song or a page's own, in the top or any frame below it
// (#377) — drops to its floor, each marked with its own level (#459's
// Duck Mark), and the release gives each the level its mark holds. The
// marks live on the elements, so nothing is kept here but whether the
// duck holds: a volume a Media Op sets meanwhile moves the mark, and the
// release puts back what it holds. A document that loads while the duck
// holds is ducked as it lands, so media it starts drops too.

/** The pane as the duck reaches it: its frames, and the loads that bring new documents into them. */
export type DuckedPane = Pick<WebContents, 'isDestroyed' | 'on' | 'off'> & {
  readonly mainFrame: { readonly framesInSubtree: readonly Pick<WebFrameMain, 'executeJavaScript' | 'detached'>[] }
}

export interface PaneDuck {
  /** Ducks every playing element (on) or lets go (off); resolves when each frame has answered, a frame that fails passed over. */
  set(on: boolean): Promise<void>
  /** Stops hearing the pane's loads. */
  detach(): void
}

export function createPaneDuck(pane: DuckedPane, share: number = DUCK_SHARE): PaneDuck {
  let held = false
  const duckScript = duckAllScript(share)

  /** The script run in the top and every frame below it; a frame mid-navigation, or a pane gone, answers nothing. */
  async function everyFrame(script: string): Promise<void> {
    if (pane.isDestroyed()) return
    const frames = pane.mainFrame.framesInSubtree.filter((frame) => !frame.detached)
    await Promise.all(frames.map((frame) => frame.executeJavaScript(script).catch(() => undefined)))
  }

  const landed = (): void => {
    if (held) void everyFrame(duckScript)
  }
  pane.on('did-frame-finish-load', landed)

  return {
    set(on) {
      if (on === held) return Promise.resolve()
      held = on
      return everyFrame(on ? duckScript : UNDUCK_ALL_JS)
    },
    detach() {
      pane.off('did-frame-finish-load', landed)
    },
  }
}
