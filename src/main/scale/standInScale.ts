import { readFileSync, statSync } from 'node:fs'
import { fromHex } from '../../core/scale/qn'
import { reportFault } from '../../core/trace/fault'
import type { ScaleTransport } from './bluezScale'

/**
 * The e2e's stand-in scale: with BINGBONG_SCALE_FIXTURE naming a file, the
 * Scale Listener never touches Bluetooth; each time the file appears or
 * changes, it is played as one connection — a line of hex is a frame the
 * scale notifies, 200 ms after the one before; `+<ms>` waits that much
 * longer. The writes Bing Bong answers with are dropped. Test support
 * only: nothing sets it outside the e2e harness.
 */
export const SCALE_FIXTURE_ENV = 'BINGBONG_SCALE_FIXTURE'

/** The address the stand-in connects as: the Scale Listener never remembers it. */
export const STAND_IN_ADDRESS = '00:00:00:00:00:00'

const FRAME_GAP_MS = 200
const POLL_MS = 250

export function createStandInScaleTransport(path: string): ScaleTransport {
  return (events) => {
    let played = 0
    let playing = false
    let stopped = false
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    const play = async (script: string): Promise<void> => {
      playing = true
      events.status({ state: 'connected', detail: 'stand-in' })
      events.connected(STAND_IN_ADDRESS, { write: async () => undefined, disconnect: async () => undefined })
      for (const line of script.split('\n').map((text) => text.trim())) {
        if (stopped) break
        if (line === '') continue
        const pause = /^\+(\d+)$/.exec(line)
        if (pause) {
          await wait(Number(pause[1]))
          continue
        }
        await wait(FRAME_GAP_MS)
        events.frame(fromHex(line))
      }
      events.disconnected()
      events.status({ state: 'stand-in', detail: '' })
      playing = false
    }

    events.status({ state: 'stand-in', detail: '' })
    const poll = setInterval(() => {
      if (playing) return
      try {
        const changed = statSync(path).mtimeMs
        if (changed === played) return
        played = changed
        void play(readFileSync(path, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('scale.standIn', error)
      }
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(poll)
    }
  }
}
