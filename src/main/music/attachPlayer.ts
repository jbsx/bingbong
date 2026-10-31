import type { Session } from 'electron'
import type { BrowserController } from '../../core/ports/browser'
import type { BrowserCustody } from '../../core/browser/unsettledAction'
import { reportFault } from '../../core/trace/fault'
import { APP_TURN_ID } from '../../core/perf/appTelemetry'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createPlayer, type AudioRoad, type Player, type SongMemory } from './player'

// The Player's wiring (#343): one per pane, driving it through the same
// custody-held controller every pane user goes through. A queued search
// fetches the results with the pane's own session — its cookies carry
// YouTube's consent — so the song playing is never navigated away from.

/** How often the Player listens for the song's end. */
const CHECK_MS = 1_000

/** The pane's Player, its end-of-song poll running; the audio road (#502) while audio-only music is on; a withheld browser is waited out on custody's settling (#433), each song's start is a `media-start` span (#488), an ad that held it a `media-start-ad` one (#497), each consent wall cleared over its page a `media-consent` one (#492), each seek that left the song paused a `media-seek` one (#505), and each song given up on that played after all a `media-late` one (#550). The returned stop ends the poll. */
export function attachPlayer(
  browser: Pick<BrowserController, 'navigate' | 'land' | 'evaluate' | 'clearConsent' | 'onConsentDrawn' | 'state'>,
  session: Session,
  memory: { songs: SongMemory; learn(term: string): void; propose(term: string): void },
  custody: Pick<BrowserCustody<BrowserController>, 'settled'>,
  tracer: Pick<PerfTracer, 'span'>,
  audio?: AudioRoad,
): { player: Player; stop: () => void } {
  const player = createPlayer({
    browser,
    ...(audio !== undefined ? { audio } : {}),
    custody,
    songs: memory.songs,
    learn: memory.learn,
    propose: memory.propose,
    onStart: ({ ms, ...start }) => {
      try {
        tracer.span(APP_TURN_ID, 'media-start', ms, { ...start })
        // How long an ad held the start (#497): its own row in `pnpm perf:report`, an ad-delayed start told from a clean one.
        if (start.ad !== null) tracer.span(APP_TURN_ID, 'media-start-ad', start.ad, { video: start.video, started: start.started })
      } catch (error) {
        reportFault('music.attachPlayer.mediaStart', error)
      }
    },
    onConsent: ({ ms, drawToClickMs, goneMs, gone, ...consent }) => {
      try {
        if (ms !== null) tracer.span(APP_TURN_ID, 'media-consent', ms, { ...consent, drawToClickMs, goneMs, gone })
        // Where a clear's time went (#496): from the draw the page signalled to the click, and from the click to the sheet gone.
        tracer.span(APP_TURN_ID, 'consent-draw-click', drawToClickMs, { video: consent.video, afterStart: consent.afterStart })
        tracer.span(APP_TURN_ID, 'consent-gone', goneMs, { video: consent.video, gone })
      } catch (error) {
        reportFault('music.attachPlayer.mediaConsent', error)
      }
    },
    onConsentTold: ({ ageMs, ...told }) => {
      try {
        tracer.span(APP_TURN_ID, 'consent-told', ageMs, { ...told })
      } catch (error) {
        reportFault('music.attachPlayer.consentTold', error)
      }
    },
    onLate: ({ ms, ...late }) => {
      try {
        tracer.span(APP_TURN_ID, 'media-late', ms, { ...late })
      } catch (error) {
        reportFault('music.attachPlayer.mediaLate', error)
      }
    },
    onSeekResume: ({ seekAgeMs, ...seek }) => {
      try {
        tracer.span(APP_TURN_ID, 'media-seek', seekAgeMs, { ...seek })
      } catch (error) {
        reportFault('music.attachPlayer.mediaSeek', error)
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
