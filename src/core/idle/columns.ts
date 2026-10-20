// The Idle Screen's Columns (CONTEXT.md, ADR 0078): three fixed columns on
// the 1920×1080 canvas — the weather down the left; the clock, its Clock
// Lines, then Now Playing over the AI Usage down the middle; the Calendar,
// the Weight card and the News card down the right. Every card has one home
// and is drawn there; nothing is placed by order or by relevance. The Last
// Page is a Clock Line, pinned like the cards.

/** The cards an owner can pin to the Idle Screen: a set, in the order their homes read. */
export const IDLE_CARD_IDS = ['weather', 'calendar', 'lastPage', 'weight', 'usage', 'news', 'music'] as const

export type IdleCardId = (typeof IDLE_CARD_IDS)[number]

export type IdleColumn = 'left' | 'middle' | 'right'

/** Each Column's cards, top to bottom. */
const HOMES: Record<IdleColumn, readonly IdleCardId[]> = {
  left: ['weather'],
  middle: ['music', 'usage'],
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
  const saved = savedIdleCards(value)
  return saved === null ? [...IDLE_CARD_IDS] : IDLE_CARD_IDS.filter((id) => saved.includes(id))
}

/** A saved list as it was written — the known cards, each once, in the saved order — or null when it is not a list: how settings recognises an earlier default. */
export function savedIdleCards(value: unknown): IdleCardId[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((id, index): id is IdleCardId => (IDLE_CARD_IDS as readonly unknown[]).includes(id) && value.indexOf(id) === index)
}

/** The one-line rows under the clock (CONTEXT.md, Clock Lines). */
export type ClockLine = 'voice' | 'upNext' | 'lastPage'

/**
 * The Clock Lines shown, in their order — the Voice Prompt, Up Next, the
 * Last Page — each only while it has something; the Last Page only while
 * pinned. The Voice Prompt always says the ear.
 */
export function clockLines(pinned: readonly IdleCardId[], has: { upNext: boolean; lastPage: boolean }): ClockLine[] {
  const lines: ClockLine[] = ['voice']
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

/** A Column's height on the canvas (styles.css, .idle-col): the bands its cards share. */
export const COLUMN_HEIGHT = 1000

// The middle Column's heights, as styles.css draws them on the 1920×1080 canvas (measured, #365).
/** The clock row (the clock alone, or stepped down beside a Timer Clock and lifted 6 px), the Clock Lines' top margin under it, and their bottom margin. */
const CLOCK = { plain: 211, timer: 170 - 6 }
const LINES_TOP = { plain: 18, timer: 30 }
const LINES_BOTTOM = 22
const CLOCK_ROW = { plain: CLOCK.plain + LINES_TOP.plain + LINES_BOTTOM, timer: CLOCK.timer + LINES_TOP.timer + LINES_BOTTOM }
/** A Clock Line and the gap between two. */
const LINE_PX = 36
const LINE_GAP = 12
/** The panel's hairline edge, top and bottom. */
const PANEL_EDGES = 2
/** Now Playing's card: the thumbnail over the bar and controls, or one row of them. */
const MUSIC_BAND = { full: 280, small: 120 }
/** The AI Usage's rings' padding in its full form and in its smaller one, under which its foot says when it last refreshed. */
const RINGS_PAD = { full: 48, small: 28 }
const USAGE_FOOT = 35
/** The AI Usage's chart in full, and the least height it is still drawn at. */
const CHART = { full: 240, least: 150 }
/** A card with only a line to say (NoteCard). */
const NOTE_PX = 140

/** The middle Column's height for its cards: what the clock and the Clock Lines shown leave of it. */
export function middleRoom(clock: { timer: boolean; lines: number }): number {
  const lines = clock.lines * LINE_PX + Math.max(0, clock.lines - 1) * LINE_GAP
  return COLUMN_HEIGHT - (clock.timer ? CLOCK_ROW.timer : CLOCK_ROW.plain) - lines - PANEL_EDGES
}

/** The height of the AI Usage's row of rings and the words under them: at their own size, and drawn smaller (at most three providers' ring). */
export interface RingsHeight {
  large: number
  compact: number
}

/** The AI Usage as the middle Column sizes it: its rings, a note when the dashboard is unreachable, or null when it shows nothing. */
export type MiddleUsage = { rings: RingsHeight } | 'note' | null

/**
 * What the middle Column's cards ask of it (#365): Now Playing while the
 * Player holds a song, its card or one row of it, never growing; the AI
 * Usage its rings over the chart, or the rings alone drawn smaller, taking
 * whatever room is spare — so the chart goes before the card steps down.
 */
export function middleAsks(pinned: readonly IdleCardId[], has: { music: boolean; usage: MiddleUsage }): BandAsk<IdleCardId>[] {
  return columnCards('middle', pinned).flatMap((id): BandAsk<IdleCardId>[] => {
    if (id === 'music') return has.music ? [{ id, ...MUSIC_BAND, grows: false }] : []
    if (has.usage === null) return []
    if (has.usage === 'note') return [{ id, full: NOTE_PX, small: NOTE_PX, grows: false }]
    const { rings } = has.usage
    return [{ id, full: rings.large + RINGS_PAD.full + CHART.full, small: rings.compact + RINGS_PAD.small + USAGE_FOOT, grows: true }]
  })
}

/**
 * How the AI Usage is drawn in its band: its chart while the band holds the
 * rings over the least chart, and the rings at their own size while the
 * band holds them, else smaller.
 */
export function usageLayout(height: number, rings: RingsHeight): { form: 'full' | 'small'; compact: boolean } {
  if (height >= rings.large + RINGS_PAD.full + CHART.least) return { form: 'full', compact: false }
  if (height >= rings.compact + RINGS_PAD.full + CHART.least) return { form: 'full', compact: true }
  return { form: 'small', compact: height < rings.large + RINGS_PAD.small + USAGE_FOOT }
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
