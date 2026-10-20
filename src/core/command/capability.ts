import type { MusicAction } from '../music/musicWords'
import { firstNumber } from '../timer/duration'

// A Capability (ADR 0079, CONTEXT.md): an action the appliance itself can
// take, offered to Jev as a verb beside the browser's, in the same verb
// Choice. The Player's ops are the first: while it has a current song, on
// any page and under the Idle Screen, every op but a search is offered;
// a song to play is offered whenever a Player is wired, so `play <words>`
// reaches Jev with every option. A Capability reading is a `play` Command
// carrying the Player's action, which fires through the path the grammar's
// exact lines take and ends the Task there.

/** A Capability, by its verb option. `play`, `play_next` and `queue` search for the Slot's words (the judgement call: one verb per place, so a reading needs no `where`). */
export type Capability = 'play' | 'play_next' | 'queue' | 'loop' | 'loop_off' | 'restart' | 'pause' | 'unpause' | 'skip' | 'previous' | 'louder' | 'quieter' | 'mute' | 'unmute' | 'volume' | 'show'

/** What a Capability fires; `volume` is set by its Slot's number at reading time. */
const PLAYER_ACTIONS: Readonly<Record<Exclude<Capability, 'volume'>, MusicAction>> = {
  play: { kind: 'search', place: 'now' },
  play_next: { kind: 'search', place: 'front' },
  queue: { kind: 'search', place: 'end' },
  loop: { kind: 'loop', on: true },
  loop_off: { kind: 'loop', on: false },
  restart: { kind: 'restart' },
  pause: { kind: 'pause' },
  unpause: { kind: 'unpause' },
  skip: { kind: 'skip' },
  previous: { kind: 'previous' },
  louder: { kind: 'louder' },
  quieter: { kind: 'quieter' },
  mute: { kind: 'mute', on: true },
  unmute: { kind: 'mute', on: false },
  show: { kind: 'show' },
}

/** Each Capability's one line in the verb Choice. */
export const CAPABILITY_DESCRIPTIONS: Readonly<Record<Capability, string>> = {
  play: "music: find a song or video on YouTube by the words and play it now — never the page's play button, which is a click",
  play_next: 'music: find a song by the words and play it after the one playing',
  queue: 'music: find a song by the words and add it to the end of the queue',
  loop: 'music: put the song playing on loop, so it repeats',
  loop_off: 'music: stop looping the song playing',
  restart: 'music: play the song playing again from the beginning',
  pause: 'music: pause the song playing',
  unpause: 'music: carry on playing the paused song',
  skip: 'music: skip to the next song',
  previous: 'music: go back to the song before',
  louder: 'music: turn the volume up',
  quieter: 'music: turn the volume down',
  mute: 'music: mute the song playing',
  unmute: 'music: unmute it',
  volume: 'music: set the volume to a number from 0 to 100 (the number is the words it carries)',
  show: 'music: show the video playing on the screen',
}

/** What the verb Choice's instructions add while Capabilities are offered: the page's button is meant when the words say so. */
export const CAPABILITY_INSTRUCTIONS =
  'The music verbs act on the song the appliance is playing, whatever page is open. When the words say click, press or tap — "click play", "press pause" — they name the page\'s own button: choose click, never a music verb.'

const SONG_CAPABILITIES: readonly Capability[] = ['loop', 'loop_off', 'restart', 'pause', 'unpause', 'skip', 'previous', 'louder', 'quieter', 'mute', 'unmute', 'volume', 'show']

/** The Player's Capabilities: a song to play, and while one is current (`songCurrent`) every op on it. */
export function playerCapabilities(songCurrent: boolean): readonly Capability[] {
  return ['play', 'play_next', 'queue', ...(songCurrent ? SONG_CAPABILITIES : [])]
}

/** Whether a verb Choice's label names a Capability. */
export function isCapability(verb: string): verb is Capability {
  return Object.hasOwn(CAPABILITY_DESCRIPTIONS, verb)
}

/** Whether a Capability searches for its Slot's words. */
export function capabilitySearches(capability: Capability): boolean {
  return capability !== 'volume' && PLAYER_ACTIONS[capability].kind === 'search'
}

/** The Player's action a Capability fires; null for a `volume` whose words carry no number from 0 to 100. */
export function capabilityAction(capability: Capability, slot: string | null): MusicAction | null {
  if (capability !== 'volume') return PLAYER_ACTIONS[capability]
  const to = slot === null ? null : firstNumber(slot)
  return to !== null && to >= 0 && to <= 100 ? { kind: 'volume', to } : null
}
