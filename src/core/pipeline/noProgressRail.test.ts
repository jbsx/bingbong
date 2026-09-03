import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import { createNoProgressRail } from './noProgressRail'
import type { SettledPageState } from './progressFingerprints'

// Issue #126, ADR 0027: the no-progress rails over the #125 fingerprints —
// objective repetition (same action against equivalent settled state)
// nudges then refuses pre-execution, and sustained absence of Progress
// (two no-progress actions exhaust an Approach; two exhausted Approaches
// stop the run) escalates to an Approach instruction and Finalization.
// Everything here is deterministic: the settled state comes from the
// test's scripted source, never a browser.

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `${name}:${JSON.stringify(args)}`, name, args }
}

const ok = (result = 'done'): ToolResultOutcome => ({ ok: true, result })
const failed = (error = 'kaboom'): ToolResultOutcome => ({ ok: false, error })

function state(overrides: Partial<SettledPageState>): SettledPageState {
  return {
    url: 'https://example.com/article',
    title: 'The article',
    textDigest: 'Intro paragraph.\nSecond paragraph.',
    scrollX: 0,
    scrollY: 0,
    dialogOpen: false,
    dialogText: '',
    ...overrides,
  }
}

const BASE = state({})

/** A settled-state source over a script of states, served in order (last one repeats). */
function scriptedStates(states: SettledPageState[]): () => SettledPageState | null {
  let index = 0
  return () => states[Math.min(index++, states.length - 1)] ?? null
}

describe('no-progress rail — objective repetition (#126/AC1)', () => {
  it('nudges the first equivalent action against equivalent state, then refuses the next pre-execution', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    const navigate = call('navigate', { url: 'https://example.com/article' })

    // First attempt: baseline — allowed, no nudge.
    expect(await rail.gate(navigate)).toEqual({ ok: true })
    expect(await rail.observe(navigate, ok())).toBeNull()
    // Second attempt against the same settled state: allowed, nudged.
    expect(await rail.gate(navigate)).toEqual({ ok: true })
    expect(await rail.observe(navigate, ok())).toMatch(/repeat|equivalent/i)
    // Third attempt: refused before execution.
    const refusal = await rail.gate(navigate)
    expect(refusal).toMatchObject({ ok: false })
    expect(refusal.ok ? undefined : refusal.reason).toMatch(/Not executed/i)
    // The refused call observed nothing new.
    expect(await rail.observe(navigate, failed(refusal.ok ? undefined : refusal.reason))).toBeNull()
  })

  it('replays the nudge when a nudged attempt fails before its result can carry it', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    const navigate = call('navigate', { url: 'https://example.com/article' })
    expect(await rail.gate(navigate)).toEqual({ ok: true })
    await rail.observe(navigate, ok()) // baseline
    // The repeat is nudged at the gate, then denied by the risk tier —
    // the model never saw the nudge.
    expect(await rail.gate(navigate)).toEqual({ ok: true })
    await rail.observe(navigate, failed('denied by the user; do not retry this action'))
    // The next equivalent attempt is nudged again, not refused blind.
    expect(await rail.gate(navigate)).toEqual({ ok: true })
    expect(await rail.observe(navigate, ok())).toMatch(/repeat|equivalent/i)
    expect(await rail.gate(navigate)).toMatchObject({ ok: false })
  })

  it('folds equivalent URLs and typed text into one action identity', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    expect(await rail.gate(call('navigate', { url: 'https://EXAMPLE.com/article/' }))).toEqual({ ok: true })
    expect(await rail.observe(call('navigate', { url: 'https://EXAMPLE.com/article/' }), ok())).toBeNull()
    // Scheme/host case, trailing slash, and trackers fold: this is the same
    // action against the same state — nudged.
    const repeat = call('navigate', { url: 'https://example.com/article?utm_source=x' })
    expect(await rail.gate(repeat)).toEqual({ ok: true })
    expect(await rail.observe(repeat, ok())).toMatch(/repeat|equivalent/i)
  })

  it('never refuses when the settled state moved between attempts (#126/AC2)', async () => {
    let current = BASE
    const rail = createNoProgressRail({ settledState: () => current })
    const scrollDown = call('scroll', { direction: 'down' })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      // The gate reads the page as it sits — where the previous scroll
      // left it — and each attempt's live state differs from the previous
      // attempt's, so every scroll is a fresh pair.
      expect(await rail.gate(scrollDown)).toEqual({ ok: true })
      expect(await rail.observe(scrollDown, ok())).toBeNull()
      current = state({ scrollY: 800 * (attempt + 1) })
    }
    expect(rail.finalizationDue()).toBe(false)
  })

  it('keeps distinct actions against the same state independent', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    expect(await rail.gate(call('click', { ref: 7 }))).toEqual({ ok: true })
    await rail.observe(call('click', { ref: 7 }), ok())
    // A different ref is a different action: no nudge, no refusal.
    expect(await rail.gate(call('click', { ref: 8 }))).toEqual({ ok: true })
    expect(await rail.observe(call('click', { ref: 8 }), ok())).toBeNull()
    // Same action against a changed state is a fresh pair.
    let current = BASE
    const rail2 = createNoProgressRail({ settledState: () => current })
    expect(await rail2.gate(call('click', { ref: 7 }))).toEqual({ ok: true })
    await rail2.observe(call('click', { ref: 7 }), ok())
    current = state({ dialogOpen: true, dialogText: 'Accept cookies?' })
    expect(await rail2.gate(call('click', { ref: 7 }))).toEqual({ ok: true })
    expect(await rail2.observe(call('click', { ref: 7 }), ok())).toBeNull()
  })
})

describe('no-progress rail — meaningful progression (#126/AC2)', () => {
  it('counts content, pagination, dialog, and media changes as Progress', async () => {
    const progressions: SettledPageState[] = [
      state({ textDigest: 'A different paragraph entirely.' }),
      state({ url: 'https://example.com/list?page=2', textDigest: 'Results 11–20.' }),
      state({ dialogOpen: true, dialogText: 'Accept cookies?' }),
      state({ media: { paused: false, currentTime: 42, volume: 0.65 } }),
    ]
    for (const progressed of progressions) {
      const source = scriptedStates([BASE, progressed])
      const rail = createNoProgressRail({ settledState: source })
      await rail.observe(call('navigate', { url: 'https://example.com/x' }), ok()) // baseline
      const nudge = await rail.observe(call('click', { ref: 3 }), ok())
      expect(nudge).toBeNull()
      expect(rail.finalizationDue()).toBe(false)
    }
  })

  it('counts a requested element state change — a typed value, a toggled checkbox — as Progress (#126/AC2-3)', async () => {
    let current = BASE
    const rail = createNoProgressRail({ settledState: () => current })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    // The field takes the text: observable interactive state moved.
    current = state({ interactiveDigest: 'input|Search|||hello|' })
    expect(await rail.observe(call('type', { ref: 5, text: 'hello' }), ok())).toBeNull()
    // The checkbox flips: same again.
    current = state({ interactiveDigest: 'input|Notify||| |checked' })
    expect(await rail.observe(call('click', { ref: 8 }), ok())).toBeNull()
    expect(rail.finalizationDue()).toBe(false)
    // Retyping the same text against the filled field changes nothing —
    // and an action outcome has already observed this state, so the
    // second retype exhausts the Approach (#161).
    expect(await rail.observe(call('type', { ref: 5, text: 'hello' }), ok())).toBeNull()
    expect(await rail.observe(call('type', { ref: 5, text: 'hello' }), ok())).toMatch(/change your approach/i)
  })

  it('treats URL-only alternate-representation changes as no Progress (#126/AC3)', async () => {
    const source = scriptedStates([BASE, state({ url: 'https://example.com/article?print=1' })])
    const rail = createNoProgressRail({ settledState: source })
    await rail.observe(call('navigate', { url: 'https://example.com/article' }), ok()) // baseline
    const nudge = await rail.observe(call('navigate', { url: 'https://example.com/article?print=1' }), ok())
    // No Progress — but also not a fingerprint-equivalent action, so no
    // redundancy nudge either; the counter advanced toward the instruction.
    expect(nudge).toBeNull()
    expect(rail.finalizationDue()).toBe(false)
    // The very next no-progress action hits two and instructs the change.
    // It is another navigate on purpose: a first read of this state would
    // be material by the producer clause (#161), and this test is about
    // the alternate representation, not about who observed it.
    const instruction = await rail.observe(call('navigate', { url: 'https://example.com/article?amp=1' }), ok())
    expect(instruction).toMatch(/change your approach/i)
  })
})

describe('no-progress rail — resets (#126/AC3)', () => {
  it('an accepted Evidence Checkpoint resets the no-progress count and approach exhaustion', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // the first read: neutral (#161)
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // no-progress 1
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i) // approach 1 exhausted
    await rail.observe(call('read_page'), ok()) // no-progress 1 under the new approach
    // The checkpoint lands: everything resets.
    await rail.observe(call('record_evidence', { observation: 'fact', source_url: 'https://example.com/a' }), ok())
    // Two fresh no-progress actions only re-instruct (approach count reset too).
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i)
    expect(rail.finalizationDue()).toBe(false)
  })

  it('a rejected Evidence Checkpoint does not reset — it contributes', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    await rail.observe(call('record_evidence', { observation: 'fact' }), failed('citation not observed'))
    expect(await rail.observe(call('scroll', { direction: 'down' }), ok())).toMatch(/change your approach/i)
  })

  it('a requested state change resets the rails', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // no-progress 1
    await rail.observe(call('set_setting', { setting: 'appearance', string_value: 'dark' }), ok())
    // The counter restarted: one no-progress action no longer reaches the instruction.
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
  })

  it('a Steering replan resets approach accounting but keeps page reality', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // the first read: neutral (#161)
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i) // approach 1 exhausted
    rail.reset()
    // Fresh objective: the same page answers a new question, so what each
    // producer had already learned reset with the plan (#161) — the read
    // is material again, and two repeats instruct rather than finalize.
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i)
    expect(rail.finalizationDue()).toBe(false)
    // A tripped rail reopens the same way: the corrected objective exits
    // the no_progress Finalization.
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toMatch(/final answer JSON/)
    expect(rail.finalizationDue()).toBe(true)
    rail.reset()
    expect(rail.finalizationDue()).toBe(false)
  })
})

describe('no-progress rail — approach exhaustion and Finalization (#126/AC4)', () => {
  it('instructs an Approach change after two no-progress actions, twice, then trips Finalization', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // the first read: neutral (#161)
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i)
    expect(rail.finalizationDue()).toBe(false)
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    // The second exhausted Approach carries the Finalization directive.
    const trip = await rail.observe(call('read_page'), ok())
    expect(trip).toMatch(/final answer JSON/)
    expect(rail.finalizationDue()).toBe(true)
  })

  it('counts only successful actions — failures neither count nor reset', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rail.observe(call('click', { ref: 7 }), failed('ref not found'))
      expect(rail.finalizationDue()).toBe(false)
    }
    // Still only one no-progress action counted (the baseline reset first).
    expect(await rail.observe(call('click', { ref: 7 }), ok())).toBeNull()
  })

  it('is inert without a settled-state source', async () => {
    const rail = createNoProgressRail({})
    const navigate = call('navigate', { url: 'https://example.com/a' })
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(await rail.gate(navigate)).toEqual({ ok: true })
      expect(await rail.observe(navigate, ok())).toBeNull()
    }
    expect(rail.finalizationDue()).toBe(false)
  })

  it('ignores non-page tools that are not checkpoints or state changes', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(await rail.observe(call('spawn_agent', { task: 'compare widgets' }), ok())).toBeNull()
      expect(rail.finalizationDue()).toBe(false)
    }
  })
})

describe('no-progress rail — first observation by a new producer (#161)', () => {
  it('lets a worker read, look, and re-read one page without finalizing (#161 worked example)', async () => {
    // The canonical browse-worker workload: open a source and study it.
    // Its tab sits at one settled state throughout, and neither read_page
    // nor look can move a page — before #161 these five calls exhausted
    // two Approaches and finalized the worker for `no_progress` with
    // eleven of its twelve rounds unspent.
    const rail = createNoProgressRail({ settledState: () => BASE })
    const navigate = call('navigate', { url: 'https://example.com/article' })
    const read = call('read_page')
    const look = call('look')

    expect(await rail.gate(navigate)).toEqual({ ok: true })
    expect(await rail.observe(navigate, ok())).toBeNull() // baseline

    // The first read of this state, and the first look at it, are each new
    // material: neither escalates, and neither is Progress.
    expect(await rail.gate(read)).toEqual({ ok: true })
    expect(await rail.observe(read, ok())).toBeNull()
    expect(await rail.gate(look)).toEqual({ ok: true })
    expect(await rail.observe(look, ok())).toBeNull()

    // Repeats of the same producer against the same state are not: they
    // carry the redundancy nudge and count toward one Approach.
    expect(await rail.gate(read)).toEqual({ ok: true })
    expect(await rail.observe(read, ok())).toMatch(/repeat|equivalent/i)
    expect(await rail.gate(look)).toEqual({ ok: true })
    const second = await rail.observe(look, ok())
    expect(second).toMatch(/change your approach/i)
    // One Approach exhausted, not two: five calls in, the worker is still
    // working rather than finalizing.
    expect(second).not.toMatch(/final answer JSON/)
    expect(rail.finalizationDue()).toBe(false)
  })

  it('counts a repeat by the same producer against the same state as no Progress', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // first read: neutral
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // no-progress 1
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i)
  })

  it('does not re-earn material for a producer that already observed the state', async () => {
    let current = BASE
    const other = state({ url: 'https://example.com/other', textDigest: 'Something else.' })
    const rail = createNoProgressRail({ settledState: () => current })
    await rail.observe(call('navigate', { url: 'https://example.com/article' }), ok()) // baseline at BASE
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // first read of BASE: neutral

    // Away and back: the page moving is Progress in its own right.
    current = other
    expect(await rail.observe(call('navigate', { url: 'https://example.com/other' }), ok())).toBeNull()
    current = BASE
    expect(await rail.observe(call('back'), ok())).toBeNull()

    // BASE has been read before, so re-reading it is not new material —
    // but nothing has looked at it yet, and that still is. Neutral, not
    // Progress: the no-progress count survives the first look, so the
    // next repeat exhausts the Approach.
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // no-progress 1
    expect(await rail.observe(call('look'), ok())).toBeNull() // first look at BASE: neutral
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i)
    expect(await rail.observe(call('look'), ok())).toBeNull() // no-progress 1 under the new approach
    expect(rail.finalizationDue()).toBe(false)
  })

  it('a first observation is neutral — it does not reset the no-progress count', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('click', { ref: 7 }), ok())).toBeNull() // no-progress 1
    // The first read of this state is new material, so it is not a second
    // no-progress action — but the page did not move, so the run is
    // exactly as stuck as before it: the count stands at one.
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('click', { ref: 8 }), ok())).toMatch(/change your approach/i)
  })

  it('a first observation is neutral — it does not un-exhaust an Approach', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // first read: neutral
    expect(await rail.observe(call('read_page'), ok())).toBeNull() // no-progress 1
    expect(await rail.observe(call('read_page'), ok())).toMatch(/change your approach/i) // approach 1 exhausted
    // A first look now would restart the accounting if it were Progress.
    // It is not: the exhausted Approach stays exhausted, and the second
    // Approach's two repeats trip Finalization.
    expect(await rail.observe(call('look'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toBeNull()
    expect(await rail.observe(call('read_page'), ok())).toMatch(/final answer JSON/)
    expect(rail.finalizationDue()).toBe(true)
  })

  it('keeps every page-moving tool one producer — distinct actions that move nothing still escalate', async () => {
    const rail = createNoProgressRail({ settledState: () => BASE })
    await rail.observe(call('navigate', { url: 'https://example.com/a' }), ok()) // baseline
    // click, scroll, and back all produce action outcomes: a different
    // action is not a different Observation Producer, so an unmoving page
    // escalates.
    expect(await rail.observe(call('click', { ref: 7 }), ok())).toBeNull()
    expect(await rail.observe(call('scroll', { direction: 'down' }), ok())).toMatch(/change your approach/i)
  })
})
