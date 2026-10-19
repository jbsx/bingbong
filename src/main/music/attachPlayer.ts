import type { Session } from 'electron'
import type { BrowserController } from '../../core/ports/browser'
import { reportFault } from '../../core/trace/fault'
import { createPlayer, type Player, type SongMemory } from './player'

// The Player's wiring (#343): one per pane, driving it through the same
// custody-held controller every pane user goes through. A queued search
// fetches the results with the pane's own session — its cookies carry
// YouTube's consent — so the song playing is never navigated away from.

/** How often the Player listens for the song's end. */
const CHECK_MS = 1_000

/** The pane's Player, its end-of-song poll running; the returned stop ends the poll. */
export function attachPlayer(
  browser: Pick<BrowserController, 'navigate' | 'evaluate'>,
  session: Session,
  memory: { songs: SongMemory; learn(term: string): void },
): { player: Player; stop: () => void } {
  const player = createPlayer({
    browser,
    songs: memory.songs,
    learn: memory.learn,
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
