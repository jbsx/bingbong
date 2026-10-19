// The Idle Screen's Card Slots (CONTEXT.md): the 1920×1080 canvas is a
// fixed grid of cells, the clock in the top-left one, and every card is
// handed a box of whole cells rather than sizing the row by its own
// content; it draws its pieces as tiles inside that box. A card offers the
// sizes it can draw itself at, largest first; the screen shows as many
// pinned cards as the grid can hold before it gives any of them a larger
// size, then gives each the largest that still fits — the cards with
// something to show first, so an empty one yields its room down to its
// smallest size — and a card that fits nowhere is left off.

/** The grid's columns and rows of cells. */
export const SLOT_COLUMNS = 3
export const SLOT_ROWS = 4

/** The clock's cell: fixed, never a card's. */
export const CLOCK_CELL = { column: 0, row: 0 } as const

/** A box of whole cells, `w` columns by `h` rows. */
export interface SlotSize {
  w: number
  h: number
}

/**
 * The cards an owner can pin to the Idle Screen, in their default order:
 * filled a column at a time, that order puts the weather down the left
 * under the clock, the Calendar and the Last Page over the News in the
 * middle, and the AI usage down the right. Now Playing is a chip in the
 * dock and asks for no Card Slot; pinning it decides whether it shows.
 */
export const IDLE_CARD_IDS = ['weather', 'calendar', 'lastPage', 'news', 'usage', 'music'] as const

export type IdleCardId = (typeof IDLE_CARD_IDS)[number]

/** A pinned card as the screen offers it to the grid: the sizes it can draw at and whether it has anything to show right now. */
export interface SlotRequest<Id extends string = string> {
  id: Id
  /** Largest first; an empty list asks for no slot. */
  sizes: readonly SlotSize[]
  hasContent: boolean
}

/** Where a card landed: its top-left cell (0-based) and the size it was given. */
export interface SlotPlacement<Id extends string = string> {
  id: Id
  column: number
  row: number
  size: SlotSize
}

export interface SlotLayout<Id extends string = string> {
  /** In pinned order. */
  placements: SlotPlacement<Id>[]
}

type Grid = boolean[][]

function emptyGrid(): Grid {
  const grid = Array.from({ length: SLOT_ROWS }, () => Array.from({ length: SLOT_COLUMNS }, () => false))
  grid[CLOCK_CELL.row][CLOCK_CELL.column] = true
  return grid
}

function fitsAt(grid: Grid, size: SlotSize, column: number, row: number): boolean {
  if (column + size.w > SLOT_COLUMNS || row + size.h > SLOT_ROWS) return false
  for (let r = row; r < row + size.h; r += 1) {
    for (let c = column; c < column + size.w; c += 1) if (grid[r][c]) return false
  }
  return true
}

/** The first free spot a box fits, column by column so a tall card takes the left edge before a short one stacks beside it. */
function firstFit(grid: Grid, size: SlotSize): { column: number; row: number } | null {
  for (let column = 0; column < SLOT_COLUMNS; column += 1) {
    for (let row = 0; row < SLOT_ROWS; row += 1) if (fitsAt(grid, size, column, row)) return { column, row }
  }
  return null
}

function take(grid: Grid, size: SlotSize, column: number, row: number): void {
  for (let r = row; r < row + size.h; r += 1) {
    for (let c = column; c < column + size.w; c += 1) grid[r][c] = true
  }
}

/** Place each card at the size chosen for it, in the given order; a card that fits nowhere is left out. */
function pack<Id extends string>(requests: readonly SlotRequest<Id>[], sizes: ReadonlyMap<Id, SlotSize>): SlotPlacement<Id>[] {
  const grid = emptyGrid()
  const placed: SlotPlacement<Id>[] = []
  for (const request of requests) {
    const size = sizes.get(request.id)
    if (size === undefined) continue
    const spot = firstFit(grid, size)
    if (spot === null) continue
    take(grid, size, spot.column, spot.row)
    placed.push({ id: request.id, ...spot, size })
  }
  return placed
}

/**
 * Lay the pinned cards out on the grid. Of every choice of one size per
 * card, the one that places the most cards with something to show, then
 * the most cards — so an empty card shrinks rather than vanishing while a
 * smaller box would keep it — and of those the first, trying each card's
 * sizes largest first with the cards that have something to show going
 * first, so the earlier of those keeps the larger box. Each choice is laid
 * down in pinned order, so the owner's order reads down the columns, or —
 * when that order cannot hold every box — with the cards that have
 * something to show first. A handful of cards of up to three sizes each: a
 * few hundred tries.
 */
export function layoutSlots<Id extends string>(requests: readonly SlotRequest<Id>[]): SlotLayout<Id> {
  const asking = requests.filter((request) => request.sizes.length > 0)
  const priority = [...asking.filter((request) => request.hasContent), ...asking.filter((request) => !request.hasContent)]
  const content = new Set(priority.filter((request) => request.hasContent).map((request) => request.id))
  const score = (placed: readonly SlotPlacement<Id>[]): [number, number] => [placed.filter((p) => content.has(p.id)).length, placed.length]
  const better = (a: [number, number], b: [number, number]): boolean => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
  let best: SlotPlacement<Id>[] = []
  let bestScore: [number, number] = [-1, -1]
  const choice = new Map<Id, SlotSize>()
  const tryFrom = (index: number): void => {
    if (index === priority.length) {
      const pinned = pack(asking, choice)
      const placed = pinned.length === asking.length ? pinned : [pinned, pack(priority, choice)].reduce((a, b) => (better(score(b), score(a)) ? b : a))
      if (better(score(placed), bestScore)) {
        best = placed
        bestScore = score(placed)
      }
      return
    }
    for (const option of priority[index].sizes) {
      choice.set(priority[index].id, option)
      tryFrom(index + 1)
    }
  }
  tryFrom(0)
  const pinnedAt = new Map(requests.map((request, index) => [request.id, index]))
  return { placements: [...best].sort((a, b) => (pinnedAt.get(a.id) ?? 0) - (pinnedAt.get(b.id) ?? 0)) }
}

/** Anything (disk, IPC) as a pinned list: known ids only, each once, in the order given; not a list at all means every card in the default order. */
export function sanitizeIdleCards(value: unknown): IdleCardId[] {
  if (!Array.isArray(value)) return [...IDLE_CARD_IDS]
  const known = new Set<string>(IDLE_CARD_IDS)
  const seen = new Set<string>()
  const cards: IdleCardId[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue
    seen.add(id)
    cards.push(id as IdleCardId)
  }
  return cards
}
