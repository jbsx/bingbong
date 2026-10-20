// The Idle Screen's Columns (CONTEXT.md, ADR 0078): three fixed columns on
// the 1920×1080 canvas — the weather down the left; the clock, its Clock
// Lines and the AI Usage down the middle; the Calendar, the Weight card and
// the News card down the right. Every card has one home and is drawn there;
// nothing is placed by order or by relevance. The Last Page and Now Playing
// are Clock Lines, pinned like the cards.

/** The cards an owner can pin to the Idle Screen: a set, in the order their homes read. */
export const IDLE_CARD_IDS = ['weather', 'calendar', 'lastPage', 'weight', 'usage', 'news', 'music'] as const

export type IdleCardId = (typeof IDLE_CARD_IDS)[number]

export type IdleColumn = 'left' | 'middle' | 'right'

/** Each Column's cards, top to bottom. */
const HOMES: Record<IdleColumn, readonly IdleCardId[]> = {
  left: ['weather'],
  middle: ['usage'],
  right: ['calendar', 'weight', 'news'],
}

/** The pinned cards a Column shows, in its own order top to bottom. */
export function columnCards(column: IdleColumn, pinned: readonly IdleCardId[]): IdleCardId[] {
  return HOMES[column].filter((id) => pinned.includes(id))
}

/**
 * Anything (disk, IPC) as the Pinned Cards: a set, so a list saved in any
 * order reads the same — the known cards, each once, in their homes' order;
 * not a list at all means every card.
 */
export function sanitizeIdleCards(value: unknown): IdleCardId[] {
  if (!Array.isArray(value)) return [...IDLE_CARD_IDS]
  return IDLE_CARD_IDS.filter((id) => value.includes(id))
}

/** The one-line rows under the clock (CONTEXT.md, Clock Lines). */
export type ClockLine = 'voice' | 'nowPlaying' | 'upNext' | 'lastPage'

/**
 * The Clock Lines shown, in their order — the Voice Prompt, Now Playing, Up
 * Next, the Last Page — each only while it has something; Now Playing and
 * the Last Page only while pinned. The Voice Prompt always says the ear.
 */
export function clockLines(pinned: readonly IdleCardId[], has: { nowPlaying: boolean; upNext: boolean; lastPage: boolean }): ClockLine[] {
  const lines: ClockLine[] = ['voice']
  if (has.nowPlaying && pinned.includes('music')) lines.push('nowPlaying')
  if (has.upNext) lines.push('upNext')
  if (has.lastPage && pinned.includes('lastPage')) lines.push('lastPage')
  return lines
}

/** What a card asks of its Column: the height of its full form and of its smaller one, and whether it can use more. */
export interface BandAsk<Id extends string = string> {
  id: Id
  full: number
  small: number
  /** Whether it draws larger with more room (a chart, more rows); one that does not keeps its height. */
  grows: boolean
}

export interface Band<Id extends string = string> {
  id: Id
  height: number
  form: 'full' | 'small'
}

/**
 * A Column's cards, top to bottom, given its height: each in its full form
 * while they all fit, else the lowest stepping down to its smaller form
 * first; then whatever room is left — a hidden card's — shared evenly
 * among the cards that grow.
 */
export function columnBands<Id extends string>(asks: readonly BandAsk<Id>[], room: number): Band<Id>[] {
  let bands: Band<Id>[] = []
  for (let stepped = 0; stepped <= asks.length; stepped += 1) {
    bands = asks.map((ask, index): Band<Id> => (index >= asks.length - stepped ? { id: ask.id, height: ask.small, form: 'small' } : { id: ask.id, height: ask.full, form: 'full' }))
    if (bands.reduce((sum, band) => sum + band.height, 0) <= room) break
  }
  const growers = asks.filter((ask) => ask.grows).map((ask) => ask.id)
  const spare = room - bands.reduce((sum, band) => sum + band.height, 0)
  if (spare <= 0 || growers.length === 0) return bands
  const share = Math.floor(spare / growers.length)
  let rest = spare - share * growers.length
  return bands.map((band) => {
    if (!growers.includes(band.id)) return band
    const extra = share + rest
    rest = 0
    return { ...band, height: band.height + extra }
  })
}
