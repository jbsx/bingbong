import { describe, expect, it } from 'vitest'
import type { ToolResultOutcome } from '../ports/llm'
import { createNotices, NOTICE_PRECEDENCE } from './notices'

// Issue #154, step 1: the Notices module — precedence as data, one
// delivery guard, immediate vs owed persistence, supersession and replan.
// Plain values throughout: no LLM script, no clock, no tool names.

const ok: ToolResultOutcome = { ok: true, result: 'page read' }
const structured: ToolResultOutcome = { ok: true, result: { paused: false } }
const fail: ToolResultOutcome = { ok: false, error: 'boom' }
const useful = { usefulWork: true }
const bookkeeping = { usefulWork: false }

function text(outcome: ToolResultOutcome): string {
  if (!outcome.ok || typeof outcome.result !== 'string') throw new Error('expected a string result')
  return outcome.result
}

describe('Notices', () => {
  it('delivers in one fixed precedence, whatever order the sources owed in', () => {
    const notices = createNotices()
    notices.supply('finalization', () => 'FINALIZE')
    notices.owe('run_plan', 'PLAN')
    notices.supply('budget', () => 'BUDGET')
    notices.owe('no_progress', 'NO PROGRESS')
    notices.owe('search_loop', 'SEARCH LOOP')

    expect(text(notices.attach(ok, useful))).toBe(
      ['page read', 'SEARCH LOOP', 'NO PROGRESS', 'PLAN', 'BUDGET', 'FINALIZE'].join('\n\n'),
    )
    expect(NOTICE_PRECEDENCE).toEqual(['search_loop', 'no_progress', 'run_plan', 'budget', 'finalization'])
  })

  it('returns the outcome untouched when nothing is owed', () => {
    const notices = createNotices()
    expect(notices.attach(ok, useful)).toBe(ok)
    expect(notices.attach(fail, useful)).toBe(fail)
  })

  it('rides only successful string results — errors and structured results pass through', () => {
    const notices = createNotices()
    notices.owe('run_plan', 'PLAN')
    expect(notices.attach(fail, useful)).toBe(fail)
    expect(notices.attach(structured, useful)).toBe(structured)
    expect(text(notices.attach(ok, useful))).toBe('page read\n\nPLAN')
  })

  it('drops an immediate Notice the current result cannot carry', () => {
    const notices = createNotices()
    notices.owe('search_loop', 'SEARCH LOOP')
    expect(notices.attach(fail, useful)).toBe(fail)
    // The verdict was about the failed call; the next result owes nothing.
    expect(notices.attach(ok, useful)).toBe(ok)
  })

  it('keeps an owed Notice across results that cannot carry it, then delivers it once', () => {
    const notices = createNotices()
    notices.owe('run_plan', 'PLAN')
    expect(notices.attach(fail, useful)).toBe(fail)
    expect(notices.attach(structured, useful)).toBe(structured)
    expect(text(notices.attach(ok, useful))).toBe('page read\n\nPLAN')
    expect(notices.attach(ok, useful)).toBe(ok)
  })

  it('withholds the plan nudge and the budget warning from results that are not useful work', () => {
    const notices = createNotices()
    notices.owe('run_plan', 'PLAN')
    notices.supply('budget', () => 'BUDGET')
    notices.supply('finalization', () => 'FINALIZE')
    // A bookkeeping acknowledgement carries the directive but neither
    // useful-work Notice; the plan nudge stays owed for the next result.
    expect(text(notices.attach(ok, bookkeeping))).toBe('page read\n\nFINALIZE')
    expect(text(notices.attach(ok, useful))).toBe('page read\n\nPLAN\n\nBUDGET\n\nFINALIZE')
  })

  it('consults a supplier only when its guard passes, so its owner words the Notice at delivery', () => {
    const notices = createNotices()
    const asked: string[] = []
    let remaining = 3
    notices.supply('budget', () => {
      asked.push(`asked at ${remaining}`)
      return `${remaining} remain`
    })
    notices.attach(fail, useful)
    notices.attach(ok, bookkeeping)
    expect(asked).toEqual([])
    remaining = 2
    expect(text(notices.attach(ok, useful))).toBe('page read\n\n2 remain')
    expect(asked).toEqual(['asked at 2'])
  })

  it('treats a null supplier answer and a null owed text as nothing owed', () => {
    const notices = createNotices()
    notices.supply('finalization', () => null)
    notices.owe('search_loop', null)
    expect(notices.attach(ok, useful)).toBe(ok)
  })

  it('replaces a still-owed text of the same kind rather than stacking it', () => {
    const notices = createNotices()
    notices.owe('run_plan', 'FIRST')
    notices.owe('run_plan', 'SECOND')
    expect(text(notices.attach(ok, useful))).toBe('page read\n\nSECOND')
  })

  it('clear withdraws an owed text but remembers that the kind was delivered', () => {
    const notices = createNotices()
    notices.owe('run_plan', 'PLAN')
    notices.clear('run_plan')
    expect(notices.attach(ok, useful)).toBe(ok)
    expect(notices.delivered('run_plan')).toBe(false)

    notices.owe('run_plan', 'PLAN')
    notices.attach(ok, useful)
    notices.clear('run_plan')
    expect(notices.delivered('run_plan')).toBe(true)
  })

  it('records a delivery made through another channel', () => {
    const notices = createNotices()
    expect(notices.delivered('run_plan')).toBe(false)
    notices.markDelivered('run_plan')
    expect(notices.delivered('run_plan')).toBe(true)
  })

  it('replan forgets owed texts and deliveries but keeps suppliers registered', () => {
    const notices = createNotices()
    notices.supply('finalization', () => 'FINALIZE')
    notices.owe('run_plan', 'PLAN')
    notices.markDelivered('run_plan')
    notices.replan()
    expect(notices.delivered('run_plan')).toBe(false)
    expect(text(notices.attach(ok, useful))).toBe('page read\n\nFINALIZE')
  })
})
