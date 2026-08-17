import type { BrowserController, KeyPress } from '../ports/browser'
import type { Tool, ToolParameterSpec } from './tool'

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
  const offset = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset === 0) return null
  return offset
}

function seekPresses(offset: number): { press: KeyPress; times: number; seconds: number } {
  const times = Math.min(Math.ceil(Math.abs(offset) / SEEK_STEP_SECONDS), MAX_SEEK_PRESSES)
  return {
    press: { key: offset > 0 ? 'l' : 'j' },
    times,
    seconds: times * SEEK_STEP_SECONDS,
  }
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
        'Control media playback on the focused page (YouTube etc.): pause or resume with play_pause, nudge volume, next track, or seek by seconds.',
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
          const { press, times, seconds } = seekPresses(offset)
          await browser.pressKey(press, times)
          const direction = offset > 0 ? 'forward' : 'backward'
          return `seeked ${direction} ${seconds}s (${times} presses)`
        }

        await browser.pressKey(MEDIA_KEYS[action])
        switch (action) {
          case 'play_pause':
            return 'toggled play/pause'
          case 'volume_up':
            return 'volume up (5%)'
          case 'volume_down':
            return 'volume down (5%)'
          case 'next':
            return 'next track'
        }
      },
    },
  ]
}
