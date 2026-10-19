// The Idle Screen's Card Slots (CONTEXT.md): the middle of the 1920×1080 canvas
// is a fixed grid of cells, and every card is handed a box of whole cells
// rather than sizing the row by its own content. A card offers the sizes it
// can draw itself at, largest first; the screen gives each card in the
// owner's pinned order the largest of them that still fits — the cards with
// something to show first, so an empty one yields its room — and a card that
// fits nowhere is left off.

/** The grid's columns and rows of cells. */
export const SLOT_COLUMNS = 4
export const SLOT_ROWS = 2

/** A box of whole cells, `w` columns by `h` rows. */
export interface SlotSize {
  w: number
  h: number
}

/** The cards an owner can pin to the Idle Screen, in their default order. */
export const IDLE_CARD_IDS = ['weather', 'usage', 'calendar', 'music', 'news'] as const

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
  /** How many columns the placed cards reach, so the grid can centre what it holds. */
  columns: number
}

type Grid = boolean[][]

function emptyGrid(): Grid {
  return Array.from({ length: SLOT_ROWS }, () => Array.from({ length: SLOT_COLUMNS }, () => false))
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

/** Place each card at the first size of its list that fits, in the given order; a card that fits nowhere is left out. */
function pack<Id extends string>(requests: readonly SlotRequest<Id>[]): SlotPlacement<Id>[] {
  const grid = emptyGrid()
  const placed: SlotPlacement<Id>[] = []
  for (const request of requests) {
    for (const size of request.sizes) {
      const spot = firstFit(grid, size)
      if (spot === null) continue
      take(grid, size, spot.column, spot.row)
      placed.push({ id: request.id, ...spot, size })
      break
    }
  }
  return placed
}

/**
 * Lay the pinned cards out on the grid. Sizes are settled with the cards
 * that have something to show going first, so an empty card takes what is
 * left; the boxes are then laid down again in pinned order, so the owner's
 * order reads left to right — unless that order cannot hold the same boxes,
 * when the first packing stands.
 */
export function layoutSlots<Id extends string>(requests: readonly SlotRequest<Id>[]): SlotLayout<Id> {
  const pinned = new Map(requests.map((request, index) => [request.id, index]))
  const byPin = (a: { id: Id }, b: { id: Id }): number => (pinned.get(a.id) ?? 0) - (pinned.get(b.id) ?? 0)
  const priority = [...requests.filter((request) => request.hasContent), ...requests.filter((request) => !request.hasContent)]
  const sized = pack(priority)
  const settled = sized.map((placement) => ({ id: placement.id, sizes: [placement.size], hasContent: true }))
  const reordered = pack([...settled].sort(byPin))
  const placements = (reordered.length === sized.length ? reordered : sized).sort(byPin)
  const columns = Math.max(0, ...placements.map((placement) => placement.column + placement.size.w))
  return { placements, columns }
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
