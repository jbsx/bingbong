import type { Session } from 'electron'
import type { BrowserController } from '../../core/ports/browser'
import type { BrowserCustody } from '../../core/browser/unsettledAction'
import { reportFault } from '../../core/trace/fault'
import { APP_TURN_ID } from '../../core/perf/appTelemetry'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createPlayer, type Player, type SongMemory } from './player'

// The Player's wiring (#343): one per pane, driving it through the same
// custody-held controller every pane user goes through. A queued search
// fetches the results with the pane's own session — its cookies carry
// YouTube's consent — so the song playing is never navigated away from.

/** How often the Player listens for the song's end. */
const CHECK_MS = 1_000

/** The pane's Player, its end-of-song poll running; a withheld browser is waited out on custody's settling (#433), each song's start is a `media-start` span (#488) and each consent wall cleared over its page a `media-consent` one (#492). The returned stop ends the poll. */
export function attachPlayer(
  browser: Pick<BrowserController, 'navigate' | 'land' | 'evaluate' | 'clearConsent' | 'state'>,
  session: Session,
  memory: { songs: SongMemory; learn(term: string): void; propose(term: string): void },
  custody: Pick<BrowserCustody<BrowserController>, 'settled'>,
  tracer: Pick<PerfTracer, 'span'>,
): { player: Player; stop: () => void } {
  const player = createPlayer({
    browser,
    custody,
    songs: memory.songs,
    learn: memory.learn,
    propose: memory.propose,
    onStart: ({ ms, ...start }) => {
      try {
        tracer.span(APP_TURN_ID, 'media-start', ms, { ...start })
      } catch (error) {
        reportFault('music.attachPlayer.mediaStart', error)
      }
    },
    onConsent: ({ ms, ...consent }) => {
      try {
        tracer.span(APP_TURN_ID, 'media-consent', ms, { ...consent })
      } catch (error) {
        reportFault('music.attachPlayer.mediaConsent', error)
      }
    },
    fetchResults: async (url) => {
      const response = await session.fetch(url)
      if (!response.ok) throw new Error(`results fetch: HTTP ${response.status}`)
      return response.text()
    },
  })
  const poll = setInterval(() => {
    player.check().catch((error: unknown) => reportFault('music.attachPlayer.check', error))
  }, CHECK_MS)
  return { player, stop: () => clearInterval(poll) }
}
