import { isFeedPanelMode, type FeedPanelMode, type FeedPanelState } from '../panel/feedPanelState'
import type { Tool, ToolParameterSpec } from './tool'

// Panel voice tools (#64, ADR 0006): the orchestrator opens/collapses and
// docks/floats the feed panel by model-invoked tools on the panel-state
// seam — the same toggle/setMode the dashboard buttons and Ctrl+Shift+F
// drive, so every surface lands in one fold and one broadcast. Panel ops
// are silent (no TTS ack — the panel's own motion is the feedback) and
// unconfirmed (layout is instantly reversible), and there is no phrase
// routing: paraphrases ("hide the feed", "dock that") are the model's job,
// the same decision as new_session (ADR 0002).

/** The panel-state seam the tools drive — satisfied by the feed panel overlay. */
export interface PanelControls {
  toggle(): void
  setMode(mode: FeedPanelMode): void
  state(): FeedPanelState
}

export function createPanelTools(panel: PanelControls): Tool[] {
  const modeSpec: ToolParameterSpec = {
    type: 'string',
    enum: ['overlay', 'docked'],
    description: 'overlay floats the panel above the page; docked gives it layout space beside the page',
  }

  return [
    {
      name: 'toggle_panel',
      description:
        'Open the feed panel if it is collapsed, or collapse it to its edge tab if it is open. ' +
        'Fires immediately with no confirmation and no announcement — the panel moving is its own feedback.',
      execute: async () => {
        panel.toggle()
        return panel.state().open ? 'Panel opened.' : 'Panel collapsed.'
      },
    },
    {
      name: 'set_panel_mode',
      description:
        'Switch the feed panel between overlay (floating above the page) and docked (side-by-side layout) mode. ' +
        'Fires immediately with no confirmation and no announcement — the panel moving is its own feedback.',
      parameters: { mode: modeSpec },
      execute: async (call) => {
        const mode = call.args.mode
        if (!isFeedPanelMode(mode)) {
          throw new Error("set_panel_mode: 'mode' must be one of overlay, docked")
        }
        panel.setMode(mode)
        return `Panel mode set to ${mode}.`
      },
    },
  ]
}
