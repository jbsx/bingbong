// The overlap gate's roads (#502, #509): with audio-only music on, a song
// plays in a window never shown (src/main/music/audioSurface.ts), not in the
// pane, so what a person hears is that window's <audio> and what they see of
// the song is the dashboard's Now Playing; off, it plays in the pane. Every
// run writes its road into its fresh profile, off as plainly as on, since a
// profile that names none takes the road (78aed4f0). Every read takes the
// surface's media, each named by the song the surface plays, and the song's
// title the dashboard shows beside the pane's text in view, whichever road.

import type { MediaState, PaneSample } from './timeline.ts'

/** The setting's file in a profile, as src/main/index.ts names it; a partial file is sanitized onto the defaults. */
export const SETTINGS_FILE = 'settings.json'

/** Where a song plays: in the pane, or on the audio road outside it. */
export type Road = 'pane' | 'audio'

/** The settings file a run's fresh profile starts with: the road, said outright. */
export const roadSettings = (road: Road): string => `${JSON.stringify({ audioOnlyMusic: road === 'audio' })}\n`

/** The roads `--road` names: the audio road, as shipped, unless it says the pane or both. */
export function readRoads(raw: string | undefined): Road[] | string {
  if (raw === undefined || raw === 'audio') return ['audio']
  if (raw === 'pane') return ['pane']
  if (raw === 'both') return ['pane', 'audio']
  return '--road is pane, audio or both'
}

/** The audio surface's page: a data: URL holding the `#movie_player` the Player's scripts read. */
export const isAudioSurfaceUrl = (url: string): boolean => url.startsWith('data:text/html') && url.includes('movie_player')

/** What the surface plays: its document's title (the song's, set at each load) and its elements. */
export interface RoadRead {
  readonly title: string
  readonly media: readonly MediaState[]
}

/**
 * The pane read with the road's: the surface's media after the pane's, each
 * carrying the song's title, and the Now Playing title the dashboard shows
 * after the text in view. No road read leaves the pane's read as it was.
 */
export function withRoad<P extends Omit<PaneSample, 't'>>(pane: P, road: RoadRead | undefined, nowPlaying: string | undefined): P {
  const shown = nowPlaying?.trim() ?? ''
  const media = road === undefined ? pane.media : [...pane.media, ...road.media.map((item) => ({ ...item, title: road.title }))]
  return { ...pane, media, text: shown === '' ? pane.text : `${pane.text} ${shown}`.trim() }
}
