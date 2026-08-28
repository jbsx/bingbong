import {
  FEED_PANEL_WIDTH_MAX_STEPS,
  isFeedPanelMode,
  isPanelWidthDirection,
  isPanelWidthPreset,
  presetFeedPanelWidth,
  stepFeedPanelWidth,
  type FeedPanelMode,
  type FeedPanelState,
} from '../panel/feedPanelState'
import type { Tool, ToolParameterSpec } from './tool'
import { coercedNumber } from './tool'

// Panel voice tools (#64/#71, ADR 0006): the orchestrator opens/collapses,
// docks/floats, and resizes the feed panel by model-invoked tools on the
// panel-state seam — the same toggle/setMode/setWidth the dashboard buttons,
// the drag handle, and Ctrl+Shift+F drive, so every surface lands in one
// fold, one clamp policy, and one broadcast (and the dashboard mirrors the
// width to storage, so voice changes persist exactly like drags). Panel ops
// are silent (no TTS ack — the panel's own motion is the feedback) and
// unconfirmed (layout is instantly reversible), and there is no phrase
// routing: paraphrases ("hide the feed", "make it wider") are the model's
// job, the same decision as new_session (ADR 0002). The width grammar is
// relative only — steps and presets, never absolute pixels (spec #71).

/** The panel-state seam the tools drive — satisfied by the feed panel overlay. */
export interface PanelControls {
  toggle(): void
  setMode(mode: FeedPanelMode): void
  /** Sets the panel width in px; the seam clamps to the window's bounds (#65). */
  setWidth(width: number): void
  /** The window's content width — the basis for presets and clamping (#71). */
  windowWidth(): number
  state(): FeedPanelState
}

/**
 * A step count may arrive as a string ("2") — the shared coercion. Anything
 * but a whole number 1-max rejects — emphasis has bounds.
 */
function stepCount(raw: unknown): number {
  const value = coercedNumber(raw)
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > FEED_PANEL_WIDTH_MAX_STEPS) {
    throw new Error(`set_panel_width: 'steps' must be a whole number 1-${FEED_PANEL_WIDTH_MAX_STEPS}`)
  }
  return value
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
        'Fires immediately with no confirmation and no announcement — the panel moving is its own feedback. ' +
        'Returns the resulting open/collapsed state, which is sufficient verification.',
      execute: async () => {
        panel.toggle()
        return panel.state().open ? 'Panel opened.' : 'Panel collapsed.'
      },
    },
    {
      name: 'set_panel_mode',
      description:
        'Switch the feed panel between overlay (floating above the page) and docked (side-by-side layout) mode. ' +
        'Fires immediately with no confirmation and no announcement — the panel moving is its own feedback. ' +
        'Returns the resulting mode, which is sufficient verification.',
      parameters: { mode: modeSpec },
      execute: async (call) => {
        const mode = call.args.mode
        if (!isFeedPanelMode(mode)) {
          throw new Error("set_panel_mode: 'mode' must be one of overlay, docked")
        }
        panel.setMode(mode)
        return `Panel mode set to ${panel.state().mode}.`
      },
    },
    {
      name: 'set_panel_width',
      description:
        'Widen or narrow the feed panel in relative steps (wider or narrower, up to 5 steps per call), or apply a ' +
        'preset (half_screen). There are no absolute sizes — say which way, not how many pixels. ' +
        'Fires immediately with no confirmation and no announcement — the panel resizing is its own feedback. ' +
        'Returns the resulting clamped width, which is sufficient verification.',
      parameters: {
        direction: {
          type: 'string',
          enum: ['wider', 'narrower'],
          description: 'Move the panel wider (more reading room) or narrower (more room for the page)',
          required: false,
        },
        steps: {
          type: 'integer',
          description: `How many steps to move, 1-${FEED_PANEL_WIDTH_MAX_STEPS} (default 1) — how emphatic the "wider" or "narrower" was`,
          required: false,
        },
        preset: {
          type: 'string',
          enum: ['half_screen'],
          description: 'A named width preset: half_screen sizes the panel to half the window',
          required: false,
        },
      },
      execute: async (call) => {
        const direction = call.args.direction
        const preset = call.args.preset
        const directionGiven = isPanelWidthDirection(direction)
        const presetGiven = isPanelWidthPreset(preset)
        if (direction !== undefined && !directionGiven) {
          throw new Error("set_panel_width: 'direction' must be wider or narrower")
        }
        if (preset !== undefined && !presetGiven) {
          throw new Error("set_panel_width: 'preset' must be one of: half_screen")
        }
        if (directionGiven === presetGiven) {
          // Exactly one of direction/preset — both is ambiguous, neither is
          // no instruction; either way the model must restate the intent.
          throw new Error("set_panel_width: give exactly one of 'direction' (with optional 'steps') or 'preset'")
        }
        const steps = call.args.steps === undefined ? 1 : stepCount(call.args.steps)
        if (call.args.steps !== undefined && !directionGiven) {
          throw new Error("set_panel_width: 'steps' only applies with 'direction'")
        }

        const windowWidth = panel.windowWidth()
        let target: number
        if (presetGiven) {
          target = presetFeedPanelWidth(preset, windowWidth)
        } else if (directionGiven) {
          target = stepFeedPanelWidth(panel.state().width, direction, steps, windowWidth)
        } else {
          // Unreachable: exactly-one-of was enforced above.
          throw new Error('set_panel_width: neither direction nor preset resolved')
        }
        panel.setWidth(target)
        // The seam clamps against the live window before folding; the folded
        // width is the truth worth reporting.
        return `Panel width set to ${panel.state().width}px.`
      },
    },
  ]
}
