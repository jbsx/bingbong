import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { UnstampedEvent } from './events'
import type { RunDecisions } from './decisions'
import type { RunInterrupts } from './interrupts'

// The Run's two named seams (#156). The Run's own adapters are the
// pipeline's choreography, covered byte-for-byte by commandPipeline.test.ts.
// What is asserted here is the other side of each interface: the
// configuration a delegated worker will be given (#154, step 2) — a
// `decisions` that refuses, because a worker has no user to ask, and a
// cancel-only `interrupts` that never steers and throws when its parent
// cancels it. Both must satisfy the same shapes the gate and the loop
// consume, with no pipeline code of their own.

const call: ToolCall = { id: 'c1', name: 'ask_user', args: {} }

class WorkerCancelled extends Error {}

/** A worker's decisions: no user is reachable, so every question is refused. */
function refusingDecisions(): RunDecisions {
  const refusal: ToolResultOutcome = { ok: false, error: 'no user to ask: delegated work cannot reach the user' }
  return {
    async *ask() {
      return refusal
    },
    async *confirm() {
      return { approved: false, outcome: refusal } as const
    },
  }
}

/** A worker's interrupts: no Pause, no Steering — only its parent's cancel. */
function cancelOnlyInterrupts(cancelled: () => boolean): RunInterrupts {
  return {
    async *check() {
      if (cancelled()) throw new WorkerCancelled()
      return undefined
    },
  }
}

async function drain<T>(generator: AsyncGenerator<UnstampedEvent, T>): Promise<{ events: UnstampedEvent[]; value: T }> {
  const events: UnstampedEvent[] = []
  for (;;) {
    const step = await generator.next()
    if (step.done) return { events, value: step.value }
    events.push(step.value)
  }
}

describe('the decisions seam', () => {
  it('is satisfied by an adapter that refuses every question, with no events', async () => {
    const decisions = refusingDecisions()

    const asked = await drain(decisions.ask('Which one?', call))

    expect(asked.events).toEqual([])
    expect(asked.value).toEqual({ ok: false, error: 'no user to ask: delegated work cannot reach the user' })
  })

  it('is satisfied by an adapter that denies every Confirmation with its own wording', async () => {
    const decisions = refusingDecisions()

    const confirmed = await drain(decisions.confirm('Delete the file?', call))

    expect(confirmed.events).toEqual([])
    expect(confirmed.value).toEqual({
      approved: false,
      outcome: { ok: false, error: 'no user to ask: delegated work cannot reach the user' },
    })
  })
})

describe('the interrupts seam', () => {
  it('is satisfied by a cancel-only hook that yields nothing and steers never', async () => {
    const interrupts = cancelOnlyInterrupts(() => false)

    const checked = await drain(interrupts.check('acting'))

    expect(checked.events).toEqual([])
    expect(checked.value).toBeUndefined()
  })

  it('throws out of the loop when the cancel-only hook is cancelled', async () => {
    const interrupts = cancelOnlyInterrupts(() => true)

    await expect(drain(interrupts.check('thinking'))).rejects.toBeInstanceOf(WorkerCancelled)
  })
})
