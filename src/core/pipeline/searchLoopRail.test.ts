import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import {
  createSearchLoopRail,
  SEARCH_LOOP_NUDGE_AFTER,
  SEARCH_LOOP_REFUSE_AFTER,
  similarQueries,
} from './searchLoopRail'

// Issue #74, run rails: the rail that breaks blind search loops — pure
// token similarity over the streak, advisory nudge first, pre-execution
// refusal second. See the module header for the full policy.

function search(query: string): ToolCall {
  return { id: 's', name: 'web_search', args: { query } }
}

function other(name: string): ToolCall {
  return { id: 'o', name, args: {} }
}

const ok: ToolResultOutcome = { ok: true, result: 'done' }
const fail: ToolResultOutcome = { ok: false, error: 'boom' }

describe('similarQueries', () => {
  it('matches identical and reworded variants of the same intent', () => {
    expect(similarQueries('best mechanical keyboards 2026', 'best mechanical keyboards 2026')).toBe(true)
    expect(similarQueries('best mechanical keyboards 2026', 'best mechanical keyboard 2026 reddit')).toBe(true)
    expect(similarQueries('Best Mechanical Keyboards 2026?', 'best mechanical keyboards 2026!')).toBe(true)
    expect(similarQueries('weather london', 'london weather')).toBe(true)
  })

  it('separates genuinely different intents', () => {
    expect(similarQueries('best mechanical keyboards 2026', 'weather in london')).toBe(false)
    expect(similarQueries('weather london', 'weather tokyo')).toBe(false)
    expect(similarQueries('', 'anything at all')).toBe(false)
  })
})

describe('createSearchLoopRail', () => {
  it('keeps the refusal tier strictly beyond the nudge tier', () => {
    expect(SEARCH_LOOP_NUDGE_AFTER).toBeGreaterThanOrEqual(2)
    expect(SEARCH_LOOP_REFUSE_AFTER).toBeGreaterThan(SEARCH_LOOP_NUDGE_AFTER)
  })

  it('stays quiet while consecutive searches explore different intents', () => {
    const rail = createSearchLoopRail()
    expect(rail.gate(search('mechanical keyboards'))).toEqual({ ok: true })
    expect(rail.observe(search('mechanical keyboards'), ok)).toBeNull()
    expect(rail.gate(search('weather london'))).toEqual({ ok: true })
    expect(rail.observe(search('weather london'), ok)).toBeNull()
  })

  it('nudges on the nth consecutive similar search — advisory, never a refusal', () => {
    const rail = createSearchLoopRail()
    for (let i = 1; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      expect(rail.gate(search(`best mechanical keyboards 2026 v${i}`))).toEqual({ ok: true })
      expect(rail.observe(search(`best mechanical keyboards 2026 v${i}`), ok)).toBeNull()
    }
    const last = `best mechanical keyboards 2026 v${SEARCH_LOOP_NUDGE_AFTER}`
    expect(rail.gate(search(last))).toEqual({ ok: true })
    const nudge = rail.observe(search(last), ok)
    expect(nudge).toMatch(/same (intent|thing)|reword/i)
    expect(nudge).toMatch(/web_search/)
    expect(nudge).toMatch(/ask_user/)
    expect(nudge).toMatch(/navigate|read|open/i)
  })

  it('catches slow drift: each query similar to the previous, not to the first', () => {
    const rail = createSearchLoopRail()
    rail.observe(search('best mechanical keyboards 2026'), ok)
    rail.observe(search('best mechanical keyboards 2027'), ok)
    // Similar to the previous query, but only 0.5 against the first —
    // anchor-based comparison would reset here and miss the drift loop.
    expect(rail.observe(search('mechanical keyboards 2027'), ok)).toMatch(/ask_user/)
  })

  it('resets the streak when a successful other tool intervenes', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      rail.observe(search('mechanical keyboards gaming'), ok)
    }
    rail.observe(other('navigate'), ok)
    expect(rail.gate(search('mechanical keyboards gaming'))).toEqual({ ok: true })
    expect(rail.observe(search('mechanical keyboards gaming'), ok)).toBeNull()
  })

  it('keeps the streak when the intervening tool fails — the model is still blind (run 46)', () => {
    const rail = createSearchLoopRail()
    rail.observe(search('mechanical keyboards'), ok)
    rail.observe(search('mechanical keyboards gaming'), ok)
    expect(rail.observe(other('navigate'), fail)).toBeNull()
    expect(rail.observe(search('mechanical keyboards gaming 2026'), ok)).toMatch(/ask_user/)
  })

  it('resets the streak when the model moves to a new search intent', () => {
    const rail = createSearchLoopRail()
    rail.observe(search('mechanical keyboards'), ok)
    rail.observe(search('mechanical keyboards gaming'), ok)
    rail.observe(search('mechanical keyboards 2026'), ok)
    expect(rail.observe(search('weather in london'), ok)).toBeNull()
    expect(rail.observe(search('weather in tokyo'), ok)).toBeNull()
  })

  it('refuses pre-execution once the consecutive-similar cap is reached, with a reason the model can act on', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      expect(rail.gate(search(`mechanical keyboards run ${i}`))).toEqual({ ok: true })
      rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    const refusal = rail.gate(search('mechanical keyboards run 99'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) {
      expect(refusal.reason).toMatch(/web_search/)
      expect(refusal.reason).toMatch(String(SEARCH_LOOP_REFUSE_AFTER))
      expect(refusal.reason).toMatch(/ask_user|change strategy/i)
    }
  })

  it('lets a genuinely different search through even at the cap — the rail loops on intent, not the tool', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      rail.gate(search(`mechanical keyboards run ${i}`))
      rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    expect(rail.gate(search('train times tokyo osaka'))).toEqual({ ok: true })
  })

  it('clears the cap after a successful other tool call — following the nudge recovers search', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      rail.gate(search(`mechanical keyboards run ${i}`))
      rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    expect(rail.gate(search('mechanical keyboards run 99')).ok).toBe(false)
    rail.observe(other('read_page'), ok)
    expect(rail.gate(search('mechanical keyboards after reading'))).toEqual({ ok: true })
  })

  it('treats a web_search without a usable query as a reset, never a throw', () => {
    const rail = createSearchLoopRail()
    rail.observe(search('mechanical keyboards'), ok)
    rail.observe(search('mechanical keyboards gaming'), ok)
    expect(rail.observe({ id: 's', name: 'web_search', args: {} }, fail)).toBeNull()
    expect(rail.gate({ id: 's', name: 'web_search', args: { query: 7 } })).toEqual({ ok: true })
  })

  it('only rails the web_search tool — other tools pass the gate untouched', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      rail.gate(search(`mechanical keyboards run ${i}`))
      rail.observe(search(`mechanical keyboards run ${i}`), ok)
    }
    expect(rail.gate(other('navigate'))).toEqual({ ok: true })
    expect(rail.gate(other('look'))).toEqual({ ok: true })
  })
})
