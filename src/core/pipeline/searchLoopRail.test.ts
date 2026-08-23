import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import {
  createSearchLoopRail,
  SEARCH_LOOP_NUDGE_AFTER,
  SEARCH_LOOP_REFUSE_AFTER,
  similarQueries,
} from './searchLoopRail'

// Issue #74, run rails: a blind search loop — consecutive web_search calls
// that reword the same query with no intervening read/click/navigate — is
// the 80-round flail's signature. The rail detects it with pure token
// similarity (Blocker-nudge pattern: pattern → decision, no side effects)
// and answers in two tiers: an advisory nudge appended to results, then a
// pre-execution refusal alongside the vision budget. Never a run-killer:
// any other tool call resets the streak.

function search(query: string): ToolCall {
  return { id: 's', name: 'web_search', args: { query } }
}

function other(name: string): ToolCall {
  return { id: 'o', name, args: {} }
}

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
    expect(rail.observe(search('mechanical keyboards'))).toBeNull()
    expect(rail.gate(search('weather london'))).toEqual({ ok: true })
    expect(rail.observe(search('weather london'))).toBeNull()
  })

  it('nudges on the nth consecutive similar search — advisory, never a refusal', () => {
    const rail = createSearchLoopRail()
    for (let i = 1; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      expect(rail.gate(search(`best mechanical keyboards 2026 v${i}`))).toEqual({ ok: true })
      expect(rail.observe(search(`best mechanical keyboards 2026 v${i}`))).toBeNull()
    }
    const last = `best mechanical keyboards 2026 v${SEARCH_LOOP_NUDGE_AFTER}`
    expect(rail.gate(search(last))).toEqual({ ok: true })
    const nudge = rail.observe(search(last))
    expect(nudge).toMatch(/same (intent|thing)|reword/i)
    expect(nudge).toMatch(/web_search/)
    expect(nudge).toMatch(/ask_user/)
    expect(nudge).toMatch(/navigate|read|open/i)
  })

  it('resets the streak when any other tool intervenes', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_NUDGE_AFTER; i += 1) {
      rail.gate(search(`mechanical keyboards ${i === 0 ? '' : 'gaming'}`.trim()))
      rail.observe(search(`mechanical keyboards ${i === 0 ? '' : 'gaming'}`.trim()))
    }
    rail.observe(other('navigate'))
    expect(rail.gate(search('mechanical keyboards gaming'))).toEqual({ ok: true })
    expect(rail.observe(search('mechanical keyboards gaming'))).toBeNull()
  })

  it('resets the streak when the model moves to a new search intent', () => {
    const rail = createSearchLoopRail()
    rail.observe(search('mechanical keyboards'))
    rail.observe(search('mechanical keyboards gaming'))
    rail.observe(search('mechanical keyboards 2026'))
    expect(rail.observe(search('weather in london'))).toBeNull()
    expect(rail.observe(search('weather in tokyo'))).toBeNull()
  })

  it('refuses pre-execution once the consecutive-similar cap is reached, with a reason the model can act on', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      expect(rail.gate(search(`mechanical keyboards run ${i}`))).toEqual({ ok: true })
      rail.observe(search(`mechanical keyboards run ${i}`))
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
      rail.observe(search(`mechanical keyboards run ${i}`))
    }
    expect(rail.gate(search('train times tokyo osaka'))).toEqual({ ok: true })
  })

  it('clears the cap after an intervening tool call — following the nudge recovers search', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      rail.gate(search(`mechanical keyboards run ${i}`))
      rail.observe(search(`mechanical keyboards run ${i}`))
    }
    expect(rail.gate(search('mechanical keyboards run 99')).ok).toBe(false)
    rail.observe(other('read_page'))
    expect(rail.gate(search('mechanical keyboards after reading'))).toEqual({ ok: true })
  })

  it('treats a web_search without a usable query as a reset, never a throw', () => {
    const rail = createSearchLoopRail()
    rail.observe(search('mechanical keyboards'))
    rail.observe(search('mechanical keyboards gaming'))
    expect(rail.observe({ id: 's', name: 'web_search', args: {} })).toBeNull()
    expect(rail.gate({ id: 's', name: 'web_search', args: { query: 7 } })).toEqual({ ok: true })
  })

  it('only rails the web_search tool — other tools pass the gate untouched', () => {
    const rail = createSearchLoopRail()
    for (let i = 0; i < SEARCH_LOOP_REFUSE_AFTER; i += 1) {
      rail.gate(search(`mechanical keyboards run ${i}`))
      rail.observe(search(`mechanical keyboards run ${i}`))
    }
    expect(rail.gate(other('navigate'))).toEqual({ ok: true })
    expect(rail.gate(other('look'))).toEqual({ ok: true })
  })
})
