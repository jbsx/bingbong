import type { BrowserController, KeyPress } from '../ports/browser'
import { coercedNumber, type Tool, type ToolParameterSpec } from './tool'

// Media verbs for the orchestrator, driven by key injection on the focused
// page (YouTube's shortcuts: k toggles play, arrows nudge volume, Shift+N
// skips to the next video, j/l seek ±10s per press). Deliberately no
// ad-skip verb exists — see toolSurface.test.ts, which pins the surface.

export type MediaAction = 'play_pause' | 'volume_up' | 'volume_down' | 'next' | 'seek'

export const MEDIA_ACTIONS: MediaAction[] = ['play_pause', 'volume_up', 'volume_down', 'next', 'seek']

/** YouTube's next-track shortcut — shared with the CLI `press` grammar. */
export const NEXT_TRACK_KEY: KeyPress = { key: 'n', shift: true }

const MEDIA_KEYS: Record<Exclude<MediaAction, 'seek'>, KeyPress> = {
  play_pause: { key: 'k' },
  volume_up: { key: 'ArrowUp' },
  volume_down: { key: 'ArrowDown' },
  next: NEXT_TRACK_KEY,
}

const SEEK_STEP_SECONDS = 10
/** One seek call may hold up to 30 presses (±5 minutes) — no key floods. */
const MAX_SEEK_PRESSES = 30

function isMediaAction(value: unknown): value is MediaAction {
  return typeof value === 'string' && (MEDIA_ACTIONS as string[]).includes(value)
}

function seekOffset(value: unknown): number | null {
  const offset = coercedNumber(value)
  return offset !== undefined && offset !== 0 ? offset : null
}

function seekPresses(offset: number): { press: KeyPress; times: number } {
  const times = Math.min(Math.ceil(Math.abs(offset) / SEEK_STEP_SECONDS), MAX_SEEK_PRESSES)
  return {
    press: { key: offset > 0 ? 'l' : 'j' },
    times,
  }
}

async function mediaOutcome(browser: BrowserController): Promise<string> {
  const state = await browser.mediaState()
  if (!state) return 'media: no media element found'
  const currentTime = Number(state.currentTime.toFixed(2))
  const volume = Math.round(state.volume * 100)
  return `media: paused=${state.paused} currentTime=${currentTime}s volume=${volume}%`
}

export function createMediaTools(browser: BrowserController): Tool[] {
  const parameters: Record<string, ToolParameterSpec> = {
    action: {
      type: 'string',
      enum: MEDIA_ACTIONS,
      description: 'play_pause toggles playback; volume_up/volume_down nudge 5%; next skips; seek moves by offset seconds',
    },
    offset: {
      type: 'number',
      description: 'Seconds to seek, positive (forward) or negative (backward); required for action "seek" (±300s max)',
    },
  }

  return [
    {
      name: 'media_control',
      description:
        'Control media playback on the focused page (YouTube etc.), then return actual paused, currentTime, and volume state read from the page.',
      parameters,
      execute: async (call) => {
        const action = call.args.action
        if (!isMediaAction(action)) {
          throw new Error(`media_control: 'action' must be one of ${MEDIA_ACTIONS.join(', ')}`)
        }

        if (action === 'seek') {
          const offset = seekOffset(call.args.offset)
          if (offset === null) {
            throw new Error(`media_control: 'offset' must be a non-zero number of seconds for action 'seek'`)
          }
          const { press, times } = seekPresses(offset)
          await browser.pressKey(press, times)
          return mediaOutcome(browser)
        }

        await browser.pressKey(MEDIA_KEYS[action])
        return mediaOutcome(browser)
      },
    },
  ]
}
