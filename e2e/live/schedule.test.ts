import { describe, expect, it } from 'vitest'
import { liveWebHunts, type LiveWebHunt, type MeasuredPrompt } from './hunts'
import {
  CommandBudget,
  CommandBudgetExceeded,
  runLiveWebPass,
  type CommandRole,
  type ContinuationState,
  type HuntCaptureHost,
  type HuntContext,
  type ScheduledAttempt,
} from './schedule'

// The schedule's rules are all about something NOT happening — no second
// attempt, no retry after failure, no replacement Session, no coaching, no
// grading in the loop. None of that can be proven by a twenty-minute paid
// Electron capture, so it is proven here against a fake host that records
// every call it receives. The Electron seam proves the adapter; this proves
// the arithmetic.

/**
 * A capture record shaped like the real one will be, plus the two fields the
 * schedule must be shown to IGNORE: what the assistant answered, and whether
 * the task went well. If scheduling ever consults either, tests below that
 * vary only those fields would start disagreeing.
 */
interface FakeAttempt extends ScheduledAttempt {
  command: string
  role: CommandRole
  answerText: string | null
  taskOutcome: 'done' | 'failed'
}

type Thrown = { throws: string }

interface HuntScript {
  /** Fail to start the hunt at all — no Session, no command sent. */
  beginThrows?: string
  initial?: Partial<FakeAttempt> | Thrown
  /** What the live Session reports when asked whether it can take the follow-up. */
  continuation?: ContinuationState | Thrown
  followUp?: Partial<FakeAttempt> | Thrown
}

function isThrown(value: unknown): value is Thrown {
  return typeof value === 'object' && value !== null && 'throws' in value
}

class FakeHost implements HuntCaptureHost<FakeAttempt> {
  /** Every call, in order — the record isolation and sequencing are read from. */
  readonly calls: string[] = []
  /** Every command text actually submitted, to prove nothing is sent twice. */
  readonly submitted: string[] = []
  /** Which context object each command went through, to prove a follow-up shares its initial's Session. */
  readonly contexts = new Map<string, object[]>()

  constructor(private readonly script: Record<string, HuntScript> = {}) {}

  async beginHunt(hunt: LiveWebHunt): Promise<HuntContext<FakeAttempt>> {
    this.calls.push(`begin:${hunt.id}`)
    const scripted = this.script[hunt.id] ?? {}
    if (scripted.beginThrows) {
      throw new Error(scripted.beginThrows)
    }

    // Arrow properties, so `this` stays the host and each context can still
    // identify itself in `contexts` — that identity is what proves a
    // follow-up rode its initial's Session.
    const context: HuntContext<FakeAttempt> = {
      submit: async (prompt: MeasuredPrompt, role: CommandRole): Promise<FakeAttempt> => {
        this.calls.push(`submit:${hunt.id}:${role}`)
        this.submitted.push(prompt.text)
        this.contexts.set(`${hunt.id}:${role}`, [context])
        const plan = role === 'initial' ? scripted.initial : scripted.followUp
        if (isThrown(plan)) {
          throw new Error(plan.throws)
        }
        return {
          command: prompt.text,
          role,
          declined: null,
          accepted: true,
          measurementFault: null,
          answerText: 'an answer',
          taskOutcome: 'done',
          ...plan,
        }
      },
      continuationState: async (): Promise<ContinuationState> => {
        this.calls.push(`continuation:${hunt.id}`)
        const plan = scripted.continuation
        if (isThrown(plan)) {
          throw new Error(plan.throws)
        }
        return plan ?? { ready: true }
      },
      end: async (): Promise<void> => {
        this.calls.push(`end:${hunt.id}`)
      },
    }
    return context
  }
}

const CORPUS = liveWebHunts()
const [PI, WATCH, EUROSTAR, VOYAGER] = CORPUS

describe('a pilot pass', () => {
  it('runs the four corpus hunts sequentially, in corpus order', async () => {
    const host = new FakeHost()
    const pass = await runLiveWebPass(host)

    expect(pass.hunts.map((hunt) => hunt.huntId)).toEqual(CORPUS.map((hunt) => hunt.id))
    expect(host.calls.filter((call) => call.startsWith('begin:'))).toEqual(
      CORPUS.map((hunt) => `begin:${hunt.id}`),
    )
  })

  it('ends each hunt before the next begins, so no two are ever live at once', async () => {
    const host = new FakeHost()
    await runLiveWebPass(host)

    const boundaries = host.calls.filter((call) => call.startsWith('begin:') || call.startsWith('end:'))
    expect(boundaries).toEqual(
      CORPUS.flatMap((hunt) => [`begin:${hunt.id}`, `end:${hunt.id}`]),
    )
  })

  it('submits exactly the six scheduled commands, and none of them twice', async () => {
    const host = new FakeHost()
    const pass = await runLiveWebPass(host)

    expect(pass.commandsSubmitted).toBe(6)
    expect(pass.commandBudget).toBe(6)
    expect(host.submitted).toHaveLength(6)
    expect(new Set(host.submitted).size).toBe(6)
  })

  it('submits the exact corpus prompt text, unaltered', async () => {
    const host = new FakeHost()
    await runLiveWebPass(host)

    expect(host.submitted).toEqual([
      PI.prompt.text,
      PI.followUp!.text,
      WATCH.prompt.text,
      EUROSTAR.prompt.text,
      EUROSTAR.followUp!.text,
      VOYAGER.prompt.text,
    ])
  })

  it('gives a hunt without a follow-up one command and a null follow-up record', async () => {
    const host = new FakeHost()
    const pass = await runLiveWebPass(host)

    const watch = pass.hunts.find((hunt) => hunt.huntId === WATCH.id)!
    expect(watch.followUp).toBeNull()
    expect(host.calls).not.toContain(`submit:${WATCH.id}:follow-up`)
    // Nothing asks about continuing a hunt that has nothing to continue with.
    expect(host.calls).not.toContain(`continuation:${WATCH.id}`)
  })

  it('records the prompt version each command was submitted at', async () => {
    const host = new FakeHost()
    const pass = await runLiveWebPass(host)

    const pi = pass.hunts.find((hunt) => hunt.huntId === PI.id)!
    expect(pi.initial.promptVersion).toBe(PI.prompt.version)
    expect(pi.followUp!.promptVersion).toBe(PI.followUp!.version)
  })
})

describe('follow-up delivery is independent of correctness', () => {
  /** Run one hunt with a scripted initial Answer, and report what the follow-up did. */
  async function followUpAfter(initial: Partial<FakeAttempt>) {
    const host = new FakeHost({ [PI.id]: { initial } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })
    return { host, followUp: pass.hunts[0].followUp! }
  }

  it('delivers the follow-up after a correct initial Answer', async () => {
    const { followUp } = await followUpAfter({ answerText: 'the researched, correct answer', taskOutcome: 'done' })
    expect(followUp.status).toBe('attempted')
  })

  it('delivers the follow-up after a wrong initial Answer, identically', async () => {
    const { host, followUp } = await followUpAfter({ answerText: 'a confidently wrong answer', taskOutcome: 'done' })
    expect(followUp.status).toBe('attempted')
    // The wrong answer is not corrected, and nothing extra is sent to make
    // the continuation possible.
    expect(host.submitted).toEqual([PI.prompt.text, PI.followUp!.text])
  })

  it('delivers the follow-up after a failed initial Run', async () => {
    const { followUp } = await followUpAfter({ answerText: null, taskOutcome: 'failed' })
    expect(followUp.status).toBe('attempted')
  })

  it('submits the follow-up through the same Session as its initial', async () => {
    const host = new FakeHost()
    await runLiveWebPass(host, { hunts: [PI] })

    expect(host.contexts.get(`${PI.id}:follow-up`)).toEqual(host.contexts.get(`${PI.id}:initial`))
  })

  it('never begins a second hunt to make a follow-up possible', async () => {
    const host = new FakeHost({ [PI.id]: { continuation: { ready: false, reason: 'session_lost', detail: 'gone' } } })
    await runLiveWebPass(host, { hunts: [PI] })

    expect(host.calls.filter((call) => call === `begin:${PI.id}`)).toHaveLength(1)
  })
})

describe('a follow-up that cannot happen is recorded, never dropped', () => {
  async function notReachedFor(continuation: ContinuationState) {
    const host = new FakeHost({ [PI.id]: { continuation } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })
    return { host, followUp: pass.hunts[0].followUp! }
  }

  it('records a Run that ended waiting for help, without answering it', async () => {
    const { host, followUp } = await notReachedFor({
      ready: false,
      reason: 'awaiting_help',
      detail: 'the Run ended asking the user to sign in',
    })

    expect(followUp).toEqual({
      status: 'not-reached',
      promptVersion: PI.followUp!.version,
      reason: 'awaiting_help',
      detail: 'the Run ended asking the user to sign in',
    })
    // The forbidden repair: no second command of any kind went out.
    expect(host.submitted).toEqual([PI.prompt.text])
  })

  it('records a lost Session rather than replacing it', async () => {
    const { followUp } = await notReachedFor({ ready: false, reason: 'session_lost', detail: 'the Session ended' })
    expect(followUp).toMatchObject({ status: 'not-reached', reason: 'session_lost' })
  })

  it('records a Session that could not take the command in its bound', async () => {
    const { followUp } = await notReachedFor({
      ready: false,
      reason: 'session_unavailable',
      detail: 'still busy at the readiness bound',
    })
    expect(followUp).toMatchObject({ status: 'not-reached', reason: 'session_unavailable' })
  })

  it('does not ask a Session about continuing when the initial was never accepted', async () => {
    const host = new FakeHost({ [PI.id]: { initial: { accepted: false } } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })

    expect(pass.hunts[0].followUp).toMatchObject({ status: 'not-reached', reason: 'initial_not_accepted' })
    expect(host.calls).not.toContain(`continuation:${PI.id}`)
    expect(host.submitted).toEqual([PI.prompt.text])
  })

  it('spends no budget on a follow-up it did not submit', async () => {
    const host = new FakeHost({ [PI.id]: { continuation: { ready: false, reason: 'session_lost', detail: 'gone' } } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })

    expect(pass.commandsSubmitted).toBe(1)
    expect(pass.commandBudget).toBe(2)
  })
})

describe('task failure and broken measurement are different records', () => {
  it('keeps a failed initial attempt beside its follow-up, never overwritten', async () => {
    const host = new FakeHost({
      [PI.id]: {
        initial: { answerText: 'wrong', taskOutcome: 'failed' },
        followUp: { answerText: 'right', taskOutcome: 'done' },
      },
    })
    const pass = await runLiveWebPass(host, { hunts: [PI] })
    const hunt = pass.hunts[0]

    expect(hunt.initial).toMatchObject({ status: 'attempted' })
    expect(hunt.initial.status === 'attempted' && hunt.initial.attempt.taskOutcome).toBe('failed')
    expect(hunt.followUp!.status === 'attempted' && hunt.followUp!.attempt.taskOutcome).toBe('done')
  })

  it('treats a broken initial capture as broken measurement, not a task result', async () => {
    const host = new FakeHost({ [PI.id]: { initial: { measurementFault: 'the Answer timestamp was never observed' } } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })

    // The attempt itself is retained, fault and all — the latency of a broken
    // capture is not silently discarded.
    expect(pass.hunts[0].initial).toMatchObject({ status: 'attempted' })
    // But its follow-up is not reached, and says so as measurement rather
    // than as a task outcome.
    expect(pass.hunts[0].followUp).toMatchObject({ status: 'not-reached', reason: 'capture_failed' })
  })

  it('records both commands as not reached when the hunt could not start', async () => {
    const host = new FakeHost({ [PI.id]: { beginThrows: 'Electron never came up' } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })

    expect(pass.hunts[0].initial).toMatchObject({ status: 'not-reached', reason: 'capture_failed' })
    expect(pass.hunts[0].followUp).toMatchObject({ status: 'not-reached', reason: 'capture_failed' })
    expect(pass.commandsSubmitted).toBe(0)
    expect(host.submitted).toEqual([])
  })

  it('does not resend a command whose dispatch threw', async () => {
    const host = new FakeHost({ [PI.id]: { initial: { throws: 'the session was already closed' } } })
    const pass = await runLiveWebPass(host, { hunts: [PI] })

    expect(pass.hunts[0].initial).toMatchObject({ status: 'not-reached', reason: 'capture_failed' })
    expect(host.calls.filter((call) => call.startsWith('submit:'))).toEqual([`submit:${PI.id}:initial`])
    // A throw is a protocol error — the capture never submits on that path —
    // so nothing went out and nothing was spent.
    expect(pass.commandsSubmitted).toBe(0)
  })

  it('archives a broken hunt before tearing it down', async () => {
    const host = new FakeHost({ [PI.id]: { initial: { throws: 'the tape was lost' } } })
    await runLiveWebPass(host, { hunts: [PI] })

    expect(host.calls).toContain(`end:${PI.id}`)
  })

  it('runs the remaining independent hunts after one breaks', async () => {
    const host = new FakeHost({ [WATCH.id]: { beginThrows: 'the profile would not restore' } })
    const pass = await runLiveWebPass(host)

    expect(pass.hunts).toHaveLength(4)
    expect(pass.hunts[1]).toMatchObject({ huntId: WATCH.id, initial: { status: 'not-reached' } })
    expect(pass.hunts[2].initial).toMatchObject({ status: 'attempted' })
    expect(pass.hunts[3].initial).toMatchObject({ status: 'attempted' })
    // One hunt lost: the four initials minus one, plus both follow-ups.
    expect(pass.commandsSubmitted).toBe(5)
  })
})

describe('a command the capture declined to dispatch', () => {
  // The capture re-checks readiness immediately before submitting, so it can
  // refuse after the schedule's own check passed. Nothing goes out on that
  // path, and calling it an attempt would claim a Run that never existed.
  const declined = {
    declined: { reason: 'session_unavailable' as const, detail: 'the Session lapsed before the submit' },
  }

  it('is recorded as not reached, not as an attempt', async () => {
    const pass = await runLiveWebPass(new FakeHost({ [PI.id]: { initial: declined } }), { hunts: [PI] })

    expect(pass.hunts[0].initial).toMatchObject({
      status: 'not-reached',
      reason: 'session_unavailable',
      detail: 'the Session lapsed before the submit',
    })
  })

  it('spends no budget, because no command went out', async () => {
    const pass = await runLiveWebPass(new FakeHost({ [PI.id]: { initial: declined } }), { hunts: [PI] })
    expect(pass.commandsSubmitted).toBe(0)
  })

  it('leaves the follow-up of an undispatched initial not reached too', async () => {
    const pass = await runLiveWebPass(new FakeHost({ [PI.id]: { initial: declined } }), { hunts: [PI] })
    expect(pass.hunts[0].followUp).toMatchObject({ status: 'not-reached', reason: 'initial_not_accepted' })
  })

  it('records a declined follow-up as not reached, and charges only the initial', async () => {
    const pass = await runLiveWebPass(new FakeHost({ [PI.id]: { followUp: declined } }), { hunts: [PI] })

    expect(pass.hunts[0].initial).toMatchObject({ status: 'attempted' })
    expect(pass.hunts[0].followUp).toMatchObject({ status: 'not-reached', reason: 'session_unavailable' })
    expect(pass.commandsSubmitted).toBe(1)
  })
})

describe('the measured corpus cannot be substituted', () => {
  it('refuses a task the approved corpus does not declare', async () => {
    const invented = { ...PI, id: 'fixture-scripted-task' } as unknown as LiveWebHunt
    await expect(runLiveWebPass(new FakeHost(), { hunts: [invented] })).rejects.toThrow(
      /not an approved live-web hunt/,
    )
  })

  it('refuses to run the same hunt twice in one pass', async () => {
    await expect(runLiveWebPass(new FakeHost(), { hunts: [PI, PI] })).rejects.toThrow(/appears twice/)
  })
})

describe('the pilot work bound', () => {
  it('holds a pass to its scheduled command count', () => {
    const budget = new CommandBudget(2)
    budget.spend()
    budget.spend()
    expect(budget.submitted).toBe(2)
    expect(() => budget.spend()).toThrow(CommandBudgetExceeded)
  })

  it('names the bound it protects', () => {
    const budget = new CommandBudget(6)
    for (let i = 0; i < 6; i++) budget.spend()
    expect(() => budget.spend()).toThrow(/four initial submissions plus two eligible follow-ups/)
  })
})
