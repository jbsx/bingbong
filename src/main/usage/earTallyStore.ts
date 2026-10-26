import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createEarTallyBook, sanitizeEarTally, type EarDay, type EarSpan, type EarTally } from '../../core/usage/earTally'
import { reportFault } from '../../core/trace/fault'

// The ear's usage tally's persistence (#463): ear-tally.json in userData,
// a month of days. The rules live in core (earTally.ts); this store owns
// the file. A corrupt file fails closed to an empty tally.

export interface EarTallyStore {
  heard(span: EarSpan): void
  decided(record: { type: string; turnId: string; verb?: string }): void
  day(at: number): Readonly<Record<string, EarDay>>
}

export function createEarTallyStore(path: string): EarTallyStore {
  let initial: EarTally = {}
  if (existsSync(path)) {
    try {
      initial = sanitizeEarTally(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      reportFault('usage.earTallyStore.load', error)
    }
  }
  const book = createEarTallyBook(initial)

  function persist(changed: boolean): void {
    if (!changed) return
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(book.tally(), null, 2)}\n`, 'utf8')
    } catch (error) {
      reportFault('usage.earTallyStore.persist', error)
    }
  }

  return {
    heard: (span) => persist(book.heard(span)),
    decided: (record) => persist(book.decided(record)),
    day: (at) => book.day(at),
  }
}
